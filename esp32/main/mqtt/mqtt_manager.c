#include "mqtt_manager.h"

#include "cJSON.h"
#include "esp_event.h"
#include "esp_heap_caps.h"
#include "esp_log.h"
#include "esp_system.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "freertos/task.h"
#include "led_manager.h"
#include "telemetry.h"
#include "telemetry_payload.h"
#include "time_sync.h"
#include "mqtt_client.h"
#include "mqtt_config_logic.h"
#include "network_manager.h"
#include "nvs.h"
#include "nvs_flash.h"
#include "ota_logic.h"
#include "ota_manager.h"
#include "wifi_manager.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

static const char *TAG = "MQTT_MGR";
#define MQTT_TEST_TIMEOUT_SEC 10
// Contract QoS (tools/emulador-dispositivo.py): telemetry, status and
// subscriptions all use QoS 1.
#define MQTT_QOS 1

static esp_mqtt_client_handle_t s_client = NULL;
static bool s_connected = false;
static char *s_root_ca = NULL;
static char *s_client_cert = NULL;
static char *s_client_key = NULL;
static char s_lwt_msg[128] = "{\"serial\":\"\",\"status\":\"offline\"}";
static char s_topic_telemetry[80];
static char s_topic_ota_command[88];
static char s_topic_status[72];
static char s_topic_time[72];
static char s_topic_time_request[80];
static TaskHandle_t s_start_task = NULL;
static SemaphoreHandle_t s_status_lock = NULL;
static bool s_test_pending = false;
static bool s_test_success = false;
static int64_t s_test_start_us = 0;
static char s_last_event[32] = "init";
static char s_last_error[96] = "";
static int s_last_error_type = 0;
static int s_last_transport_sock_errno = 0;
static int s_last_tls_stack_err = 0;
static int s_last_esp_tls_err = 0;
static char s_cached_serial[32] = "";
static char s_broker_host[128] = "";
static int s_broker_port = 0;
static bool s_use_tls = false;
// ota/command reassembly: esp-mqtt hands a payload larger than its buffer in
// several MQTT_EVENT_DATA chunks, only the first one carrying the topic.
static char *s_ota_rx = NULL;
static int s_ota_rx_total = 0;

static esp_err_t open_nvs(const char *ns, nvs_open_mode_t mode,
                          nvs_handle_t *handle) {
  esp_err_t err = nvs_open_from_partition("nvs", ns, mode, handle);
  if (err != ESP_ERR_NVS_NOT_INITIALIZED && err != ESP_ERR_NVS_PART_NOT_FOUND) {
    return err;
  }
  esp_err_t init_err = nvs_flash_init_partition("nvs");
  if (init_err != ESP_OK && init_err != ESP_ERR_NVS_INVALID_STATE) return err;
  return nvs_open_from_partition("nvs", ns, mode, handle);
}

static void set_event(const char *event) {
  if (s_status_lock == NULL) return;
  xSemaphoreTake(s_status_lock, portMAX_DELAY);
  strlcpy(s_last_event, event ? event : "", sizeof(s_last_event));
  xSemaphoreGive(s_status_lock);
}

static void set_error(const char *error, int type, int socket_errno,
                      int tls_error, int esp_tls_error) {
  if (s_status_lock == NULL) return;
  xSemaphoreTake(s_status_lock, portMAX_DELAY);
  strlcpy(s_last_error, error ? error : "", sizeof(s_last_error));
  s_last_error_type = type;
  s_last_transport_sock_errno = socket_errno;
  s_last_tls_stack_err = tls_error;
  s_last_esp_tls_err = esp_tls_error;
  xSemaphoreGive(s_status_lock);
}

static void clear_error(void) { set_error("", 0, 0, 0, 0); }

static char *read_file(const char *path) {
  FILE *file = fopen(path, "r");
  if (file == NULL) return NULL;
  fseek(file, 0, SEEK_END);
  long length = ftell(file);
  fseek(file, 0, SEEK_SET);
  if (length < 0) {
    fclose(file);
    return NULL;
  }
  char *buffer = malloc((size_t)length + 1);
  if (buffer != NULL) {
    size_t read = fread(buffer, 1, (size_t)length, file);
    buffer[read] = '\0';
  }
  fclose(file);
  return buffer;
}

static void get_serial(char *output, size_t size) {
  if (output == NULL || size == 0) return;
  output[0] = '\0';

  nvs_handle_t handle;
  if (open_nvs("storage", NVS_READONLY, &handle) == ESP_OK) {
    size_t length = size;
    if (nvs_get_str(handle, "serial", output, &length) != ESP_OK) output[0] = '\0';
    nvs_close(handle);
  }
  if (output[0] == '\0' && open_nvs("factory", NVS_READONLY, &handle) == ESP_OK) {
    size_t length = size;
    if (nvs_get_str(handle, "serial", output, &length) != ESP_OK) output[0] = '\0';
    nvs_close(handle);
  }
  if (output[0] != '\0') {
    strlcpy(s_cached_serial, output, sizeof(s_cached_serial));
  } else if (s_cached_serial[0] != '\0') {
    strlcpy(output, s_cached_serial, size);
  }
}

static void build_topics(const char *serial) {
  const char *identity = (serial && serial[0]) ? serial : "unassigned";
  snprintf(s_topic_telemetry, sizeof(s_topic_telemetry),
           "iot/devices/%s/telemetry", identity);
  snprintf(s_topic_ota_command, sizeof(s_topic_ota_command),
           "iot/devices/%s/ota/command", identity);
  snprintf(s_topic_status, sizeof(s_topic_status), "iot/devices/%s/status",
           identity);
  snprintf(s_topic_time, sizeof(s_topic_time), "iot/devices/%s/time",
           identity);
  snprintf(s_topic_time_request, sizeof(s_topic_time_request),
           "iot/devices/%s/time/request", identity);
}

static void build_lwt(void) {
  char serial[32] = "";
  get_serial(serial, sizeof(serial));
  char *json = telemetry_presence_build(serial, false);
  if (json != NULL) {
    strlcpy(s_lwt_msg, json, sizeof(s_lwt_msg));
    free(json);
  }
}

// Retained "online" presence, published on every (re)connection; the broker
// replaces it with the retained Last Will ("offline") when the link drops.
static esp_err_t publish_online(void) {
  char serial[32] = "";
  get_serial(serial, sizeof(serial));
  char *json = telemetry_presence_build(serial, true);
  if (json == NULL) return ESP_ERR_NO_MEM;
  int msg_id =
      esp_mqtt_client_publish(s_client, s_topic_status, json, 0, MQTT_QOS, 1);
  free(json);
  return msg_id >= 0 ? ESP_OK : ESP_FAIL;
}

// Collects iot/devices/{serial}/ota/command (possibly in several chunks) and
// hands the complete, NUL-terminated payload to the OTA client.
static void handle_ota_command_chunk(esp_mqtt_event_handle_t event) {
  if (event->current_data_offset == 0) {
    free(s_ota_rx);
    s_ota_rx = NULL;
    bool is_command = event->topic_len == (int)strlen(s_topic_ota_command) &&
                      strncmp(event->topic, s_topic_ota_command,
                              event->topic_len) == 0;
    if (!is_command) return;
    if (event->total_data_len <= 0 ||
        event->total_data_len > OTA_COMMAND_MAX) {
      ESP_LOGW(TAG, "ota/command ignored: %d bytes", event->total_data_len);
      return;
    }
    s_ota_rx_total = event->total_data_len;
    s_ota_rx = malloc((size_t)s_ota_rx_total + 1);
    if (s_ota_rx == NULL) {
      ESP_LOGE(TAG, "No memory for ota/command");
      return;
    }
  }
  if (s_ota_rx == NULL) return;
  int end = event->current_data_offset + event->data_len;
  if (event->current_data_offset < 0 || end > s_ota_rx_total) {
    free(s_ota_rx);
    s_ota_rx = NULL;
    return;
  }
  memcpy(s_ota_rx + event->current_data_offset, event->data, event->data_len);
  if (end == s_ota_rx_total) {
    s_ota_rx[s_ota_rx_total] = '\0';
    ota_manager_handle_command(s_ota_rx);
    free(s_ota_rx);
    s_ota_rx = NULL;
  }
}

static void mqtt_event_handler(void *args, esp_event_base_t base,
                               int32_t event_id, void *event_data) {
  (void)args;
  (void)base;
  esp_mqtt_event_handle_t event = event_data;

  switch ((esp_mqtt_event_id_t)event_id) {
  case MQTT_EVENT_CONNECTED:
    s_connected = true;
    set_event("connected");
    clear_error();
    led_set_mqtt_connected(true);
    // Subscriptions on every (re)connection: the session is clean.
    esp_mqtt_client_subscribe(event->client, s_topic_ota_command, MQTT_QOS);
    esp_mqtt_client_subscribe(event->client, s_topic_time, MQTT_QOS);
    if (publish_online() != ESP_OK) {
      ESP_LOGW(TAG, "Could not publish the online status");
    }
    telemetry_request_now();
    ota_manager_on_connected(); // unsent status + final report of an update
    break;
  case MQTT_EVENT_DISCONNECTED:
    s_connected = false;
    set_event("disconnected");
    led_set_mqtt_connected(false);
    break;
  case MQTT_EVENT_SUBSCRIBED:
    set_event("subscribed");
    break;
  case MQTT_EVENT_PUBLISHED:
    set_event("published");
    break;
  case MQTT_EVENT_DATA:
    set_event("data");
    ESP_LOGI(TAG, "MQTT message received on %.*s", event->topic_len,
             event->topic);
    if (event->topic_len == (int)strlen(s_topic_time) &&
        strncmp(event->topic, s_topic_time, event->topic_len) == 0 &&
        event->current_data_offset == 0 &&
        event->data_len == event->total_data_len) {
      time_sync_on_mqtt_time(event->data, event->data_len);
    }
    handle_ota_command_chunk(event);
    break;
  case MQTT_EVENT_ERROR:
    set_event("error");
    if (event->error_handle->error_type == MQTT_ERROR_TYPE_TCP_TRANSPORT) {
      set_error("TCP transport error", event->error_handle->error_type,
                event->error_handle->esp_transport_sock_errno,
                event->error_handle->esp_tls_stack_err,
                event->error_handle->esp_tls_last_esp_err);
    } else {
      set_error("MQTT error", event->error_handle->error_type, 0, 0, 0);
    }
    break;
  default:
    break;
  }
}

// Waits for an IP and for the time fallback to allow it: a valid clock, or NTP
// timed out and the HTTP bootstrap was tried (time_sync_logic.h). Never
// blocks forever on NTP.
static bool data_path_ready(void) {
  return network_manager_has_data_path() && time_sync_mqtt_ready();
}

static void start_task(void *arg) {
  (void)arg;
  while (!data_path_ready()) {
    set_event(network_manager_has_data_path() ? "waiting_time" : "waiting_network");
    vTaskDelay(pdMS_TO_TICKS(1000));
  }

  esp_err_t err = esp_mqtt_client_start(s_client);
  if (err == ESP_OK || err == ESP_ERR_INVALID_STATE) {
    set_event("start_requested");
  } else {
    set_error(esp_err_to_name(err), err, 0, 0, 0);
  }
  s_start_task = NULL;
  vTaskDelete(NULL);
}

// Reads one string key; false when the key (or the namespace) is missing.
static bool read_str(const char *ns, const char *key, char *out, size_t size) {
  out[0] = '\0';
  nvs_handle_t handle;
  if (open_nvs(ns, NVS_READONLY, &handle) != ESP_OK) return false;
  size_t length = size;
  bool ok = nvs_get_str(handle, key, out, &length) == ESP_OK;
  nvs_close(handle);
  if (!ok) out[0] = '\0';
  return ok;
}

// A brand-new device has no "storage" namespace (ESP_ERR_NVS_NOT_FOUND): the
// defaults of mqtt_config_logic.h apply (mTLS on MQTT_DEFAULT_TLS_PORT to MQTT_DEFAULT_HOST)
// and the serial comes from "storage" or the "factory" snapshot. Without a
// serial there is no client id nor topic identity: ESP_ERR_INVALID_STATE.
static esp_err_t load_config(esp_mqtt_client_config_t *config, char *uri,
                             size_t uri_size) {
  char serial[MQTT_SERIAL_MAX], factory_serial[MQTT_SERIAL_MAX];
  char use_tls[4], host[MQTT_HOST_MAX], port[8];
  mqtt_config_input_t in = {
      .serial = read_str("storage", "serial", serial, sizeof(serial)) ? serial : NULL,
      .factory_serial = read_str("factory", "serial", factory_serial,
                                 sizeof(factory_serial))
                            ? factory_serial
                            : NULL,
      .use_tls = read_str("storage", "mqtt_use_tls", use_tls, sizeof(use_tls))
                     ? use_tls
                     : NULL,
      .host = read_str("storage", "mqtt_uri", host, sizeof(host)) ? host : NULL,
      .port = read_str("storage", "mqtt_port", port, sizeof(port)) ? port : NULL,
  };
  static mqtt_config_t resolved;
  mqtt_config_resolve(&in, &resolved);

  strlcpy(s_broker_host, resolved.host, sizeof(s_broker_host));
  s_broker_port = resolved.port;
  s_use_tls = resolved.use_tls;
  if (!resolved.has_serial) {
    ESP_LOGE(TAG, "No device serial in NVS (storage/factory): MQTT not "
                  "started. Set it from the web UI (AP %s).",
             wifi_manager_get_ap_ssid());
    return ESP_ERR_INVALID_STATE;
  }
  strlcpy(s_cached_serial, resolved.client_id, sizeof(s_cached_serial));
  config->credentials.client_id = resolved.client_id;
  strlcpy(uri, resolved.uri, uri_size);
  config->broker.address.uri = uri;
  config->broker.address.port = (uint32_t)resolved.port;
  ESP_LOGI(TAG, "Broker %s:%d (%s), client id %s", resolved.host, resolved.port,
           resolved.use_tls ? "mTLS" : "TCP", resolved.client_id);

  build_topics(resolved.client_id);
  build_lwt();
  config->session.last_will.topic = s_topic_status;
  config->session.last_will.msg = s_lwt_msg;
  config->session.last_will.qos = MQTT_QOS;
  config->session.last_will.retain = true;

  if (resolved.use_tls) {
    s_root_ca = read_file("/littlefs/root.crt");
    s_client_cert = read_file("/littlefs/client.crt");
    s_client_key = read_file("/littlefs/client.key");
    if (s_root_ca == NULL || s_client_cert == NULL || s_client_key == NULL) {
      ESP_LOGW(TAG, "mTLS material incomplete in /littlefs (root.crt %s, "
                    "client.crt %s, client.key %s)",
               s_root_ca ? "ok" : "missing", s_client_cert ? "ok" : "missing",
               s_client_key ? "ok" : "missing");
    }
    config->broker.verification.certificate = s_root_ca;
    if (s_client_cert && s_client_key) {
      config->credentials.authentication.certificate = s_client_cert;
      config->credentials.authentication.key = s_client_key;
    }
  }
  return ESP_OK;
}

esp_err_t mqtt_manager_init(void) {
  if (s_client != NULL) return ESP_OK;
  s_status_lock = xSemaphoreCreateMutex();
  if (s_status_lock == NULL) return ESP_ERR_NO_MEM;

  static char uri[160];
  esp_mqtt_client_config_t config = {.broker.address.uri = NULL};
  config.task.stack_size = 8192;
  esp_err_t err = load_config(&config, uri, sizeof(uri));
  if (err != ESP_OK) {
    set_error(err == ESP_ERR_INVALID_STATE ? "Device serial not set"
                                           : "MQTT configuration unavailable",
              err, 0, 0, 0);
    return err;
  }

  s_client = esp_mqtt_client_init(&config);
  if (s_client == NULL) return ESP_FAIL;
  esp_mqtt_client_register_event(s_client, ESP_EVENT_ANY_ID, mqtt_event_handler,
                                 NULL);
  set_event("initialized");
  return ESP_OK;
}

esp_err_t mqtt_manager_start(void) {
  if (s_client == NULL) return ESP_ERR_INVALID_STATE;
  if (s_start_task == NULL) {
    xTaskCreate(start_task, "mqtt_start_task", 3072, NULL, 5, &s_start_task);
  }
  return ESP_OK;
}

esp_err_t mqtt_manager_stop(void) {
  if (s_client == NULL) return ESP_ERR_INVALID_STATE;
  if (s_start_task != NULL) {
    vTaskDelete(s_start_task);
    s_start_task = NULL;
  }
  set_event("stopped");
  return esp_mqtt_client_stop(s_client);
}

bool mqtt_manager_is_connected(void) { return s_connected; }

esp_err_t mqtt_manager_get_status_snapshot(mqtt_status_snapshot_t *snapshot) {
  if (snapshot == NULL) return ESP_ERR_INVALID_ARG;
  memset(snapshot, 0, sizeof(*snapshot));
  snapshot->client_initialized = s_client != NULL;
  snapshot->connected = s_connected;
  snapshot->start_task_running = s_start_task != NULL;
  snapshot->network_ready = network_manager_has_data_path();
  snapshot->time_ready = network_manager_is_time_synced();
  snapshot->test_pending = s_test_pending;
  snapshot->test_success = s_test_success;
  strlcpy(snapshot->host, s_broker_host, sizeof(snapshot->host));
  snapshot->port = s_broker_port;
  snapshot->use_tls = s_use_tls;

  if (s_status_lock != NULL) {
    xSemaphoreTake(s_status_lock, portMAX_DELAY);
    snapshot->last_error_type = s_last_error_type;
    snapshot->transport_sock_errno = s_last_transport_sock_errno;
    snapshot->tls_stack_err = s_last_tls_stack_err;
    snapshot->esp_tls_last_err = s_last_esp_tls_err;
    strlcpy(snapshot->last_event, s_last_event, sizeof(snapshot->last_event));
    strlcpy(snapshot->last_error, s_last_error, sizeof(snapshot->last_error));
    xSemaphoreGive(s_status_lock);
  }
  return ESP_OK;
}

char *mqtt_manager_get_status_json(void) {
  mqtt_status_snapshot_t snapshot;
  mqtt_manager_get_status_snapshot(&snapshot);
  cJSON *root = cJSON_CreateObject();
  cJSON_AddBoolToObject(root, "client_initialized", snapshot.client_initialized);
  cJSON_AddBoolToObject(root, "connected", snapshot.connected);
  cJSON_AddBoolToObject(root, "network_ready", snapshot.network_ready);
  cJSON_AddBoolToObject(root, "time_ready", snapshot.time_ready);
  cJSON_AddStringToObject(root, "last_event", snapshot.last_event);
  cJSON_AddStringToObject(root, "last_error", snapshot.last_error);
  char *json = cJSON_PrintUnformatted(root);
  cJSON_Delete(root);
  return json ? json : strdup("{}");
}

esp_err_t mqtt_manager_publish(const char *topic, const char *data, int qos,
                               bool retain) {
  if (s_client == NULL || !s_connected) return ESP_ERR_INVALID_STATE;
  return esp_mqtt_client_publish(s_client, topic, data, 0, qos, retain) >= 0
             ? ESP_OK
             : ESP_FAIL;
}

esp_err_t mqtt_manager_publish_telemetry(const char *json) {
  return mqtt_manager_publish(s_topic_telemetry, json, MQTT_QOS, false);
}

esp_err_t mqtt_manager_publish_time_request(const char *json) {
  return mqtt_manager_publish(s_topic_time_request, json, MQTT_QOS, false);
}

const char *mqtt_manager_get_serial(void) { return s_cached_serial; }

bool mqtt_manager_start_test(void) {
  if (!s_connected) return false;
  s_test_pending = true;
  s_test_success = false;
  s_test_start_us = esp_timer_get_time();

  // Re-publishes the retained presence: a harmless message that exercises the
  // connection without injecting anything into the telemetry topic.
  s_test_success = publish_online() == ESP_OK;
  s_test_pending = false;
  return s_test_success;
}

void mqtt_manager_get_test_status(bool *pending, bool *success,
                                  int *elapsed_ms) {
  if (pending) *pending = s_test_pending;
  if (success) *success = s_test_success;
  if (elapsed_ms) {
    *elapsed_ms = (int)((esp_timer_get_time() - s_test_start_us) / 1000);
  }
  if (s_test_pending &&
      esp_timer_get_time() - s_test_start_us >
          (int64_t)MQTT_TEST_TIMEOUT_SEC * 1000000LL) {
    s_test_pending = false;
  }
}
