/*
 * ota_manager.c - see ota_manager.h. Thin glue over the pure rules in ota_logic.c.
 *
 * Persistence: NVS namespace "ota", key "marker" (ota_marker_serialize text).
 * It is written BEFORE the boot partition is switched and removed once the
 * final status was published, so a power loss anywhere in between leaves
 * either a harmless marker (reported at the next boot) or none.
 *
 * Memory (classic ESP32, no PSRAM): the download task and its buffers live in
 * internal RAM next to the MQTT mTLS session. ota_memory_ok() checks the free
 * heap and the largest block before the task starts (budget in ota_logic.h),
 * and the heap is logged at the start, at every progress status and at the end
 * so the real figures can be read on the serial monitor.
 */

#include "ota_manager.h"

#include "esp_app_desc.h"
#include "esp_crt_bundle.h"
#include "esp_heap_caps.h"
#include "esp_http_client.h"
#include "esp_log.h"
#include "esp_ota_ops.h"
#include "esp_system.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "freertos/task.h"
#include "mqtt_manager.h"
#include "nvs.h"
#include "ota_logic.h"
#include "psa/crypto.h"
#include "wifi_manager.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static const char *TAG = "OTA";

#define OTA_NVS_NAMESPACE "ota"
#define OTA_NVS_KEY "marker"
#define OTA_TOPIC_QOS 1
#define OTA_TASK_STACK_HTTP 6144
#define OTA_TASK_STACK_HTTPS 10240 /* the mbedTLS handshake runs on this stack */
#define OTA_TASK_PRIORITY 4
#define OTA_VALIDATE_TASK_STACK 4096
#define OTA_CHUNK_BYTES 4096
#define OTA_HTTP_TIMEOUT_MS 15000
#define OTA_HTTP_RX_BUFFER 2048
#define OTA_HTTP_TX_BUFFER 1536  /* the request line carries a url of up to 1024 chars */
#define OTA_REBOOT_DELAY_MS 2000 /* lets the last QoS 1 status leave before the restart */

static bool s_initialized = false;
static char s_topic_status[88];
static char s_running_version[OTA_VERSION_MAX];

static SemaphoreHandle_t s_lock = NULL;       /* guards s_tracker, s_unsent */
static SemaphoreHandle_t s_final_lock = NULL; /* serializes the final report */
static ota_tracker_t s_tracker;
static bool s_unsent = false;
static char s_unsent_id[OTA_ID_MAX];

/* The boot after an update. */
static volatile bool s_validation_pending = false; /* running image still PENDING_VERIFY */
static bool s_final_pending = false;               /* guarded by s_final_lock */
static bool s_final_ready = false;                 /* validated (or nothing to validate) */
static bool s_final_sending = false;               /* a publish of s_final is in progress */
static ota_status_t s_final;

/* ------------------------------------------------------------------ */
/* marker (NVS)                                                        */
/* ------------------------------------------------------------------ */

static bool marker_store(const ota_marker_t *m) {
  char buf[OTA_MARKER_SERIALIZED_MAX];
  if (ota_marker_serialize(m, buf, sizeof(buf)) == 0) return false;
  nvs_handle_t h;
  esp_err_t err = nvs_open(OTA_NVS_NAMESPACE, NVS_READWRITE, &h);
  if (err == ESP_OK) {
    err = nvs_set_str(h, OTA_NVS_KEY, buf);
    if (err == ESP_OK) err = nvs_commit(h);
    nvs_close(h);
  }
  if (err != ESP_OK) ESP_LOGE(TAG, "Persisting the OTA marker failed: %s", esp_err_to_name(err));
  return err == ESP_OK;
}

static bool marker_load(ota_marker_t *m) {
  nvs_handle_t h;
  if (nvs_open(OTA_NVS_NAMESPACE, NVS_READONLY, &h) != ESP_OK) return false;
  char buf[OTA_MARKER_SERIALIZED_MAX];
  size_t size = sizeof(buf);
  bool ok = nvs_get_str(h, OTA_NVS_KEY, buf, &size) == ESP_OK && ota_marker_parse(buf, m);
  nvs_close(h);
  return ok;
}

static void marker_erase(void) {
  nvs_handle_t h;
  if (nvs_open(OTA_NVS_NAMESPACE, NVS_READWRITE, &h) != ESP_OK) return;
  esp_err_t err = nvs_erase_key(h, OTA_NVS_KEY);
  if (err == ESP_OK) err = nvs_commit(h);
  nvs_close(h);
  if (err != ESP_OK && err != ESP_ERR_NVS_NOT_FOUND) {
    ESP_LOGE(TAG, "Clearing the OTA marker failed: %s", esp_err_to_name(err));
  }
}

/* ------------------------------------------------------------------ */
/* heap                                                                */
/* ------------------------------------------------------------------ */

static void log_heap(const char *when) {
  ESP_LOGI(TAG, "Heap %s: free %u, largest block %u, minimum ever %u", when,
           (unsigned)heap_caps_get_free_size(MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT),
           (unsigned)heap_caps_get_largest_free_block(MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT),
           (unsigned)heap_caps_get_minimum_free_size(MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT));
}

/* ------------------------------------------------------------------ */
/* status publishing                                                   */
/* ------------------------------------------------------------------ */

/* Updates the request's entry and returns a copy (call with s_lock held). */
static ota_status_t record_locked(const char *request_id, const char *target_version, ota_state_t state,
                                  ota_error_t error, int progress) {
  ota_tracker_update(&s_tracker, request_id, target_version, state, error, progress);
  return *ota_tracker_find(&s_tracker, request_id);
}

static bool publish_raw(const ota_status_t *st) {
  if (s_topic_status[0] == '\0') return false;
  char buf[OTA_STATUS_MAX];
  if (ota_build_status(buf, sizeof(buf), st, s_running_version) == 0) {
    ESP_LOGE(TAG, "ota/status payload does not fit");
    return false;
  }
  if (mqtt_manager_publish(s_topic_status, buf, OTA_TOPIC_QOS, false) != ESP_OK) return false;
  ESP_LOGI(TAG, "ota/status %s sent (request %s%s%s)", ota_state_name(st->state), st->request_id,
           st->error != OTA_ERR_NONE ? ", error " : "", ota_error_code(st->error));
  return true;
}

/* A status that could not go out (offline) is re-sent from the tracker on the next connect. */
static void publish_status(const ota_status_t *st) {
  if (publish_raw(st) || st->state == OTA_ST_DOWNLOADING) return; /* progress is not worth keeping */
  ESP_LOGW(TAG, "ota/status %s for %s not published (offline): kept for the next connect",
           ota_state_name(st->state), st->request_id);
  xSemaphoreTake(s_lock, portMAX_DELAY);
  strlcpy(s_unsent_id, st->request_id, sizeof(s_unsent_id));
  s_unsent = true;
  xSemaphoreGive(s_lock);
}

static void transition(const ota_command_t *cmd, ota_state_t state, int progress) {
  xSemaphoreTake(s_lock, portMAX_DELAY);
  ota_status_t st = record_locked(cmd->request_id, cmd->version, state, OTA_ERR_NONE, progress);
  xSemaphoreGive(s_lock);
  publish_status(&st);
}

/* The update ended without rebooting. */
static void fail(const ota_command_t *cmd, ota_error_t error) {
  ESP_LOGE(TAG, "Update %s failed: %s", cmd->request_id, ota_error_code(error));
  xSemaphoreTake(s_lock, portMAX_DELAY);
  ota_status_t st = record_locked(cmd->request_id, cmd->version, OTA_ST_FAILED, error, -1);
  xSemaphoreGive(s_lock);
  publish_status(&st);
}

/* ------------------------------------------------------------------ */
/* download                                                            */
/* ------------------------------------------------------------------ */

static ota_error_t http_error(esp_http_client_handle_t client) {
  int code = 0, flags = 0;
  esp_http_client_get_and_clear_last_tls_error(client, &code, &flags);
  return (code != 0 || flags != 0) ? OTA_ERR_TLS_ERROR : OTA_ERR_DOWNLOAD_FAILED;
}

static int slot_of(const esp_partition_t *p) {
  if (p == NULL || p->subtype < ESP_PARTITION_SUBTYPE_APP_OTA_MIN ||
      p->subtype >= ESP_PARTITION_SUBTYPE_APP_OTA_MAX) {
    return -1;
  }
  return (int)(p->subtype - ESP_PARTITION_SUBTYPE_APP_OTA_MIN);
}

/* Streams the image into `part`. Returns OTA_ERR_NONE after a complete, verified
 * image (the boot partition is NOT set yet); the OTA handle is then closed. */
static ota_error_t download_and_flash(const ota_command_t *cmd, const esp_partition_t *part) {
  ota_error_t result = OTA_ERR_INTERNAL;
  esp_http_client_handle_t client = NULL;
  esp_ota_handle_t ota = 0;
  bool ota_open = false;
  psa_hash_operation_t hash = PSA_HASH_OPERATION_INIT;
  bool hash_open = false;
  uint8_t *buf = malloc(OTA_CHUNK_BYTES);
  uint64_t received = 0;

  if (buf == NULL) return OTA_ERR_NO_MEMORY;
  if (psa_crypto_init() != PSA_SUCCESS || psa_hash_setup(&hash, PSA_ALG_SHA_256) != PSA_SUCCESS) {
    free(buf);
    return OTA_ERR_INTERNAL;
  }
  hash_open = true;

  /* No redirects: the url must be the final one (a redirect could also
   * downgrade https). https verifies the server with the certificate bundle. */
  esp_http_client_config_t hc = {
      .url = cmd->url,
      .timeout_ms = OTA_HTTP_TIMEOUT_MS,
      .buffer_size = OTA_HTTP_RX_BUFFER,
      .buffer_size_tx = OTA_HTTP_TX_BUFFER,
      .disable_auto_redirect = true,
      .keep_alive_enable = false,
  };
  if (ota_url_is_https(cmd->url)) hc.crt_bundle_attach = esp_crt_bundle_attach;
  client = esp_http_client_init(&hc);
  if (client == NULL) {
    result = OTA_ERR_NO_MEMORY;
    goto done;
  }
  if (esp_http_client_open(client, 0) != ESP_OK) {
    result = http_error(client);
    goto done;
  }
  int64_t content_length = esp_http_client_fetch_headers(client);
  int status = esp_http_client_get_status_code(client);
  if (content_length < 0 || status != 200) {
    ESP_LOGE(TAG, "Download refused: HTTP %d, content length %lld", status, (long long)content_length);
    result = http_error(client);
    goto done;
  }
  if (content_length > 0 && (uint64_t)content_length != cmd->size) { /* 0 = chunked: checked at the end */
    ESP_LOGE(TAG, "Content length %lld differs from the command size %u", (long long)content_length,
             (unsigned)cmd->size);
    result = OTA_ERR_SIZE_MISMATCH;
    goto done;
  }

  /* Sequential writes erase sector by sector: no multi-second full erase that
   * would starve the MQTT keepalive. */
  esp_err_t err = esp_ota_begin(part, OTA_WITH_SEQUENTIAL_WRITES, &ota);
  if (err != ESP_OK) {
    ESP_LOGE(TAG, "esp_ota_begin failed: %s", esp_err_to_name(err));
    result = OTA_ERR_FLASH_ERROR;
    goto done;
  }
  ota_open = true;

  ota_progress_t progress;
  bool heap_logged = false;
  ota_progress_start(&progress, esp_timer_get_time() / 1000);
  transition(cmd, OTA_ST_DOWNLOADING, 0);

  while (true) {
    int n = esp_http_client_read(client, (char *)buf, OTA_CHUNK_BYTES);
    if (n < 0) {
      result = http_error(client);
      goto done;
    }
    if (n == 0) {
      if (esp_http_client_is_complete_data_received(client)) break;
      ESP_LOGE(TAG, "Connection closed after %llu bytes", (unsigned long long)received);
      result = http_error(client);
      goto done;
    }
    received += (uint64_t)n;
    if (received > cmd->size) {
      result = OTA_ERR_SIZE_MISMATCH;
      goto done;
    }
    if (psa_hash_update(&hash, buf, (size_t)n) != PSA_SUCCESS) {
      result = OTA_ERR_INTERNAL;
      goto done;
    }
    err = esp_ota_write(ota, buf, (size_t)n);
    if (err != ESP_OK) {
      ESP_LOGE(TAG, "esp_ota_write failed: %s", esp_err_to_name(err));
      result = err == ESP_ERR_OTA_VALIDATE_FAILED ? OTA_ERR_INTERNAL : OTA_ERR_FLASH_ERROR;
      goto done;
    }
    int pct = ota_percent(received, cmd->size);
    if (ota_progress_should_publish(&progress, pct, esp_timer_get_time() / 1000)) {
      transition(cmd, OTA_ST_DOWNLOADING, pct);
      if (pct >= 50 && !heap_logged) {
        log_heap("halfway through the download");
        heap_logged = true;
      }
    }
  }
  log_heap("after the download");
  esp_http_client_close(client);
  esp_http_client_cleanup(client); /* frees the connection before the flash work below */
  client = NULL;

  transition(cmd, OTA_ST_VERIFYING, -1);
  uint8_t digest[32];
  size_t digest_len = 0;
  char hex[OTA_SHA256_HEX_LEN + 1];
  psa_status_t ps = psa_hash_finish(&hash, digest, sizeof(digest), &digest_len);
  hash_open = false;
  if (ps != PSA_SUCCESS || digest_len != sizeof(digest)) {
    result = OTA_ERR_INTERNAL;
    goto done;
  }
  ota_hex_from_digest(digest, hex);
  ota_error_t verdict = ota_verify_image(received, cmd->size, hex, cmd->sha256);
  if (verdict != OTA_ERR_NONE) {
    ESP_LOGE(TAG, "Image rejected (%s): received %llu bytes, sha256 %s", ota_error_code(verdict),
             (unsigned long long)received, hex);
    result = verdict;
    goto done;
  }
  err = esp_ota_end(ota); /* validates the image header and app descriptor */
  ota_open = false;
  if (err != ESP_OK) {
    ESP_LOGE(TAG, "esp_ota_end failed: %s", esp_err_to_name(err));
    result = err == ESP_ERR_OTA_VALIDATE_FAILED ? OTA_ERR_INTERNAL : OTA_ERR_FLASH_ERROR;
    goto done;
  }
  result = OTA_ERR_NONE;

done:
  if (hash_open) psa_hash_abort(&hash);
  if (ota_open) esp_ota_abort(ota);
  if (client != NULL) {
    esp_http_client_close(client);
    esp_http_client_cleanup(client);
  }
  free(buf);
  return result;
}

/* Returns only on failure; on success the device restarts. */
static ota_error_t run_update(const ota_command_t *cmd) {
  const esp_partition_t *part = esp_ota_get_next_update_partition(NULL);
  if (part == NULL || slot_of(part) < 0) return OTA_ERR_NO_OTA_PARTITION;
  if (cmd->size > part->size) return OTA_ERR_IMAGE_TOO_LARGE;

  ESP_LOGI(TAG, "Update %s: %s -> %s into %s (%u of %u bytes) from %s", cmd->request_id, s_running_version,
           cmd->version, part->label, (unsigned)cmd->size, (unsigned)part->size,
           ota_url_is_https(cmd->url) ? "https" : "http");
  log_heap("before the download");

  ota_error_t err = download_and_flash(cmd, part);
  if (err != OTA_ERR_NONE) return err;

  transition(cmd, OTA_ST_INSTALLING, -1);

  ota_marker_t marker;
  memset(&marker, 0, sizeof(marker));
  strlcpy(marker.request_id, cmd->request_id, sizeof(marker.request_id));
  strlcpy(marker.target_version, cmd->version, sizeof(marker.target_version));
  strlcpy(marker.previous_version, s_running_version, sizeof(marker.previous_version));
  marker.target_slot = slot_of(part);
  if (!marker_store(&marker)) return OTA_ERR_FLASH_ERROR;

  esp_err_t e = esp_ota_set_boot_partition(part);
  if (e != ESP_OK) {
    ESP_LOGE(TAG, "esp_ota_set_boot_partition failed: %s", esp_err_to_name(e));
    marker_erase();
    return OTA_ERR_FLASH_ERROR;
  }

  transition(cmd, OTA_ST_REBOOTING, -1);
  ESP_LOGI(TAG, "Image installed in %s: rebooting (stack high-water mark %u bytes)", part->label,
           (unsigned)uxTaskGetStackHighWaterMark(NULL));
  vTaskDelay(pdMS_TO_TICKS(OTA_REBOOT_DELAY_MS));
  esp_restart();
  return OTA_ERR_NONE; /* not reached */
}

static void ota_task(void *arg) {
  ota_command_t *cmd = (ota_command_t *)arg;
  ota_error_t err = run_update(cmd);
  fail(cmd, err);
  ESP_LOGI(TAG, "Update task done (stack high-water mark %u bytes)",
           (unsigned)uxTaskGetStackHighWaterMark(NULL));
  log_heap("after the update task");
  free(cmd);
  vTaskDelete(NULL);
}

/* ------------------------------------------------------------------ */
/* command handling (MQTT task)                                        */
/* ------------------------------------------------------------------ */

void ota_manager_handle_command(const char *payload) {
  if (!s_initialized || payload == NULL) return;

  ota_command_t *cmd = malloc(sizeof(*cmd));
  if (cmd == NULL) {
    ESP_LOGE(TAG, "No memory to process ota/command");
    return;
  }
  ota_parse_t pr = ota_parse_command(payload, cmd);
  if (pr == OTA_PARSE_UNREADABLE) {
    ESP_LOGW(TAG, "ota/command ignored: unreadable message");
    free(cmd);
    return;
  }

  const esp_partition_t *next = esp_ota_get_next_update_partition(NULL);
  ota_env_t env = {.running_version = s_running_version,
                   /* the new image must be validated (and its final status sent) first */
                   .device_busy = s_validation_pending,
                   .slot_size = next != NULL ? (uint32_t)next->size : 0};
  xSemaphoreTake(s_lock, portMAX_DELAY);
  ota_decision_t d = ota_decide(&s_tracker, cmd, pr == OTA_PARSE_OK, env);
  ota_status_t st;
  switch (d.action) {
  case OTA_ACT_REPLAY:
    st = *ota_tracker_find(&s_tracker, cmd->request_id); /* the last status of that request */
    break;
  case OTA_ACT_REJECT:
    st = record_locked(cmd->request_id, cmd->version, OTA_ST_REJECTED, d.error, -1);
    break;
  case OTA_ACT_ACCEPT:
  default:
    st = record_locked(cmd->request_id, cmd->version, OTA_ST_ACCEPTED, OTA_ERR_NONE, -1);
    break;
  }
  xSemaphoreGive(s_lock);

  if (d.action == OTA_ACT_REPLAY) {
    ESP_LOGI(TAG, "ota/command %s already handled: replaying its last status (%s)", cmd->request_id,
             ota_state_name(st.state));
    publish_status(&st);
    free(cmd);
    return;
  }
  if (d.action == OTA_ACT_REJECT) {
    ESP_LOGW(TAG, "ota/command %s rejected: %s", cmd->request_id, ota_error_code(d.error));
    publish_status(&st);
    free(cmd);
    return;
  }

  publish_status(&st);
  bool https = ota_url_is_https(cmd->url);
  uint32_t free_heap = (uint32_t)heap_caps_get_free_size(MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT);
  uint32_t largest = (uint32_t)heap_caps_get_largest_free_block(MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT);
  if (!ota_memory_ok(https, free_heap, largest)) {
    ESP_LOGE(TAG, "Not enough heap for an %s download: free %u, largest block %u", https ? "https" : "http",
             (unsigned)free_heap, (unsigned)largest);
    fail(cmd, OTA_ERR_NO_MEMORY);
    free(cmd);
    return;
  }
  if (xTaskCreate(ota_task, "ota_update", https ? OTA_TASK_STACK_HTTPS : OTA_TASK_STACK_HTTP, cmd,
                  OTA_TASK_PRIORITY, NULL) != pdPASS) {
    ESP_LOGE(TAG, "Could not start the update task");
    fail(cmd, OTA_ERR_NO_MEMORY);
    free(cmd);
  }
}

/* ------------------------------------------------------------------ */
/* boot after an update                                                */
/* ------------------------------------------------------------------ */

/* Publishes the final status once the image is validated and the broker is
 * there; then the marker goes away. s_final_lock is never held while
 * publishing: on_connected() runs in the MQTT task, which holds the client
 * lock that a publish from the validation task needs. */
static void try_publish_final(void) {
  xSemaphoreTake(s_final_lock, portMAX_DELAY);
  bool go = s_final_pending && s_final_ready && !s_final_sending;
  ota_status_t copy = s_final;
  if (go) s_final_sending = true;
  xSemaphoreGive(s_final_lock);
  if (!go) return;

  bool sent = publish_raw(&copy);
  xSemaphoreTake(s_final_lock, portMAX_DELAY);
  s_final_sending = false;
  if (sent) s_final_pending = false;
  xSemaphoreGive(s_final_lock);
  if (sent) {
    marker_erase();
    ESP_LOGI(TAG, "Final status %s published, marker cleared", ota_state_name(copy.state));
  }
}

void ota_manager_on_connected(void) {
  if (!s_initialized) return;
  xSemaphoreTake(s_lock, portMAX_DELAY);
  const ota_status_t *last = s_unsent ? ota_tracker_find(&s_tracker, s_unsent_id) : NULL;
  ota_status_t copy;
  memset(&copy, 0, sizeof(copy));
  if (last != NULL) copy = *last;
  s_unsent = false;
  xSemaphoreGive(s_lock);
  if (last != NULL) publish_status(&copy);
  try_publish_final();
}

static ota_img_state_t running_image_state(void) {
  esp_ota_img_states_t st;
  if (esp_ota_get_state_partition(esp_ota_get_running_partition(), &st) != ESP_OK) {
    return OTA_IMG_UNDEFINED; /* flashed by cable: otadata erased */
  }
  switch (st) {
  case ESP_OTA_IMG_NEW: return OTA_IMG_NEW;
  case ESP_OTA_IMG_PENDING_VERIFY: return OTA_IMG_PENDING_VERIFY;
  case ESP_OTA_IMG_VALID: return OTA_IMG_VALID;
  case ESP_OTA_IMG_INVALID:
  case ESP_OTA_IMG_ABORTED: return OTA_IMG_INVALID;
  default: return OTA_IMG_UNDEFINED;
  }
}

/* Wi-Fi + MQTT within OTA_VALIDATE_TIMEOUT_S of boot, else back to the previous image. */
static void validate_task(void *arg) {
  (void)arg;
  while (true) {
    int64_t elapsed_s = esp_timer_get_time() / 1000000;
    ota_validation_t v = ota_validation_step(wifi_manager_is_connected(), mqtt_manager_is_connected(), elapsed_s);
    if (v == OTA_VALIDATION_OK) {
      esp_err_t err = esp_ota_mark_app_valid_cancel_rollback();
      if (err != ESP_OK) {
        ESP_LOGE(TAG, "Marking the image valid failed: %s", esp_err_to_name(err));
      } else {
        ESP_LOGI(TAG, "New image validated after %lld s", (long long)elapsed_s);
      }
      s_validation_pending = false;
      xSemaphoreTake(s_final_lock, portMAX_DELAY);
      s_final_ready = true;
      xSemaphoreGive(s_final_lock);
      try_publish_final();
      break;
    }
    if (v == OTA_VALIDATION_ROLLBACK) {
      ESP_LOGE(TAG, "The new image did not reach the broker within %d s: rolling back", OTA_VALIDATE_TIMEOUT_S);
      esp_ota_mark_app_invalid_rollback_and_reboot();
      ESP_LOGE(TAG, "Rollback failed; the image stays pending");
      break;
    }
    vTaskDelay(pdMS_TO_TICKS(1000));
  }
  vTaskDelete(NULL);
}

esp_err_t ota_manager_init(const char *serial) {
  if (s_initialized) return ESP_OK;

  s_topic_status[0] = '\0';
  if (serial != NULL && serial[0] != '\0') {
    snprintf(s_topic_status, sizeof(s_topic_status), "iot/devices/%s/ota/status", serial);
  }
  const esp_app_desc_t *desc = esp_app_get_description();
  strlcpy(s_running_version, (desc != NULL && desc->version[0] != '\0') ? desc->version : "unknown",
          sizeof(s_running_version));

  s_lock = xSemaphoreCreateMutex();
  s_final_lock = xSemaphoreCreateMutex();
  if (s_lock == NULL || s_final_lock == NULL) return ESP_ERR_NO_MEM;
  ota_tracker_init(&s_tracker);

  int slot = slot_of(esp_ota_get_running_partition());
  ota_marker_t marker;
  bool has_marker = marker_load(&marker);
  ota_boot_plan_t plan = ota_boot_decide(has_marker ? &marker : NULL, s_running_version, slot,
                                         running_image_state());
  ESP_LOGI(TAG, "Running %s (slot %d), marker %s, validate=%d report=%d", s_running_version, slot,
           has_marker ? marker.request_id : "none", (int)plan.validate, (int)plan.report);

  if (has_marker && plan.clear_marker) marker_erase();

  s_initialized = true; /* the tracker and the status path are usable from here */

  if (has_marker && plan.report) {
    s_final_pending = true;
    s_final_ready = !plan.validate;
    xSemaphoreTake(s_lock, portMAX_DELAY);
    /* A redelivered command for this request replays the final status. */
    s_final = record_locked(marker.request_id, marker.target_version, plan.state, plan.error, -1);
    xSemaphoreGive(s_lock);
    if (plan.state == OTA_ST_ROLLED_BACK) {
      ESP_LOGW(TAG, "Update %s to %s rolled back: running %s again", marker.request_id, marker.target_version,
               s_running_version);
    }
  }
  if (plan.validate) {
    s_validation_pending = true;
    if (xTaskCreate(validate_task, "ota_validate", OTA_VALIDATE_TASK_STACK, NULL, OTA_TASK_PRIORITY, NULL) !=
        pdPASS) {
      s_validation_pending = false;
      ESP_LOGE(TAG, "Could not start the validation task; the bootloader will roll back");
    }
  }
  return ESP_OK;
}
