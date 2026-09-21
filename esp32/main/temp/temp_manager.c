/*
 * temp_manager.c
 */

#include "temp_manager.h"
#include "ds18b20.h"
#include "esp_log.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "nvs.h"
#include "nvs_flash.h"
#include "onewire_bus.h"
#include "onewire_device.h"
#include "pins_config.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static const char *TAG = "TEMP_MGR";

#define TEMP_TASK_STACK 4096
#define TEMP_TASK_PRIORITY 5
#define TEMP_READ_INTERVAL_MS 2000
#define DS18B20_CONVERT_MS 750

#define TEMP_SENSOR_COUNT 3
#define TEMP_PRIMARY_SENSOR_INDEX 0

static const int s_temp_sensor_pins[TEMP_SENSOR_COUNT] = {
    TEMP_SENSOR_1_GPIO,
    TEMP_SENSOR_2_GPIO,
    TEMP_SENSOR_3_GPIO,
};

static TaskHandle_t s_temp_task_handle = NULL;
static float s_last_temp_c[TEMP_SENSOR_COUNT] = {0.0f};
static bool s_temp_valid[TEMP_SENSOR_COUNT] = {false};
static bool s_enabled = true;

static onewire_bus_handle_t s_onewire_bus[TEMP_SENSOR_COUNT] = {NULL};
static ds18b20_device_handle_t s_ds18b20[TEMP_SENSOR_COUNT] = {NULL};
static bool s_sensor_ready[TEMP_SENSOR_COUNT] = {false};

static esp_err_t try_init_sensor(size_t index) {
  if (index >= TEMP_SENSOR_COUNT) {
    return ESP_ERR_INVALID_ARG;
  }

  if (s_onewire_bus[index] == NULL) {
    onewire_bus_config_t bus_config = {
        .bus_gpio_num = s_temp_sensor_pins[index],
        .flags = {
            .en_pull_up = true,
        },
    };
    onewire_bus_rmt_config_t rmt_config = {
        .max_rx_bytes = 10,
    };
    esp_err_t err =
        onewire_new_bus_rmt(&bus_config, &rmt_config, &s_onewire_bus[index]);
    if (err != ESP_OK) {
      ESP_LOGW(TAG, "No se pudo inicializar 1-Wire T%u (GPIO%d): %s",
               (unsigned int)(index + 1), s_temp_sensor_pins[index],
               esp_err_to_name(err));
      return err;
    }
  }

  onewire_device_iter_handle_t iter = NULL;
  onewire_device_t next_device;
  esp_err_t err = onewire_new_device_iter(s_onewire_bus[index], &iter);
  if (err != ESP_OK) {
    ESP_LOGW(TAG, "No se pudo crear iterador 1-Wire T%u (GPIO%d): %s",
             (unsigned int)(index + 1), s_temp_sensor_pins[index],
             esp_err_to_name(err));
    return err;
  }

  s_ds18b20[index] = NULL;
  s_sensor_ready[index] = false;
  while (onewire_device_iter_get_next(iter, &next_device) == ESP_OK) {
    ds18b20_config_t ds_cfg = {};
    if (ds18b20_new_device_from_enumeration(&next_device, &ds_cfg,
                                            &s_ds18b20[index]) == ESP_OK) {
      ds18b20_set_resolution(s_ds18b20[index], DS18B20_RESOLUTION_12B);
      s_sensor_ready[index] = true;
      break;
    }
  }
  onewire_del_device_iter(iter);

  if (!s_sensor_ready[index]) {
    ESP_LOGW(TAG, "DS18B20 T%u no detectado en GPIO%d",
             (unsigned int)(index + 1), s_temp_sensor_pins[index]);
    return ESP_ERR_NOT_FOUND;
  }

  ESP_LOGI(TAG, "DS18B20 T%u detectado en GPIO%d", (unsigned int)(index + 1),
           s_temp_sensor_pins[index]);
  return ESP_OK;
}

static void try_init_all_sensors(void) {
  for (size_t i = 0; i < TEMP_SENSOR_COUNT; i++) {
    if (!s_sensor_ready[i]) {
      try_init_sensor(i);
    }
  }
}

static void set_all_temps_invalid(void) {
  for (size_t i = 0; i < TEMP_SENSOR_COUNT; i++) {
    s_temp_valid[i] = false;
  }
}

static void format_temp(char *buf, size_t size, size_t index) {
  if (index < TEMP_SENSOR_COUNT && s_temp_valid[index]) {
    snprintf(buf, size, "%.2fC", s_last_temp_c[index]);
    return;
  }
  strlcpy(buf, "N/A", size);
}

static void temp_task(void *pvParameters) {
  (void)pvParameters;

  try_init_all_sensors();
  while (1) {
    if (!s_enabled) {
      set_all_temps_invalid();
      vTaskDelay(pdMS_TO_TICKS(TEMP_READ_INTERVAL_MS));
      continue;
    }

    bool conversion_triggered = false;
    for (size_t i = 0; i < TEMP_SENSOR_COUNT; i++) {
      if (!s_sensor_ready[i]) {
        s_temp_valid[i] = false;
        continue;
      }
      if (ds18b20_trigger_temperature_conversion_for_all(s_onewire_bus[i]) ==
          ESP_OK) {
        conversion_triggered = true;
      } else {
        s_temp_valid[i] = false;
      }
    }

    if (conversion_triggered) {
      vTaskDelay(pdMS_TO_TICKS(DS18B20_CONVERT_MS));
    }

    for (size_t i = 0; i < TEMP_SENSOR_COUNT; i++) {
      float temp_c = 0.0f;
      if (s_sensor_ready[i] &&
          ds18b20_get_temperature(s_ds18b20[i], &temp_c) == ESP_OK) {
        s_last_temp_c[i] = temp_c;
        s_temp_valid[i] = true;
      } else {
        s_temp_valid[i] = false;
      }
    }

    char t1[16], t2[16], t3[16];
    format_temp(t1, sizeof(t1), 0);
    format_temp(t2, sizeof(t2), 1);
    format_temp(t3, sizeof(t3), 2);
    ESP_LOGI(TAG, "Temperature telemetry: T1=%s T2=%s T3=%s", t1, t2, t3);
    vTaskDelay(pdMS_TO_TICKS(TEMP_READ_INTERVAL_MS));
  }
}

esp_err_t temp_manager_init(void) {
  // Cargar flag de NVS
  nvs_handle_t nvs_h;
  if (nvs_open("storage", NVS_READONLY, &nvs_h) == ESP_OK) {
    uint8_t enabled = 1;
    nvs_get_u8(nvs_h, "temp_enabled", &enabled);
    s_enabled = (enabled != 0);
    nvs_close(nvs_h);
  }

  if (!s_enabled) {
    ESP_LOGI(TAG, "Sensores de temperatura deshabilitados por configuración");
    return ESP_OK;
  }

  try_init_all_sensors();
  return ESP_OK;
}

esp_err_t temp_manager_start(void) {
  if (!s_enabled) {
    ESP_LOGI(TAG, "temp_manager_start() ignorado: sensores deshabilitados");
    return ESP_OK;
  }

  if (s_temp_task_handle != NULL) {
    return ESP_OK;
  }

  BaseType_t ok =
      xTaskCreate(temp_task, "temp_task", TEMP_TASK_STACK, NULL,
                  TEMP_TASK_PRIORITY, &s_temp_task_handle);
  return (ok == pdPASS) ? ESP_OK : ESP_FAIL;
}

bool temp_manager_get_last_temp(float *out_celsius) {
  return temp_manager_get_temp_by_index(TEMP_PRIMARY_SENSOR_INDEX, out_celsius);
}

bool temp_manager_get_temp_by_index(size_t index, float *out_celsius) {
  if (index >= TEMP_SENSOR_COUNT || !s_temp_valid[index]) {
    return false;
  }
  if (out_celsius != NULL) {
    *out_celsius = s_last_temp_c[index];
  }
  return true;
}

size_t temp_manager_get_sensor_count(void) { return TEMP_SENSOR_COUNT; }

void temp_manager_set_enabled(bool enabled) {
  if (s_enabled == enabled) {
    return;
  }

  s_enabled = enabled;

  if (!enabled) {
    // Stop sampling while the sensors are disabled.
    if (s_temp_task_handle != NULL) {
      vTaskDelete(s_temp_task_handle);
      s_temp_task_handle = NULL;
    }
    ESP_LOGI(TAG, "Sensores de temperatura desactivados");
  } else {
    // Reiniciar tarea si no está corriendo
    if (s_temp_task_handle == NULL) {
      temp_manager_start();
    }
    ESP_LOGI(TAG, "Sensores de temperatura activados");
  }

  // Guardar estado en NVS
  nvs_handle_t nvs_h;
  if (nvs_open("storage", NVS_READWRITE, &nvs_h) == ESP_OK) {
    nvs_set_u8(nvs_h, "temp_enabled", enabled ? 1 : 0);
    nvs_commit(nvs_h);
    nvs_close(nvs_h);
  }
}

bool temp_manager_is_enabled(void) { return s_enabled; }
