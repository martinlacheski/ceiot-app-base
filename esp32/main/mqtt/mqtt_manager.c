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
#include "mqtt_client.h"
#include "network_manager.h"
#include "nvs.h"
#include "nvs_flash.h"
#include "temp_manager.h"
#include "wifi_manager.h"
#include <ctype.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

static const char *TAG = "MQTT_MGR";
#define MQTT_TEST_TIMEOUT_SEC 10
#define TELEMETRY_INTERVAL_SEC 300

static esp_mqtt_client_handle_t s_client = NULL;
static bool s_connected = false;
static char *s_root_ca = NULL;
static char *s_client_cert = NULL;
static char *s_client_key = NULL;
static int s_qos_telemetry = 0;
static int s_qos_sub = 1;
static char s_lwt_msg[256] = "{\"status\":\"offline\"}";
static char s_topic_telemetry[80];
static char s_topic_ota[72];
static char s_topic_status[72];
static TaskHandle_t s_periodic_task = NULL;
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

static bool is_digits_only(const char *value) {
  if (value == NULL || value[0] == '\0') return false;
  for (const char *p = value; *p; p++) {
    if (!isdigit((unsigned char)*p)) return false;
  }
  return true;
}

static void trim(char *value) {
  if (value == NULL) return;
  size_t len = strlen(value);
  while (len > 0 && isspace((unsigned char)value[len - 1])) value[--len] = '\0';
  char *start = value;
  while (*start && isspace((unsigned char)*start)) start++;
  if (start != value) memmove(value, start, strlen(start) + 1);
}

static void normalize_host(const char *input, char *output, size_t size) {
  if (output == NULL || size == 0) return;
  output[0] = '\0';
  if (input == NULL) return;

  char buffer[128];
  strlcpy(buffer, input, sizeof(buffer));
  trim(buffer);
  const char *start = strstr(buffer, "://");
  start = start ? start + 3 : buffer;
  const char *at = strrchr(start, '@');
  if (at != NULL) start = at + 1;
  const char *end = start + strcspn(start, "/?#");
  size_t length = (size_t)(end - start);
  if (length >= size) length = size - 1;
  memcpy(output, start, length);
  output[length] = '\0';

  if (output[0] != '[') {
    char *first = strchr(output, ':');
    char *last = strrchr(output, ':');
    if (first != NULL && first == last && is_digits_only(last + 1)) *last = '\0';
  }
  trim(output);
}

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
  snprintf(s_topic_ota, sizeof(s_topic_ota), "iot/devices/%s/ota", identity);
  snprintf(s_topic_status, sizeof(s_topic_status), "iot/devices/%s/status",
           identity);
}

static void timestamp(char *output, size_t size) {
  time_t now;
  struct tm local;
  time(&now);
  localtime_r(&now, &local);
  strftime(output, size, "%Y-%m-%d %H:%M:%S", &local);
}

static void build_lwt(void) {
  char serial[32] = "";
  char current_time[32];
  get_serial(serial, sizeof(serial));
  timestamp(current_time, sizeof(current_time));

  cJSON *root = cJSON_CreateObject();
  cJSON_AddStringToObject(root, "serial", serial);
  cJSON_AddStringToObject(root, "status", "offline");
  cJSON_AddStringToObject(root, "datetime", current_time);
  char *json = cJSON_PrintUnformatted(root);
  if (json != NULL) {
    strlcpy(s_lwt_msg, json, sizeof(s_lwt_msg));
    free(json);
  }
  cJSON_Delete(root);
}

static void send_telemetry(void) {
  char serial[32] = "";
  char current_time[32];
  get_serial(serial, sizeof(serial));
  timestamp(current_time, sizeof(current_time));

  cJSON *root = cJSON_CreateObject();
  cJSON_AddStringToObject(root, "serial", serial);
  cJSON_AddStringToObject(root, "datetime", current_time);
  cJSON_AddStringToObject(root, "status", "online");
  cJSON_AddNumberToObject(root, "uptime", esp_timer_get_time() / 1000000);
  cJSON_AddNumberToObject(root, "heap_free", esp_get_free_heap_size());
  cJSON_AddNumberToObject(root, "wifi_rssi", wifi_manager_get_rssi());
  cJSON_AddStringToObject(root, "wifi_ssid", wifi_manager_get_ssid());
  cJSON_AddStringToObject(root, "wifi_ip", wifi_manager_get_ip());

  float temp_c = 0.0f;
  if (temp_manager_get_last_temp(&temp_c)) {
    cJSON_AddNumberToObject(root, "temp_water", temp_c);
  }

  char *json = cJSON_PrintUnformatted(root);
  if (json != NULL) {
    mqtt_manager_publish(s_topic_telemetry, json, s_qos_telemetry);
    free(json);
  }
  cJSON_Delete(root);
}

static void periodic_task(void *arg) {
  (void)arg;
  uint32_t elapsed = 0;
  while (1) {
    if (s_connected && elapsed >= TELEMETRY_INTERVAL_SEC) {
      send_telemetry();
      elapsed = 0;
    }
    vTaskDelay(pdMS_TO_TICKS(1000));
    elapsed++;
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
    esp_mqtt_client_subscribe(event->client, s_topic_ota, s_qos_sub);
    send_telemetry();
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

static bool data_path_ready(void) {
  return network_manager_has_data_path() && network_manager_is_time_synced();
}

static void start_task(void *arg) {
  (void)arg;
  while (!data_path_ready()) {
    set_event("waiting_network");
    vTaskDelay(pdMS_TO_TICKS(1000));
  }

  esp_err_t err = esp_mqtt_client_start(s_client);
  if (err == ESP_OK || err == ESP_ERR_INVALID_STATE) {
    if (s_periodic_task == NULL) {
      xTaskCreate(periodic_task, "mqtt_periodic_task", 4096, NULL, 5,
                  &s_periodic_task);
    }
    set_event("start_requested");
  } else {
    set_error(esp_err_to_name(err), err, 0, 0, 0);
  }
  s_start_task = NULL;
  vTaskDelete(NULL);
}

static esp_err_t load_config(esp_mqtt_client_config_t *config, char *uri,
                             size_t uri_size) {
  nvs_handle_t handle;
  esp_err_t err = open_nvs("storage", NVS_READONLY, &handle);
  if (err != ESP_OK) return err;

  static char client_id[32] = "";
  size_t length = sizeof(client_id);
  if (nvs_get_str(handle, "serial", client_id, &length) != ESP_OK) {
    client_id[0] = '\0';
  }
  strlcpy(s_cached_serial, client_id, sizeof(s_cached_serial));
  config->credentials.client_id = client_id;

  char tls_value[2] = "1";
  length = sizeof(tls_value);
  bool use_tls = nvs_get_str(handle, "mqtt_use_tls", tls_value, &length) == ESP_OK &&
                 tls_value[0] == '1';

  char configured_host[128] = "";
  length = sizeof(configured_host);
  if (nvs_get_str(handle, "mqtt_uri", configured_host, &length) != ESP_OK) {
    strlcpy(configured_host, "192.168.1.100", sizeof(configured_host));
  }
  char host[128];
  normalize_host(configured_host, host, sizeof(host));
  if (host[0] == '\0') strlcpy(host, "192.168.1.100", sizeof(host));
  snprintf(uri, uri_size, "%s%s", use_tls ? "mqtts://" : "mqtt://", host);
  config->broker.address.uri = uri;

  char port[8] = "";
  length = sizeof(port);
  if (nvs_get_str(handle, "mqtt_port", port, &length) == ESP_OK && port[0]) {
    config->broker.address.port = atoi(port);
  } else {
    config->broker.address.port = use_tls ? 8883 : 1883;
  }

  char qos[2] = "";
  length = sizeof(qos);
  if (nvs_get_str(handle, "mqtt_qos_pub_telemetry", qos, &length) == ESP_OK) {
    s_qos_telemetry = atoi(qos);
  }
  length = sizeof(qos);
  if (nvs_get_str(handle, "mqtt_qos_sub", qos, &length) == ESP_OK) {
    s_qos_sub = atoi(qos);
  }

  build_topics(client_id);
  build_lwt();
  config->session.last_will.topic = s_topic_status;
  config->session.last_will.msg = s_lwt_msg;
  config->session.last_will.qos = 1;
  config->session.last_will.retain = true;

  if (use_tls) {
    s_root_ca = read_file("/littlefs/root.crt");
    s_client_cert = read_file("/littlefs/client.crt");
    s_client_key = read_file("/littlefs/client.key");
    config->broker.verification.certificate = s_root_ca;
    if (s_client_cert && s_client_key) {
      config->credentials.authentication.certificate = s_client_cert;
      config->credentials.authentication.key = s_client_key;
    }
  }

  nvs_close(handle);
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
    set_error("MQTT configuration unavailable", err, 0, 0, 0);
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
  if (s_periodic_task != NULL) {
    vTaskDelete(s_periodic_task);
    s_periodic_task = NULL;
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

int mqtt_manager_get_qos_pub(void) { return s_qos_telemetry; }
int mqtt_manager_get_qos_sub(void) { return s_qos_sub; }

esp_err_t mqtt_manager_publish(const char *topic, const char *data, int qos) {
  if (s_client == NULL || !s_connected) return ESP_ERR_INVALID_STATE;
  return esp_mqtt_client_publish(s_client, topic, data, 0, qos, 0) >= 0
             ? ESP_OK
             : ESP_FAIL;
}

bool mqtt_manager_start_test(void) {
  if (!s_connected) return false;
  s_test_pending = true;
  s_test_success = false;
  s_test_start_us = esp_timer_get_time();

  cJSON *root = cJSON_CreateObject();
  cJSON_AddStringToObject(root, "type", "connection_test");
  cJSON_AddStringToObject(root, "status", "online");
  char *json = cJSON_PrintUnformatted(root);
  s_test_success =
      json != NULL &&
      mqtt_manager_publish(s_topic_telemetry, json, s_qos_telemetry) == ESP_OK;
  s_test_pending = false;
  free(json);
  cJSON_Delete(root);
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
