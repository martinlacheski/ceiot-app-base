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
#include "esp_random.h"
#include "esp_system.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "freertos/task.h"
#include "mqtt_manager.h"
#include "nvs.h"
#include "ota_logic.h"
#include "ota_remote.h"
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
static char s_topic_check[88];
static char s_topic_request[88];
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

/* Updates started from the device (web UI). Never held while publishing:
 * ota_manager_handle_available() takes it in the MQTT task, which holds the
 * client lock a publish needs. */
static SemaphoreHandle_t s_remote_lock = NULL;
static ota_remote_t s_remote;
static volatile bool s_switch_pending = false; /* boot partition switched, restart pending */

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
                   .device_busy = s_validation_pending || s_switch_pending,
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

static ota_img_state_t image_state(const esp_partition_t *part) {
  esp_ota_img_states_t st;
  if (part == NULL || esp_ota_get_state_partition(part, &st) != ESP_OK) {
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

void ota_manager_set_serial(const char *serial) {
  if (serial != NULL && serial[0] != '\0') {
    snprintf(s_topic_status, sizeof(s_topic_status), "iot/devices/%s/ota/status", serial);
    snprintf(s_topic_check, sizeof(s_topic_check), "iot/devices/%s/ota/check", serial);
    snprintf(s_topic_request, sizeof(s_topic_request), "iot/devices/%s/ota/request", serial);
  } else {
    s_topic_status[0] = '\0';
    s_topic_check[0] = '\0';
    s_topic_request[0] = '\0';
  }
}

esp_err_t ota_manager_init(const char *serial) {
  if (s_initialized) return ESP_OK;

  ota_manager_set_serial(serial);
  const esp_app_desc_t *desc = esp_app_get_description();
  strlcpy(s_running_version, (desc != NULL && desc->version[0] != '\0') ? desc->version : "unknown",
          sizeof(s_running_version));

  s_lock = xSemaphoreCreateMutex();
  s_final_lock = xSemaphoreCreateMutex();
  s_remote_lock = xSemaphoreCreateMutex();
  if (s_lock == NULL || s_final_lock == NULL || s_remote_lock == NULL) return ESP_ERR_NO_MEM;
  ota_tracker_init(&s_tracker);
  ota_remote_init(&s_remote);

  int slot = slot_of(esp_ota_get_running_partition());
  ota_marker_t marker;
  bool has_marker = marker_load(&marker);
  ota_boot_plan_t plan = ota_boot_decide(has_marker ? &marker : NULL, s_running_version, slot,
                                         image_state(esp_ota_get_running_partition()));
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

/* ------------------------------------------------------------------ */
/* updates started from the device (web UI)                            */
/* ------------------------------------------------------------------ */

static int64_t now_ms(void) { return esp_timer_get_time() / 1000; }

static void new_request_id(char *out, size_t size, const char *prefix) {
  uint32_t rnd[4] = {esp_random(), esp_random(), esp_random(), esp_random()};
  if (!ota_make_request_id(out, size, prefix, rnd)) out[0] = '\0';
}

/* An update in flight, or the running image still to be validated. */
static bool device_busy(void) {
  xSemaphoreTake(s_lock, portMAX_DELAY);
  bool updating = ota_tracker_active(&s_tracker) != NULL;
  xSemaphoreGive(s_lock);
  return updating || s_validation_pending || s_switch_pending;
}

/* The partition the next update overwrites, and what it holds. */
static void other_slot(ota_prev_candidate_t *c, const esp_partition_t **part_out) {
  memset(c, 0, sizeof(*c));
  c->slot = -1;
  c->state = OTA_IMG_UNDEFINED;
  const esp_partition_t *next = esp_ota_get_next_update_partition(NULL);
  if (part_out != NULL) *part_out = next;
  c->slot = slot_of(next);
  if (c->slot < 0) return;
  esp_app_desc_t desc;
  if (esp_ota_get_partition_description(next, &desc) == ESP_OK && desc.version[0] != '\0') {
    c->readable = true;
    strlcpy(c->version, desc.version, sizeof(c->version));
  }
  c->state = image_state(next);
}

/* Keeps the question in step with the OTA client: the backend's ota/command
 * carries the request id the device asked with. Call with s_remote_lock held. */
static void remote_sync_locked(void) {
  ota_remote_step(&s_remote, now_ms());
  if (s_remote.phase != OTA_REMOTE_REQUESTING && s_remote.phase != OTA_REMOTE_UPDATING) return;
  ota_status_t st;
  bool found = false;
  xSemaphoreTake(s_lock, portMAX_DELAY);
  const ota_status_t *tracked = ota_tracker_find(&s_tracker, s_remote.request_id);
  if (tracked != NULL) {
    st = *tracked;
    found = true;
  }
  xSemaphoreGive(s_lock);
  if (found) ota_remote_on_status(&s_remote, &st, now_ms());
}

void ota_manager_get_local_view(ota_local_view_t *out) {
  memset(out, 0, sizeof(*out));
  ota_remote_init(&out->remote);
  out->running_slot = -1;
  out->other.slot = -1;
  out->mqtt_connected = mqtt_manager_is_connected();
  if (!s_initialized) return;

  strlcpy(out->running_version, s_running_version, sizeof(out->running_version));
  const esp_partition_t *running = esp_ota_get_running_partition();
  out->running_slot = slot_of(running);
  if (running != NULL) strlcpy(out->running_label, running->label, sizeof(out->running_label));
  out->validation_pending = s_validation_pending;

  const esp_partition_t *next = NULL;
  other_slot(&out->other, &next);
  if (next != NULL) strlcpy(out->other_label, next->label, sizeof(out->other_label));
  out->other_reason = ota_prev_decide(&out->other, s_running_version);

  xSemaphoreTake(s_remote_lock, portMAX_DELAY);
  remote_sync_locked();
  out->remote = s_remote;
  xSemaphoreGive(s_remote_lock);

  xSemaphoreTake(s_lock, portMAX_DELAY);
  const ota_status_t *active = ota_tracker_active(&s_tracker);
  if (active != NULL) {
    out->has_active = true;
    out->active = *active;
  }
  if (s_tracker.count > 0) { /* the newest request is the last entry */
    out->has_last = true;
    out->last = s_tracker.entries[s_tracker.count - 1];
  }
  xSemaphoreGive(s_lock);
}

/* Publishes the question just opened; a failed publish closes it with an error. */
static ota_local_result_t publish_question(const char *topic, const char *payload) {
  if (mqtt_manager_publish(topic, payload, OTA_TOPIC_QOS, false) == ESP_OK) {
    ESP_LOGI(TAG, "%s sent: %s", topic, payload);
    return OTA_LOCAL_OK;
  }
  ESP_LOGW(TAG, "%s not published", topic);
  xSemaphoreTake(s_remote_lock, portMAX_DELAY);
  ota_remote_fail(&s_remote, "publish_failed", "No se pudo enviar la consulta a la plataforma");
  xSemaphoreGive(s_remote_lock);
  return OTA_LOCAL_FAILED;
}

ota_local_result_t ota_manager_check(void) {
  if (!s_initialized || s_topic_check[0] == '\0' || !mqtt_manager_is_connected()) return OTA_LOCAL_OFFLINE;
  char id[OTA_ID_MAX];
  new_request_id(id, sizeof(id), NULL);
  if (id[0] == '\0') return OTA_LOCAL_FAILED;
  char buf[OTA_REMOTE_PAYLOAD_MAX];
  if (ota_build_check(buf, sizeof(buf), id, s_running_version) == 0) return OTA_LOCAL_FAILED;

  xSemaphoreTake(s_remote_lock, portMAX_DELAY);
  remote_sync_locked();
  bool started = ota_remote_begin_check(&s_remote, id, now_ms());
  xSemaphoreGive(s_remote_lock);
  if (!started) return OTA_LOCAL_BUSY;
  return publish_question(s_topic_check, buf);
}

ota_local_result_t ota_manager_request(void) {
  if (!s_initialized || s_topic_request[0] == '\0' || !mqtt_manager_is_connected()) {
    return OTA_LOCAL_OFFLINE;
  }
  if (device_busy()) return OTA_LOCAL_BUSY;
  char id[OTA_ID_MAX];
  new_request_id(id, sizeof(id), NULL);
  if (id[0] == '\0') return OTA_LOCAL_FAILED;

  xSemaphoreTake(s_remote_lock, portMAX_DELAY);
  remote_sync_locked();
  bool asking = ota_remote_is_busy(&s_remote);
  bool started = ota_remote_begin_request(&s_remote, id, now_ms());
  char version[OTA_VERSION_MAX];
  strlcpy(version, s_remote.version, sizeof(version));
  xSemaphoreGive(s_remote_lock);
  if (!started) return asking ? OTA_LOCAL_BUSY : OTA_LOCAL_NOTHING;

  char buf[OTA_REMOTE_PAYLOAD_MAX];
  if (ota_build_request(buf, sizeof(buf), id, version, s_running_version) == 0) {
    xSemaphoreTake(s_remote_lock, portMAX_DELAY);
    ota_remote_fail(&s_remote, "internal", "No se pudo armar el pedido");
    xSemaphoreGive(s_remote_lock);
    return OTA_LOCAL_FAILED;
  }
  return publish_question(s_topic_request, buf);
}

void ota_manager_handle_available(const char *payload) {
  if (!s_initialized || payload == NULL) return;
  ota_available_t answer;
  if (!ota_parse_available(payload, &answer)) {
    ESP_LOGW(TAG, "ota/available ignored: unreadable message");
    return;
  }
  xSemaphoreTake(s_remote_lock, portMAX_DELAY);
  bool mine = ota_remote_on_available(&s_remote, &answer, now_ms());
  xSemaphoreGive(s_remote_lock);
  if (!mine) {
    ESP_LOGI(TAG, "ota/available %s is not the awaited answer: ignored", answer.request_id);
    return;
  }
  ESP_LOGI(TAG, "ota/available %s: version %s%s%s", answer.request_id,
           answer.has_version ? answer.version : "none", answer.has_error ? ", error " : "",
           answer.has_error ? answer.error_code : "");
}

ota_local_result_t ota_manager_switch_slot(char *version, size_t size) {
  if (version != NULL && size > 0) version[0] = '\0';
  if (!s_initialized) return OTA_LOCAL_FAILED;
  xSemaphoreTake(s_remote_lock, portMAX_DELAY);
  remote_sync_locked();
  bool asking = ota_remote_is_busy(&s_remote);
  xSemaphoreGive(s_remote_lock);
  if (asking || device_busy()) return OTA_LOCAL_BUSY;

  ota_prev_candidate_t other;
  const esp_partition_t *part = NULL;
  other_slot(&other, &part);
  if (part == NULL || ota_prev_decide(&other, s_running_version) != OTA_PREV_OFFER) {
    ESP_LOGW(TAG, "Switch refused: no valid image of another version in the other slot");
    return OTA_LOCAL_NOTHING;
  }
  char id[OTA_ID_MAX];
  new_request_id(id, sizeof(id), OTA_SWITCH_PREFIX);
  if (id[0] == '\0') return OTA_LOCAL_FAILED;

  s_switch_pending = true; /* ota/command is answered busy from here */
  ota_marker_t marker;
  ota_switch_marker(&marker, id, &other, s_running_version);
  if (!marker_store(&marker)) {
    s_switch_pending = false;
    return OTA_LOCAL_FAILED;
  }
  esp_err_t err = esp_ota_set_boot_partition(part); /* verifies the whole image first */
  if (err != ESP_OK) {
    ESP_LOGE(TAG, "Switch to %s failed: %s", part->label, esp_err_to_name(err));
    marker_erase();
    s_switch_pending = false;
    return OTA_LOCAL_FAILED;
  }
  ESP_LOGI(TAG, "Boot partition switched to %s (%s), request %s: restart pending", part->label,
           other.version, id);
  if (version != NULL) strlcpy(version, other.version, size);
  return OTA_LOCAL_OK;
}
