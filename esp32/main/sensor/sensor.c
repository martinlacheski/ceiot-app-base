/*
 * sensor.c
 *
 * Drivers from esp-idf-lib, all linked into every image: `dht` for
 * DHT11/DHT22 and `bmp280` (which also handles the BME280) on top of
 * `i2cdev` (ESP-IDF i2c_master driver). The rules (setting, autodetection
 * decision, plausibility) live in sensor_logic.c, host-tested.
 */

#include "sensor.h"

#include <string.h>

#include "bmp280.h"
#include "dht.h"
#include "esp_log.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "freertos/task.h"
#include "i2cdev.h"
#include "nvs.h"

#include "config.h"

static const char *TAG = "SENSOR";

#define NVS_NAMESPACE "storage"
#define NVS_KEY_SETTING "sensor_model"
#define NVS_KEY_DETECTED "sensor_detected"
#define NVS_VALUE_MAX 16

#define BMX280_REG_CHIP_ID 0xD0

// --- State shared with the web server (s_lock) ------------------------------
static SemaphoreHandle_t s_lock = NULL;
static int s_setting = SENSOR_SETTING_AUTO;
static int s_detected = SENSOR_NONE;
static int s_model = SENSOR_NONE;
static sensor_state_t s_state = SENSOR_STATE_DETECTING;
static bool s_detect_now = false;
static sensor_reading_t s_last;
static int s_last_model = SENSOR_NONE;
static bool s_has_last = false;
static int64_t s_last_us = 0;

// --- Telemetry task only (hardware) ------------------------------------------
static int s_hw_model = SENSOR_NONE; // model the hardware layer is set up for
static int64_t s_next_detect_us = 0;

// ---------------------------------------------------------------------------
// NVS
// ---------------------------------------------------------------------------

static bool nvs_read_value(const char *key, char *out, size_t size) {
  nvs_handle_t handle;
  out[0] = '\0';
  if (nvs_open(NVS_NAMESPACE, NVS_READONLY, &handle) != ESP_OK) return false;
  size_t len = size;
  bool ok = nvs_get_str(handle, key, out, &len) == ESP_OK;
  nvs_close(handle);
  if (!ok) out[0] = '\0';
  return ok;
}

// Stores `value`, or erases the key when it is NULL.
static esp_err_t nvs_write_value(const char *key, const char *value) {
  nvs_handle_t handle;
  esp_err_t err = nvs_open(NVS_NAMESPACE, NVS_READWRITE, &handle);
  if (err != ESP_OK) return err;
  if (value != NULL) {
    err = nvs_set_str(handle, key, value);
  } else {
    err = nvs_erase_key(handle, key);
    if (err == ESP_ERR_NVS_NOT_FOUND) err = ESP_OK;
  }
  if (err == ESP_OK) err = nvs_commit(handle);
  nvs_close(handle);
  if (err != ESP_OK) {
    ESP_LOGE(TAG, "NVS %s/%s write failed (%s)", NVS_NAMESPACE, key,
             esp_err_to_name(err));
  }
  return err;
}

// ---------------------------------------------------------------------------
// DHT11 / DHT22
// ---------------------------------------------------------------------------

// DHT22 needs >= 2 s between conversions (DHT11 >= 1 s).
#define DHT_MIN_INTERVAL_US (2200LL * 1000LL)
#define DHT_ATTEMPTS 3
#define DHT_PROBE_ATTEMPTS 2

static int64_t s_last_dht_attempt_us = 0;

static esp_err_t dht_read_once(dht_sensor_type_t type, float *temperature,
                               float *humidity) {
  int64_t wait_us =
      s_last_dht_attempt_us + DHT_MIN_INTERVAL_US - esp_timer_get_time();
  if (s_last_dht_attempt_us != 0 && wait_us > 0) {
    vTaskDelay(pdMS_TO_TICKS(wait_us / 1000 + 1));
  }
  *temperature = 0.0f;
  *humidity = 0.0f;
  esp_err_t err =
      dht_read_float_data(type, SENSOR_DHT_GPIO, humidity, temperature);
  s_last_dht_attempt_us = esp_timer_get_time();
  return err;
}

static esp_err_t dht_read(int model, sensor_reading_t *out) {
  dht_sensor_type_t type =
      model == SENSOR_DHT11 ? DHT_TYPE_DHT11 : DHT_TYPE_AM2301;
  esp_err_t err = ESP_FAIL;
  for (int attempt = 0; attempt < DHT_ATTEMPTS; attempt++) {
    float humidity = 0.0f;
    float temperature = 0.0f;
    err = dht_read_once(type, &temperature, &humidity);
    if (err == ESP_OK) {
      // Raw values before the range filter, so a wrong model or a faulty
      // sensor shows up in the log instead of silently dropped variables.
      ESP_LOGI(TAG, "%s raw: temperature %.1f C, humidity %.1f %%",
               sensor_logic_model_name(model), temperature, humidity);
      out->has_temperature = true;
      out->temperature = temperature;
      out->has_relative_humidity = true;
      out->relative_humidity = humidity;
      return ESP_OK;
    }
    ESP_LOGW(TAG, "%s read failed (%s), attempt %d/%d",
             sensor_logic_model_name(model), esp_err_to_name(err), attempt + 1,
             DHT_ATTEMPTS);
  }
  return err;
}

// One autodetection read of the DHT pin decoded as `type`.
static void dht_probe(dht_sensor_type_t type, sensor_probe_dht_t *result) {
  const char *name = type == DHT_TYPE_DHT11 ? "DHT11" : "DHT22";
  for (int attempt = 0; attempt < DHT_PROBE_ATTEMPTS; attempt++) {
    esp_err_t err = dht_read_once(type, &result->temperature,
                                  &result->relative_humidity);
    if (err == ESP_OK) {
      result->answered = true;
      ESP_LOGI(TAG, "Detect: GPIO%d read as %s: temperature %.1f C, humidity "
                    "%.1f %%",
               SENSOR_DHT_GPIO, name, result->temperature,
               result->relative_humidity);
      return;
    }
    ESP_LOGI(TAG, "Detect: GPIO%d read as %s: no answer (%s)", SENSOR_DHT_GPIO,
             name, esp_err_to_name(err));
  }
}

// ---------------------------------------------------------------------------
// BMP280 / BME280 (I2C)
// ---------------------------------------------------------------------------

static bmp280_t s_dev;
static bool s_i2c_ready = false;  // i2cdev_init() done
static bool s_desc_ready = false; // s_dev holds a descriptor
static bool s_chip_ready = false; // bmp280_init() succeeded
static uint8_t s_address = SENSOR_I2C_ADDRESS;

static uint8_t other_address(uint8_t address) {
  return address == BMP280_I2C_ADDRESS_0 ? BMP280_I2C_ADDRESS_1
                                         : BMP280_I2C_ADDRESS_0;
}

static esp_err_t i2c_ready(void) {
  if (s_i2c_ready) return ESP_OK;
  esp_err_t err = i2cdev_init();
  if (err == ESP_OK) s_i2c_ready = true;
  return err;
}

// Releases the descriptor: removes the device from the bus (and the bus
// itself once no device is left), so a failed probe leaves nothing behind.
static void free_desc(void) {
  if (s_desc_ready) {
    bmp280_free_desc(&s_dev);
    s_desc_ready = false;
  }
  s_chip_ready = false;
}

static esp_err_t init_desc(uint8_t address) {
  free_desc();
  memset(&s_dev, 0, sizeof(s_dev));
  esp_err_t err = bmp280_init_desc(&s_dev, address, I2C_NUM_0,
                                   SENSOR_I2C_SDA_GPIO, SENSOR_I2C_SCL_GPIO);
  if (err != ESP_OK) return err;
  // Breakout boards carry their own pull-ups; the internal ones only help.
  s_dev.i2c_dev.cfg.sda_pullup_en = 1;
  s_dev.i2c_dev.cfg.scl_pullup_en = 1;
  // The driver defaults to 1 MHz, too fast for breakout modules on jumper
  // wires (no ACK at all); standard mode is plenty for one reading a minute.
  s_dev.i2c_dev.cfg.master.clk_speed = SENSOR_I2C_CLOCK_HZ;
  s_desc_ready = true;
  return ESP_OK;
}

// Autodetection: an address-only probe (i2c_master_probe, nothing written)
// at 0x76 then 0x77, and the chip ID register of the first that answers.
static bool i2c_probe(uint8_t *chip_id, uint8_t *address) {
  if (i2c_ready() != ESP_OK) return false;
  const uint8_t addresses[2] = {SENSOR_I2C_ADDRESS,
                                other_address(SENSOR_I2C_ADDRESS)};
  for (int i = 0; i < 2; i++) {
    if (init_desc(addresses[i]) != ESP_OK) continue;
    esp_err_t err = i2c_dev_check_present(&s_dev.i2c_dev);
    if (err == ESP_OK) {
      uint8_t id = 0;
      err = i2c_dev_take_mutex(&s_dev.i2c_dev);
      if (err == ESP_OK) {
        err = i2c_dev_read_reg(&s_dev.i2c_dev, BMX280_REG_CHIP_ID, &id, 1);
        i2c_dev_give_mutex(&s_dev.i2c_dev);
      }
      if (err == ESP_OK) {
        free_desc();
        *chip_id = id;
        *address = addresses[i];
        ESP_LOGI(TAG, "Detect: I2C chip at 0x%02X, chip ID 0x%02X",
                 addresses[i], id);
        return true;
      }
    }
    ESP_LOGI(TAG, "Detect: no I2C chip at 0x%02X (%s)", addresses[i],
             esp_err_to_name(err));
  }
  free_desc();
  return false;
}

static esp_err_t bmx_ensure_chip(int model) {
  if (s_chip_ready) return ESP_OK;
  esp_err_t err = i2c_ready();
  if (err != ESP_OK) return err;
  bmp280_params_t params;
  bmp280_init_default_params(&params);

  // Modules strap SDO to GND (0x76) or VCC (0x77): try the last known
  // address first, then the other one.
  const uint8_t addresses[2] = {s_address, other_address(s_address)};
  for (int i = 0; i < 2; i++) {
    err = init_desc(addresses[i]);
    if (err != ESP_OK) continue;
    // Address-only probe first: bmp280_init() on an absent chip goes
    // through the driver retries and logs an error for each.
    err = i2c_dev_check_present(&s_dev.i2c_dev);
    if (err == ESP_OK) err = bmp280_init(&s_dev, &params);
    if (err == ESP_OK) {
      s_address = addresses[i];
      break;
    }
    ESP_LOGW(TAG, "%s not found at 0x%02X (%s)", sensor_logic_model_name(model),
             addresses[i], esp_err_to_name(err));
  }
  if (err != ESP_OK) {
    free_desc();
    ESP_LOGW(TAG, "%s not found at 0x76 nor 0x77: check VCC/GND/SDA/SCL wiring",
             sensor_logic_model_name(model));
    return err;
  }

  bool is_bme = s_dev.id == BME280_CHIP_ID;
  if (model == SENSOR_BME280 && !is_bme) {
    ESP_LOGW(TAG, "Configured BME280 but the chip is a BMP280: no humidity");
  } else if (model == SENSOR_BMP280 && is_bme) {
    ESP_LOGW(TAG, "Configured BMP280 but the chip is a BME280: humidity ignored");
  }
  ESP_LOGI(TAG, "%s on I2C SDA=GPIO%d SCL=GPIO%d addr=0x%02X (chip ID 0x%02X)",
           sensor_logic_model_name(model), SENSOR_I2C_SDA_GPIO,
           SENSOR_I2C_SCL_GPIO, s_address, s_dev.id);
  s_chip_ready = true;
  // Let the first conversion finish in normal mode.
  vTaskDelay(pdMS_TO_TICKS(100));
  return ESP_OK;
}

static esp_err_t bmx_read(int model, sensor_reading_t *out) {
  esp_err_t err = bmx_ensure_chip(model);
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

// ---------------------------------------------------------------------------
// Model switching and autodetection (telemetry task)
// ---------------------------------------------------------------------------

static bool is_dht(int model) {
  return model == SENSOR_DHT11 || model == SENSOR_DHT22;
}

static void hw_release(void) {
  free_desc();
  s_hw_model = SENSOR_NONE;
}

static int detect(void) {
  ESP_LOGI(TAG, "Autodetecting the sensor: I2C SDA=GPIO%d SCL=GPIO%d at "
                "0x76/0x77, then DHT on GPIO%d",
           SENSOR_I2C_SDA_GPIO, SENSOR_I2C_SCL_GPIO, SENSOR_DHT_GPIO);
  sensor_probe_t probe;
  memset(&probe, 0, sizeof(probe));
  uint8_t address = SENSOR_I2C_ADDRESS;
  probe.i2c_answered = i2c_probe(&probe.i2c_chip_id, &address);
  if (probe.i2c_answered &&
      sensor_logic_model_from_chip_id(probe.i2c_chip_id) == SENSOR_NONE) {
    ESP_LOGW(TAG, "Detect: chip ID 0x%02X is not a BMP280/BME280, ignored",
             probe.i2c_chip_id);
  }

  if (sensor_logic_detect(&probe) == SENSOR_NONE) {
    // The dht driver logs an error for every read nobody answers.
    esp_log_level_t dht_level = esp_log_level_get("dht");
    esp_log_level_set("dht", ESP_LOG_NONE);
    dht_probe(DHT_TYPE_AM2301, &probe.dht22);
    if (!probe.dht22.answered ||
        !sensor_logic_dht22_plausible(probe.dht22.temperature,
                                      probe.dht22.relative_humidity)) {
      // A DHT11 frame decoded as DHT22 reads > 100 % humidity: decode the
      // pin as DHT11 (dht_read_once() keeps the 2 s gap between reads).
      dht_probe(DHT_TYPE_DHT11, &probe.dht11);
    }
    esp_log_level_set("dht", dht_level);
  }

  int model = sensor_logic_detect(&probe);
  if (model == SENSOR_BMP280 || model == SENSOR_BME280) s_address = address;
  return model;
}

// Runs the autodetection when the setting is "auto", no model is in use and
// it is due (requested, first time, or SENSOR_DETECT_RETRY_SEC elapsed).
// Returns the model to use (SENSOR_NONE: none).
static int resolve_model(void) {
  xSemaphoreTake(s_lock, portMAX_DELAY);
  int model = s_model;
  bool auto_setting = s_setting == SENSOR_SETTING_AUTO;
  bool requested = s_detect_now || s_state == SENSOR_STATE_DETECTING;
  s_detect_now = false;
  xSemaphoreGive(s_lock);

  if (!auto_setting || model != SENSOR_NONE) return model;
  int64_t now = esp_timer_get_time();
  if (!requested && now < s_next_detect_us) return SENSOR_NONE;

  hw_release();
  int found = detect();
  s_next_detect_us = esp_timer_get_time() + SENSOR_DETECT_RETRY_SEC * 1000000LL;

  // Keep the result only if no newer setting / request arrived meanwhile.
  xSemaphoreTake(s_lock, portMAX_DELAY);
  bool current = s_setting == SENSOR_SETTING_AUTO && s_model == SENSOR_NONE &&
                 !s_detect_now;
  if (current) {
    s_detected = found;
    s_model = found;
    s_state = found != SENSOR_NONE ? SENSOR_STATE_READY
                                   : SENSOR_STATE_NOT_DETECTED;
  }
  xSemaphoreGive(s_lock);
  if (!current) return SENSOR_NONE;

  if (found != SENSOR_NONE) {
    ESP_LOGI(TAG, "Detected %s; stored in NVS, not detected again on boot",
             sensor_logic_model_name(found));
    nvs_write_value(NVS_KEY_DETECTED, sensor_logic_model_key(found));
  } else {
    ESP_LOGW(TAG, "No sensor detected (no BMP280/BME280 on I2C, no DHT11/DHT22 "
                  "on GPIO%d): nothing is published; retrying every %d s",
             SENSOR_DHT_GPIO, SENSOR_DETECT_RETRY_SEC);
  }
  return found;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

esp_err_t sensor_init(void) {
  if (s_lock == NULL) {
    s_lock = xSemaphoreCreateMutex();
    if (s_lock == NULL) return ESP_ERR_NO_MEM;
  }

  char value[NVS_VALUE_MAX];
  int setting = SENSOR_SETTING_AUTO;
  if (nvs_read_value(NVS_KEY_SETTING, value, sizeof(value)) &&
      !sensor_logic_parse_setting(value, &setting)) {
    ESP_LOGW(TAG, "Invalid sensor setting '%s' in NVS: using auto", value);
    setting = SENSOR_SETTING_AUTO;
  }
  int detected = SENSOR_NONE;
  if (nvs_read_value(NVS_KEY_DETECTED, value, sizeof(value))) {
    detected = sensor_logic_model_from_key(value);
  }

  xSemaphoreTake(s_lock, portMAX_DELAY);
  s_setting = setting;
  s_detected = detected;
  s_model = sensor_logic_effective_model(setting, detected);
  s_state = s_model != SENSOR_NONE ? SENSOR_STATE_READY
                                   : SENSOR_STATE_DETECTING;
  xSemaphoreGive(s_lock);

  if (setting != SENSOR_SETTING_AUTO) {
    ESP_LOGI(TAG, "Sensor setting: %s (manual)",
             sensor_logic_model_name(setting));
  } else if (detected != SENSOR_NONE) {
    ESP_LOGI(TAG, "Sensor setting: auto, %s detected earlier",
             sensor_logic_model_name(detected));
  } else {
    ESP_LOGI(TAG, "Sensor setting: auto, detecting on the first reading");
  }
  return ESP_OK;
}

esp_err_t sensor_read(sensor_reading_t *out, int *model_out) {
  if (out == NULL) return ESP_ERR_INVALID_ARG;
  memset(out, 0, sizeof(*out));
  if (model_out) *model_out = SENSOR_NONE;
  if (s_lock == NULL) return ESP_ERR_INVALID_STATE;

  int model = resolve_model();
  if (model == SENSOR_NONE) {
    hw_release();
    return ESP_ERR_NOT_FOUND;
  }
  if (model != s_hw_model) {
    hw_release(); // e.g. leave the I2C bus when switching to a DHT
    s_hw_model = model;
    ESP_LOGI(TAG, "Using %s", sensor_logic_model_name(model));
  }

  esp_err_t err = is_dht(model) ? dht_read(model, out) : bmx_read(model, out);
  bool valid = err == ESP_OK && sensor_logic_sanitize(model, out);

  xSemaphoreTake(s_lock, portMAX_DELAY);
  if (valid && s_model == model) {
    s_last = *out;
    s_last_model = model;
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
  if (model_out) *model_out = model;
  return ESP_OK;
}

bool sensor_get_last(sensor_reading_t *out, int *model, int64_t *age_seconds) {
  if (s_lock == NULL) return false;
  xSemaphoreTake(s_lock, portMAX_DELAY);
  bool has = s_has_last && s_last_model == s_model;
  if (has) {
    if (out) *out = s_last;
    if (model) *model = s_last_model;
    if (age_seconds) {
      *age_seconds = (esp_timer_get_time() - s_last_us) / 1000000LL;
    }
  }
  xSemaphoreGive(s_lock);
  return has;
}

void sensor_get_status(sensor_status_t *out) {
  if (out == NULL) return;
  memset(out, 0, sizeof(*out));
  out->setting = SENSOR_SETTING_AUTO;
  out->state = SENSOR_STATE_DETECTING;
  if (s_lock == NULL) return;
  xSemaphoreTake(s_lock, portMAX_DELAY);
  out->setting = s_setting;
  out->model = s_model;
  out->auto_detected = s_setting == SENSOR_SETTING_AUTO && s_model != SENSOR_NONE;
  out->state = s_state;
  xSemaphoreGive(s_lock);
}

esp_err_t sensor_set_setting(int setting) {
  const char *key = sensor_logic_setting_key(setting);
  if (key == NULL) return ESP_ERR_INVALID_ARG;
  if (s_lock == NULL) return ESP_ERR_INVALID_STATE;
  esp_err_t err = nvs_write_value(NVS_KEY_SETTING, key);
  if (err != ESP_OK) return err;

  bool redetect = false;
  xSemaphoreTake(s_lock, portMAX_DELAY);
  int previous = s_setting;
  s_setting = setting;
  if (setting != SENSOR_SETTING_AUTO) {
    s_model = setting;
    s_state = SENSOR_STATE_READY;
  } else if (previous != SENSOR_SETTING_AUTO) {
    // Back to "auto" from a manual model: the old detection may be stale.
    redetect = true;
    s_detected = SENSOR_NONE;
    s_model = SENSOR_NONE;
    s_state = SENSOR_STATE_DETECTING;
    s_detect_now = true;
  }
  xSemaphoreGive(s_lock);

  if (redetect) nvs_write_value(NVS_KEY_DETECTED, NULL);
  ESP_LOGI(TAG, "Sensor setting saved: %s%s", key,
           redetect ? " (detecting again)" : "");
  return ESP_OK;
}

esp_err_t sensor_request_detection(void) {
  if (s_lock == NULL) return ESP_ERR_INVALID_STATE;
  esp_err_t err = nvs_write_value(NVS_KEY_SETTING, "auto");
  if (err != ESP_OK) return err;
  nvs_write_value(NVS_KEY_DETECTED, NULL);

  xSemaphoreTake(s_lock, portMAX_DELAY);
  s_setting = SENSOR_SETTING_AUTO;
  s_detected = SENSOR_NONE;
  s_model = SENSOR_NONE;
  s_state = SENSOR_STATE_DETECTING;
  s_detect_now = true;
  xSemaphoreGive(s_lock);
  ESP_LOGI(TAG, "Sensor detection requested");
  return ESP_OK;
}

const char *sensor_state_name(sensor_state_t state) {
  switch (state) {
  case SENSOR_STATE_READY:
    return "ready";
  case SENSOR_STATE_NOT_DETECTED:
    return "not_detected";
  case SENSOR_STATE_DETECTING:
  default:
    return "detecting";
  }
}
