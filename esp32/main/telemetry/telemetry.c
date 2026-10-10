/*
 * telemetry.c
 */

#include "telemetry.h"

#include <stdlib.h>

#include "config.h"
#include "esp_app_desc.h"
#include "esp_log.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "mqtt_manager.h"
#include "sensor.h"
#include "telemetry_payload.h"

static const char *TAG = "TELEMETRY";

static TaskHandle_t s_task = NULL;

static void publish_reading(const sensor_reading_t *reading) {
  if (!mqtt_manager_is_connected()) {
    ESP_LOGD(TAG, "MQTT not connected, reading not published");
    return;
  }
  long uptime = (long)(esp_timer_get_time() / 1000000LL);
  char *json = telemetry_payload_build(sensor_key(), reading, uptime,
                                       esp_app_get_description()->version);
  if (json == NULL) {
    ESP_LOGW(TAG, "Nothing to publish");
    return;
  }
  esp_err_t err = mqtt_manager_publish_telemetry(json);
  if (err == ESP_OK) {
    ESP_LOGI(TAG, "Published %s", json);
  } else {
    ESP_LOGW(TAG, "Publish failed (%s)", esp_err_to_name(err));
  }
  free(json);
}

static void telemetry_task(void *arg) {
  (void)arg;
  // Sensors need a moment after power-up before the first conversion.
  vTaskDelay(pdMS_TO_TICKS(2000));
  while (1) {
    sensor_reading_t reading;
    esp_err_t err = sensor_read(&reading);
    if (err == ESP_OK) {
      publish_reading(&reading);
    } else {
      ESP_LOGW(TAG, "%s reading unavailable (%s), skipping this cycle",
               sensor_name(), esp_err_to_name(err));
    }
    // Sleep until the next period, or earlier when telemetry_request_now().
    ulTaskNotifyTake(pdTRUE, pdMS_TO_TICKS(TELEMETRY_INTERVAL_SEC * 1000));
  }
}

esp_err_t telemetry_start(void) {
  if (s_task != NULL) return ESP_OK;
  esp_err_t err = sensor_init();
  if (err != ESP_OK) {
    ESP_LOGE(TAG, "Sensor init failed (%s)", esp_err_to_name(err));
  }
  if (xTaskCreate(telemetry_task, "telemetry", 4096, NULL, 4, &s_task) !=
      pdPASS) {
    return ESP_ERR_NO_MEM;
  }
  ESP_LOGI(TAG, "%s (%s), every %d s", sensor_name(), sensor_key(),
           TELEMETRY_INTERVAL_SEC);
  return ESP_OK;
}

void telemetry_request_now(void) {
  if (s_task != NULL) xTaskNotifyGive(s_task);
}
