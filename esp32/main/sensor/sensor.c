/*
 * sensor.c
 *
 * Drivers from esp-idf-lib: `dht` for DHT11/DHT22 and `bmp280` (which also
 * handles the BME280) on top of `i2cdev` (ESP-IDF i2c_master driver).
 */

#include "sensor.h"

#include <string.h>

#include "esp_log.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "freertos/task.h"

#include "config.h"

#if SENSOR_MODEL == SENSOR_DHT11 || SENSOR_MODEL == SENSOR_DHT22
#include "dht.h"
#define SENSOR_IS_DHT 1
#else
#include "bmp280.h"
#include "i2cdev.h"
#define SENSOR_IS_DHT 0
#endif

static const char *TAG = "SENSOR";

static SemaphoreHandle_t s_lock = NULL;
static sensor_reading_t s_last;
static bool s_has_last = false;
static int64_t s_last_us = 0;

#if SENSOR_IS_DHT

// DHT22 needs >= 2 s between conversions (DHT11 >= 1 s).
#define DHT_MIN_INTERVAL_US (2200LL * 1000LL)
#define DHT_ATTEMPTS 3

static int64_t s_last_dht_attempt_us = 0;

static dht_sensor_type_t dht_type(void) {
  return SENSOR_MODEL == SENSOR_DHT11 ? DHT_TYPE_DHT11 : DHT_TYPE_AM2301;
}

static esp_err_t hw_init(void) {
  ESP_LOGI(TAG, "%s on GPIO%d", sensor_logic_model_name(SENSOR_MODEL),
           SENSOR_DHT_GPIO);
  return ESP_OK;
}

static esp_err_t hw_read(sensor_reading_t *out) {
  esp_err_t err = ESP_FAIL;
  for (int attempt = 0; attempt < DHT_ATTEMPTS; attempt++) {
    int64_t wait_us =
        s_last_dht_attempt_us + DHT_MIN_INTERVAL_US - esp_timer_get_time();
    if (s_last_dht_attempt_us != 0 && wait_us > 0) {
      vTaskDelay(pdMS_TO_TICKS(wait_us / 1000 + 1));
    }
    float humidity = 0.0f;
    float temperature = 0.0f;
    err = dht_read_float_data(dht_type(), SENSOR_DHT_GPIO, &humidity,
                              &temperature);
    s_last_dht_attempt_us = esp_timer_get_time();
    if (err == ESP_OK) {
      out->has_temperature = true;
      out->temperature = temperature;
      out->has_relative_humidity = true;
      out->relative_humidity = humidity;
      return ESP_OK;
    }
    ESP_LOGW(TAG, "DHT read failed (%s), attempt %d/%d", esp_err_to_name(err),
             attempt + 1, DHT_ATTEMPTS);
  }
  return err;
}

#else // BMP280 / BME280

static bmp280_t s_dev;
static bool s_desc_ready = false;
static bool s_chip_ready = false;

static esp_err_t hw_init(void) {
  esp_err_t err = i2cdev_init();
  if (err != ESP_OK) return err;
  memset(&s_dev, 0, sizeof(s_dev));
  err = bmp280_init_desc(&s_dev, SENSOR_I2C_ADDRESS, I2C_NUM_0,
                         SENSOR_I2C_SDA_GPIO, SENSOR_I2C_SCL_GPIO);
  if (err != ESP_OK) return err;
  // Breakout boards carry their own pull-ups; the internal ones only help.
  s_dev.i2c_dev.cfg.sda_pullup_en = 1;
  s_dev.i2c_dev.cfg.scl_pullup_en = 1;
  s_desc_ready = true;
  ESP_LOGI(TAG, "%s on I2C SDA=GPIO%d SCL=GPIO%d addr=0x%02X",
           sensor_logic_model_name(SENSOR_MODEL), SENSOR_I2C_SDA_GPIO,
           SENSOR_I2C_SCL_GPIO, SENSOR_I2C_ADDRESS);
  return ESP_OK;
}

static esp_err_t ensure_chip(void) {
  if (s_chip_ready) return ESP_OK;
  if (!s_desc_ready) return ESP_ERR_INVALID_STATE;
  bmp280_params_t params;
  bmp280_init_default_params(&params);
  esp_err_t err = bmp280_init(&s_dev, &params);
  if (err != ESP_OK) {
    ESP_LOGW(TAG, "%s not found at 0x%02X (%s)",
             sensor_logic_model_name(SENSOR_MODEL), SENSOR_I2C_ADDRESS,
             esp_err_to_name(err));
    return err;
  }
  bool is_bme = s_dev.id == BME280_CHIP_ID;
  if (SENSOR_MODEL == SENSOR_BME280 && !is_bme) {
    ESP_LOGW(TAG, "Configured BME280 but the chip is a BMP280: no humidity");
  } else if (SENSOR_MODEL == SENSOR_BMP280 && is_bme) {
    ESP_LOGW(TAG, "Configured BMP280 but the chip is a BME280: humidity ignored");
  }
  s_chip_ready = true;
  // Let the first conversion finish in normal mode.
  vTaskDelay(pdMS_TO_TICKS(100));
  return ESP_OK;
}

static esp_err_t hw_read(sensor_reading_t *out) {
  esp_err_t err = ensure_chip();
  if (err != ESP_OK) return err;
  float temperature = 0.0f;
  float pressure_pa = 0.0f;
  float humidity = 0.0f;
  bool is_bme = s_dev.id == BME280_CHIP_ID;
  err = bmp280_read_float(&s_dev, &temperature, &pressure_pa,
                          is_bme ? &humidity : NULL);
  if (err != ESP_OK) {
    ESP_LOGW(TAG, "Read failed (%s); the chip is initialized again next time",
             esp_err_to_name(err));
    s_chip_ready = false;
    return err;
  }
  out->has_temperature = true;
  out->temperature = temperature;
  out->has_pressure = true;
  out->pressure = pressure_pa / 100.0f; // Pa -> hPa
  if (is_bme) {
    out->has_relative_humidity = true;
    out->relative_humidity = humidity;
  }
  return ESP_OK;
}

#endif

esp_err_t sensor_init(void) {
  if (s_lock == NULL) {
    s_lock = xSemaphoreCreateMutex();
    if (s_lock == NULL) return ESP_ERR_NO_MEM;
  }
  return hw_init();
}

esp_err_t sensor_read(sensor_reading_t *out) {
  if (out == NULL) return ESP_ERR_INVALID_ARG;
  memset(out, 0, sizeof(*out));
  if (s_lock == NULL) return ESP_ERR_INVALID_STATE;

  xSemaphoreTake(s_lock, portMAX_DELAY);
  esp_err_t err = hw_read(out);
  bool valid = err == ESP_OK && sensor_logic_sanitize(SENSOR_MODEL, out);
  if (valid) {
    s_last = *out;
    s_has_last = true;
    s_last_us = esp_timer_get_time();
  }
  xSemaphoreGive(s_lock);

  if (!valid) {
    if (err == ESP_OK) {
      ESP_LOGW(TAG, "Reading discarded: values out of range");
      err = ESP_ERR_INVALID_RESPONSE;
    }
    memset(out, 0, sizeof(*out));
    return err;
  }
  return ESP_OK;
}

bool sensor_get_last(sensor_reading_t *out, int64_t *age_seconds) {
  if (s_lock == NULL) return false;
  xSemaphoreTake(s_lock, portMAX_DELAY);
  bool has = s_has_last;
  if (has) {
    if (out) *out = s_last;
    if (age_seconds) *age_seconds = (esp_timer_get_time() - s_last_us) / 1000000LL;
  }
  xSemaphoreGive(s_lock);
  return has;
}

const char *sensor_key(void) { return sensor_logic_model_key(SENSOR_MODEL); }

const char *sensor_name(void) { return sensor_logic_model_name(SENSOR_MODEL); }
