/*
 * time_sync.c
 */

#include "time_sync.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/time.h>
#include <time.h>

#include "esp_http_client.h"
#include "esp_log.h"
#include "esp_sntp.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "freertos/task.h"
#include "mqtt_manager.h"
#include "network_manager.h"
#include "nvs.h"

static const char *TAG = "TIME_SYNC";

#define TICK_MS 1000
#define HTTP_TIMEOUT_MS 5000
#define HTTP_BODY_MAX 256
#define BACKEND_URL_MAX 128

static SemaphoreHandle_t s_lock = NULL;
static volatile time_source_t s_source = TIME_SOURCE_NONE;
static volatile bool s_mqtt_ready = false;
static char s_pending_req_id[24] = "";
static int64_t s_request_us = 0;
static uint32_t s_req_counter = 0;

static void set_clock(int64_t epoch_ms, time_source_t source) {
  struct timeval tv = {.tv_sec = (time_t)(epoch_ms / 1000),
                       .tv_usec = (suseconds_t)((epoch_ms % 1000) * 1000)};
  settimeofday(&tv, NULL);
  s_source = source;
  ESP_LOGI(TAG, "Clock set from %s (epoch_ms=%lld)",
           time_sync_source_name(source), (long long)epoch_ms);
}

static void on_sntp_sync(struct timeval *tv) {
  (void)tv;
  s_source = TIME_SOURCE_NTP;
  ESP_LOGI(TAG, "Clock set from ntp");
}

void time_sync_get_backend_url(char *out, size_t out_size) {
  if (out == NULL || out_size == 0) return;
  out[0] = '\0';

  nvs_handle_t handle;
  if (nvs_open("storage", NVS_READONLY, &handle) == ESP_OK) {
    size_t len = out_size;
    if (nvs_get_str(handle, "backend_url", out, &len) != ESP_OK) out[0] = '\0';
    nvs_close(handle);
  }
  if (out[0] != '\0') return;

  mqtt_status_snapshot_t mqtt;
  mqtt_manager_get_status_snapshot(&mqtt);
  if (!time_sync_default_backend_url(mqtt.host[0] ? mqtt.host : "192.168.1.100",
                                     out, out_size)) {
    out[0] = '\0';
  }
}

// GET {backend}/api/public/time over plain HTTP (there is no valid clock yet
// to check a server certificate, see backend/docs/mqtt-time-sync.md).
static bool sync_over_http(void) {
  char base[BACKEND_URL_MAX];
  char url[BACKEND_URL_MAX + 24];
  time_sync_get_backend_url(base, sizeof(base));
  if (!time_sync_time_url(base, url, sizeof(url))) {
    ESP_LOGW(TAG, "No backend URL for the HTTP time bootstrap");
    return false;
  }

  esp_http_client_config_t config = {
      .url = url,
      .method = HTTP_METHOD_GET,
      .timeout_ms = HTTP_TIMEOUT_MS,
      .disable_auto_redirect = true,
  };
  esp_http_client_handle_t client = esp_http_client_init(&config);
  if (client == NULL) return false;

  bool ok = false;
  int64_t t_request = esp_timer_get_time();
  esp_err_t err = esp_http_client_open(client, 0);
  if (err == ESP_OK) {
    esp_http_client_fetch_headers(client);
    int status = esp_http_client_get_status_code(client);
    char body[HTTP_BODY_MAX];
    int len = esp_http_client_read_response(client, body, sizeof(body) - 1);
    int64_t t_response = esp_timer_get_time();
    int64_t epoch_ms = 0;
    if (status == 200 && len > 0) {
      body[len] = '\0';
      ok = time_sync_parse_reply(body, (size_t)len, NULL, &epoch_ms);
    }
    if (ok) {
      set_clock(time_sync_compensate(epoch_ms, t_request, t_response),
                TIME_SOURCE_HTTP);
    } else {
      ESP_LOGW(TAG, "HTTP time from %s failed (status %d)", url, status);
    }
  } else {
    ESP_LOGW(TAG, "HTTP time from %s failed (%s)", url, esp_err_to_name(err));
  }
  esp_http_client_cleanup(client);
  return ok;
}

static void request_over_mqtt(void) {
  char req_id[sizeof(s_pending_req_id)];
  snprintf(req_id, sizeof(req_id), "t-%lu", (unsigned long)++s_req_counter);
  char *json = time_sync_build_request(req_id);
  if (json == NULL) return;

  xSemaphoreTake(s_lock, portMAX_DELAY);
  strlcpy(s_pending_req_id, req_id, sizeof(s_pending_req_id));
  s_request_us = esp_timer_get_time();
  xSemaphoreGive(s_lock);

  esp_err_t err = mqtt_manager_publish_time_request(json);
  ESP_LOGI(TAG, "MQTT time request %s %s", req_id,
           err == ESP_OK ? "sent" : esp_err_to_name(err));
  free(json);
}

void time_sync_on_mqtt_time(const char *data, int len) {
  if (s_lock == NULL || data == NULL || len <= 0) return;
  int64_t t_response = esp_timer_get_time();

  xSemaphoreTake(s_lock, portMAX_DELAY);
  char req_id[sizeof(s_pending_req_id)];
  strlcpy(req_id, s_pending_req_id, sizeof(req_id));
  int64_t t_request = s_request_us;
  xSemaphoreGive(s_lock);

  int64_t epoch_ms = 0;
  if (req_id[0] == '\0' ||
      !time_sync_parse_reply(data, (size_t)len, req_id, &epoch_ms)) {
    ESP_LOGW(TAG, "Ignoring MQTT time reply (no matching request)");
    return;
  }

  xSemaphoreTake(s_lock, portMAX_DELAY);
  s_pending_req_id[0] = '\0';
  xSemaphoreGive(s_lock);
  set_clock(time_sync_compensate(epoch_ms, t_request, t_response),
            TIME_SOURCE_MQTT);
}

static void time_sync_task(void *arg) {
  (void)arg;
  bool was_up = false;
  int64_t link_up_us = 0;
  int64_t last_http_us = 0;
  int64_t last_mqtt_us = 0;
  uint32_t http_attempts = 0;
  uint32_t mqtt_requests = 0;

  while (1) {
    int64_t now_us = esp_timer_get_time();
    bool up = network_manager_has_data_path();
    if (up && !was_up) {
      link_up_us = now_us;
      http_attempts = 0;
      mqtt_requests = 0;
    }
    was_up = up;

    bool time_valid = network_manager_is_time_synced();
    if (!time_valid) {
      s_source = TIME_SOURCE_NONE;
    } else if (s_source == TIME_SOURCE_NONE) {
      s_source = TIME_SOURCE_RTC; // survived a software restart
    }

    time_sync_view_t view = {
        .time_valid = time_valid,
        .link_up = up,
        .link_up_ms = up ? (uint32_t)((now_us - link_up_us) / 1000) : 0,
        .http_attempts = http_attempts,
        .since_http_ms = (uint32_t)((now_us - last_http_us) / 1000),
        .mqtt_connected = mqtt_manager_is_connected(),
        .mqtt_requests = mqtt_requests,
        .since_mqtt_request_ms = (uint32_t)((now_us - last_mqtt_us) / 1000),
    };

    switch (time_sync_next_action(&view)) {
    case TIME_SYNC_ACTION_HTTP:
      ESP_LOGW(TAG, "No NTP time yet, trying the HTTP bootstrap");
      http_attempts++;
      view.http_attempts = http_attempts;
      sync_over_http();
      last_http_us = esp_timer_get_time();
      view.time_valid = network_manager_is_time_synced();
      break;
    case TIME_SYNC_ACTION_MQTT_REQUEST:
      mqtt_requests++;
      last_mqtt_us = esp_timer_get_time();
      request_over_mqtt();
      break;
    case TIME_SYNC_ACTION_NONE:
    default:
      break;
    }

    if (!s_mqtt_ready && time_sync_mqtt_may_start(&view)) {
      s_mqtt_ready = true;
      if (!view.time_valid) {
        ESP_LOGW(TAG, "Starting MQTT without a valid clock; asking for the "
                      "time over MQTT once connected");
      }
    }
    vTaskDelay(pdMS_TO_TICKS(TICK_MS));
  }
}

esp_err_t time_sync_init(void) {
  if (s_lock != NULL) return ESP_OK;
  s_lock = xSemaphoreCreateMutex();
  if (s_lock == NULL) return ESP_ERR_NO_MEM;

  if (!esp_sntp_enabled()) {
    esp_sntp_setoperatingmode(SNTP_OPMODE_POLL);
    esp_sntp_setservername(0, "time.google.com");
    esp_sntp_setservername(1, "pool.ntp.org");
    sntp_set_time_sync_notification_cb(on_sntp_sync);
    esp_sntp_init();
  }

  if (xTaskCreate(time_sync_task, "time_sync", 4096, NULL, 4, NULL) != pdPASS) {
    return ESP_ERR_NO_MEM;
  }
  return ESP_OK;
}

bool time_sync_mqtt_ready(void) { return s_mqtt_ready; }

time_source_t time_sync_get_source(void) { return s_source; }
