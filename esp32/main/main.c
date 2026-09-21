/*
 * Environmental IoT device firmware
 * ESP32-S3-WROOM-1 N16R8
 *
 * Punto de entrada principal
 */

#include "esp_log.h"
#include "esp_heap_caps.h"
#include "esp_system.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "nvs.h"
#include "nvs_flash.h"
#include <stdio.h>

#include "display_manager.h"
#include "esp_littlefs.h"
#include "led_manager.h"
#include "log_manager.h"
#include "mqtt_manager.h"
#include "network_manager.h"
#include "nvs_manager.h"
#include "pins_config.h"
#include "cellular_manager.h"
#include "temp_manager.h"
#include "watchdog.h"
#include "web_server.h"
#include "wifi_manager.h"

static const char *TAG = "MAIN";

static esp_err_t probe_nvs_namespace(const char *ns) {
  nvs_handle_t handle;
  esp_err_t err = nvs_open(ns, NVS_READONLY, &handle);
  if (err == ESP_OK) {
    nvs_close(handle);
  }
  return err;
}

static void nvs_health_task(void *arg) {
  (void)arg;

  esp_err_t last_storage = ESP_OK;
  esp_err_t last_factory = ESP_OK;
  esp_err_t last_wifi = ESP_OK;
  bool first = true;

  while (1) {
    esp_err_t cur_storage = probe_nvs_namespace("storage");
    esp_err_t cur_factory = probe_nvs_namespace("factory");
    esp_err_t cur_wifi = probe_nvs_namespace("wifi_prefs");

    bool changed = first || cur_storage != last_storage ||
                   cur_factory != last_factory || cur_wifi != last_wifi;
    bool unhealthy = cur_storage != ESP_OK || cur_factory != ESP_OK;

    if (changed || unhealthy) {
      ESP_LOGW(TAG,
               "NVS health storage=%s factory=%s wifi_prefs=%s heap_free=%u "
               "heap_min=%u",
               esp_err_to_name(cur_storage), esp_err_to_name(cur_factory),
               esp_err_to_name(cur_wifi), (unsigned)esp_get_free_heap_size(),
               (unsigned)heap_caps_get_minimum_free_size(MALLOC_CAP_8BIT));
    }

    last_storage = cur_storage;
    last_factory = cur_factory;
    last_wifi = cur_wifi;
    first = false;
    vTaskDelay(pdMS_TO_TICKS(2000));
  }
}

static void init_connectivity_managers(void) {
  ESP_ERROR_CHECK(wifi_manager_init());
  ESP_LOGI(TAG, "WiFi Manager inicializado");

  ESP_ERROR_CHECK(cellular_manager_init());
  ESP_LOGI(TAG, "Cellular Manager inicializado");

  ESP_ERROR_CHECK(network_manager_init());
  ESP_LOGI(TAG, "Network Manager inicializado");
}

// Initialize LittleFS
static void init_littlefs(void) {
  ESP_LOGI(TAG, "Initializing LittleFS");
  esp_vfs_littlefs_conf_t conf = {.base_path = "/littlefs",
                                  .partition_label = "storage",
                                  .format_if_mount_failed = true,
                                  .dont_mount = false};

  esp_err_t ret = esp_vfs_littlefs_register(&conf);
  if (ret != ESP_OK) {
    if (ret == ESP_FAIL) {
      ESP_LOGE(TAG, "Failed to mount or format filesystem");
    } else if (ret == ESP_ERR_NOT_FOUND) {
      ESP_LOGE(TAG, "Failed to find LittleFS partition");
    } else {
      ESP_LOGE(TAG, "Failed to initialize LittleFS (%s)", esp_err_to_name(ret));
    }
    return;
  }

  size_t total = 0, used = 0;
  ret = esp_littlefs_info(conf.partition_label, &total, &used);
  if (ret != ESP_OK) {
    ESP_LOGE(TAG, "Failed to get LittleFS partition information (%s)",
             esp_err_to_name(ret));
  } else {
    ESP_LOGI(TAG, "Partition size: total: %d, used: %d", total, used);
  }
}

// Tarea para manejar entradas (botones)
static void input_task(void *arg) {
#if BUTTON_AP_MODE_ENABLED
  uint32_t ap_button_hold_time_ms = 0;
  const uint32_t toggle_ap_ms = 2000;
  const uint32_t factory_reset_ms = 10000;
  bool ap_toggle_triggered = false;
  bool factory_reset_triggered = false;
#endif
  const uint32_t poll_period_ms = 100;

  while (1) {
    // Botón MODO AP / RESET (GPIO 3)
#if BUTTON_AP_MODE_ENABLED
    if (gpio_get_level(BUTTON_AP_MODE_GPIO) == 0) {
      ap_button_hold_time_ms += poll_period_ms;

      // Nivel 1: Toggle AP (2 Segundos)
      if (ap_button_hold_time_ms >= toggle_ap_ms && !ap_toggle_triggered) {
        ESP_LOGI(TAG,
                 "Botón presionado por 2 segundos. Soltar para conmutar AP "
                 "o mantener apretado por 10 segundos para Factory Reset.");
        ap_toggle_triggered = true;
      }

      // Nivel 2: Factory Reset (10 Segundos)
      if (ap_button_hold_time_ms >= factory_reset_ms &&
          !factory_reset_triggered) {
        ESP_LOGW(TAG, "!!! Botón presionado por 10 segundos !!!");
        ESP_LOGW(TAG, "Iniciando Factory Reset por botón físico...");
        factory_reset_triggered = true;
        factory_reset_device(NULL);
        // factory_reset_device reinicia el ESP, no necesitamos salir del loop
      }
    } else {
      // Al soltar el botón
      if (ap_button_hold_time_ms > 0) {
        if (ap_toggle_triggered && !factory_reset_triggered) {
          if (wifi_manager_is_ap_active()) {
            ESP_LOGI(TAG, "Conmutando: Desactivando AP");
            wifi_manager_stop_ap();
          } else {
            ESP_LOGI(TAG, "Conmutando: Activando AP");
            wifi_manager_start_ap();
          }
        }
        ap_button_hold_time_ms = 0;
        ap_toggle_triggered = false;
        factory_reset_triggered = false;
      }
    }
#endif

    // El botón RESET (GPIO 0) se mantiene como un reinicio simple por ahora
    if (gpio_get_level(BUTTON_RESET_GPIO) == 0) {
      ESP_LOGW(TAG, "Botón BOOT presionado -> Reiniciando...");
      vTaskDelay(pdMS_TO_TICKS(500));
      esp_restart();
    }

    vTaskDelay(pdMS_TO_TICKS(poll_period_ms));
  }
}

void app_main(void) {
  ESP_LOGI(TAG, "========================================");
  ESP_LOGI(TAG, "IOT - Environmental device");
  ESP_LOGI(TAG, "ESP32-S3-WROOM-1 N16R8");
  ESP_LOGI(TAG, "ESP-IDF Version: %s", esp_get_idf_version());
  ESP_LOGI(TAG, "========================================");

  // 1. Inicializar sistema de logs
  ESP_ERROR_CHECK(log_manager_init());
  ESP_LOGI(TAG, "Sistema de logs inicializado");

  // 2. Inicializar NVS (incluye migración sensor_code -> serial)
  ESP_ERROR_CHECK(nvs_manager_init());
  ESP_LOGI(TAG, "NVS inicializado correctamente");

  // 2b. Inicializar LittleFS
  init_littlefs();

  // 2c. Restaurar valores base (sensor_code/certs) si faltan
  restore_factory_defaults();

  // 3. Inicializar Watchdog Timer
  // Manejo robusto de inicialización previa
  esp_err_t wdt_ret = watchdog_init();
  if (wdt_ret == ESP_ERR_INVALID_STATE) {
    ESP_LOGW(TAG, "Watchdog ya estaba activo, continuando...");
  } else {
    ESP_ERROR_CHECK(wdt_ret);
  }
  ESP_LOGI(TAG, "Watchdog Timer verificado");

  // 4. Configurar pines GPIO
  pins_config_init();
  ESP_LOGI(TAG, "Configuración de pines completada");

  // 4a. Bootstrap temprano para display Waveshare (TCA9554/AXP2101)
  pins_config_prepare_display_bootstrap();

  // 4b. Inicializar LED Manager
  if (led_manager_init() == ESP_OK) {
    ESP_ERROR_CHECK(led_manager_start());
    led_set_status(LED_STATUS_INIT);
    ESP_LOGI(TAG, "LED Manager inicializado");
  } else {
    ESP_LOGE(TAG, "Fallo al inicializar LED Manager.");
  }

  // 4c. Mostrar logo al inicio
  display_show_status();

  // 4d. Inicializar Temperature Manager
  if (temp_manager_init() == ESP_OK) {
    ESP_ERROR_CHECK(temp_manager_start());
    ESP_LOGI(TAG, "Temperature Manager inicializado");
  } else {
    ESP_LOGE(TAG, "Fallo al inicializar Temperature Manager.");
  }

  // 5. Inicializar managers de conectividad en orden determinístico
  init_connectivity_managers();

  // 6. Inicializar Web Server
  // Se inicia inmediatamente para estar disponible en AP
  ESP_ERROR_CHECK(web_server_start());
  ESP_LOGI(TAG, "Web Server inicializado");

  // 7. Inicializar MQTT Client
  if (mqtt_manager_init() == ESP_OK) {
    mqtt_manager_start();
    ESP_LOGI(TAG, "MQTT Client inicializado");
  }

  // 8. Iniciar tarea de entradas (Botones)
  xTaskCreate(input_task, "input_task", 2048, NULL, 5, NULL);
  ESP_LOGI(TAG, "Input Task iniciada");

  // 8b. Monitor de salud NVS para detectar quiebres en runtime
  xTaskCreate(nvs_health_task, "nvs_health_task", 4096, NULL, 4, NULL);
  ESP_LOGI(TAG, "NVS health task iniciada");

  // TODO: Inicializar componentes restantes (Fase 3+)
  // - MQTT Client
  // - Display TFT
  // - LED RGB
  // - Console commands

  ESP_LOGI(TAG, "========================================");
  ESP_LOGI(TAG, "Sistema inicializado. Listo para operar.");
  ESP_LOGI(TAG, "========================================");

  // Loop principal - alimentar watchdog periódicamente
  uint32_t loop_count = 0;
  while (1) {
    vTaskDelay(pdMS_TO_TICKS(1000));

    // Alimentar watchdog cada segundo
    watchdog_feed();

    // Mostrar uptime cada 300 segundos
    if (loop_count % 300 == 0) {
      int64_t uptime_sec = esp_timer_get_time() / 1000000;
      ESP_LOGI(TAG, "Uptime: %lld segundos", uptime_sec);
    }

    loop_count++;
  }
}
