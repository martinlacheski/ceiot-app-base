/*
 * CEIoT environmental device firmware
 * ESP32-WROOM-32 (classic ESP32, 4 MB flash, no PSRAM)
 *
 * Entry point.
 */

#include <stdio.h>

#include "esp_app_desc.h"
#include "esp_littlefs.h"
#include "esp_log.h"
#include "esp_system.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

#include "button_logic.h"
#include "led_manager.h"
#include "mqtt_manager.h"
#include "nvs_manager.h"
#include "ota_manager.h"
#include "pins_config.h"
#include "sensor.h"
#include "telemetry.h"
#include "time_sync.h"
#include "watchdog.h"
#include "web_server.h"
#include "wifi_manager.h"

static const char *TAG = "MAIN";

#define BUTTON_POLL_MS 50

static void init_littlefs(void) {
  esp_vfs_littlefs_conf_t conf = {.base_path = "/littlefs",
                                  .partition_label = "storage",
                                  .format_if_mount_failed = true,
                                  .dont_mount = false};

  esp_err_t ret = esp_vfs_littlefs_register(&conf);
  if (ret != ESP_OK) {
    ESP_LOGE(TAG, "LittleFS mount failed (%s)", esp_err_to_name(ret));
    return;
  }

  size_t total = 0, used = 0;
  if (esp_littlefs_info(conf.partition_label, &total, &used) == ESP_OK) {
    ESP_LOGI(TAG, "LittleFS: %u of %u bytes used", (unsigned)used,
             (unsigned)total);
  }
}

static led_override_t led_feedback(button_feedback_t feedback) {
  switch (feedback) {
  case BUTTON_FEEDBACK_AP_ARMED:
    return LED_OVERRIDE_SOLID;
  case BUTTON_FEEDBACK_RESET:
    return LED_OVERRIDE_BLINK_FAST;
  case BUTTON_FEEDBACK_NONE:
  default:
    return LED_OVERRIDE_NONE;
  }
}

// BOOT button (GPIO0): hold >= 3 s and release to start the configuration AP,
// hold >= 10 s for a factory reset. Short presses are ignored.
static void button_task(void *arg) {
  (void)arg;
  button_state_t state;
  button_logic_init(&state);

  while (1) {
    bool pressed = gpio_get_level(BUTTON_BOOT_GPIO) == 0;
    button_feedback_t feedback = BUTTON_FEEDBACK_NONE;
    button_action_t action =
        button_logic_update(&state, pressed, BUTTON_POLL_MS, &feedback);
    led_set_override(led_feedback(feedback));

    if (action == BUTTON_ACTION_START_AP) {
      ESP_LOGI(TAG, "BOOT held >= 3 s: starting the configuration AP");
      wifi_manager_start_ap();
    } else if (action == BUTTON_ACTION_FACTORY_RESET) {
      ESP_LOGW(TAG, "BOOT held >= 10 s: factory reset");
      factory_reset_device(NULL); // restarts the device
    }

    vTaskDelay(pdMS_TO_TICKS(BUTTON_POLL_MS));
  }
}

void app_main(void) {
  const esp_app_desc_t *app = esp_app_get_description();
  ESP_LOGI(TAG, "CEIoT environmental device %s (%s), ESP-IDF %s", app->version,
           sensor_name(), esp_get_idf_version());

  // 1. Storage: NVS, LittleFS (certificates) and the factory snapshot
  ESP_ERROR_CHECK(nvs_manager_init());
  init_littlefs();
  restore_factory_defaults();       // serial / certs / TLS flag if missing
  factory_store_certs_if_missing(); // keep flashed certs for a factory reset

  // 2. Watchdog
  esp_err_t wdt_ret = watchdog_init();
  if (wdt_ret != ESP_OK && wdt_ret != ESP_ERR_INVALID_STATE) {
    ESP_ERROR_CHECK(wdt_ret);
  }

  // 3. Board I/O
  pins_config_init();
  if (led_manager_init() != ESP_OK) {
    ESP_LOGE(TAG, "Status LED init failed");
  }

  // 4. Connectivity (starts the AP by itself when no Wi-Fi is saved)
  ESP_ERROR_CHECK(wifi_manager_init());
  ESP_ERROR_CHECK(time_sync_init()); // NTP -> HTTP -> MQTT time fallback

  // 5. Configuration web server (station IP and AP 192.168.4.1)
  ESP_ERROR_CHECK(web_server_start());

  // 6. MQTT + OTA + telemetry. A brand-new device (no "storage" namespace)
  // uses the defaults: mTLS on MQTT_DEFAULT_TLS_PORT to the default broker, serial from the
  // factory snapshot. Without a serial there is no MQTT identity: stay in AP
  // mode so it can be set from the web UI.
  esp_err_t mqtt_ret = mqtt_manager_init();
  // Before MQTT starts: reports/validates an image installed by OTA.
  if (ota_manager_init(mqtt_manager_get_serial()) != ESP_OK) {
    ESP_LOGE(TAG, "OTA client init failed");
  }
  if (mqtt_ret == ESP_OK) {
    mqtt_manager_start();
  } else if (mqtt_ret == ESP_ERR_INVALID_STATE) {
    ESP_LOGW(TAG, "No device serial: starting the configuration AP to set it");
    wifi_manager_start_ap();
  } else {
    ESP_LOGE(TAG, "MQTT init failed (%s)", esp_err_to_name(mqtt_ret));
  }
  if (telemetry_start() != ESP_OK) {
    ESP_LOGE(TAG, "Telemetry task could not start");
  }

  // 7. BOOT button
  xTaskCreate(button_task, "button_task", 4096, NULL, 5, NULL);

  ESP_LOGI(TAG, "Ready");

  uint32_t loop_count = 0;
  while (1) {
    vTaskDelay(pdMS_TO_TICKS(1000));
    watchdog_feed();
    if (loop_count % 300 == 0) {
      ESP_LOGI(TAG, "Uptime %lld s, free heap %u",
               (long long)(esp_timer_get_time() / 1000000),
               (unsigned)esp_get_free_heap_size());
    }
    loop_count++;
  }
}
