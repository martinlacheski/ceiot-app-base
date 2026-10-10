/*
 * sensor_logic.c
 */

#include "sensor_logic.h"

#include <ctype.h>
#include <math.h>
#include <stddef.h>
#include <string.h>

typedef struct {
  float min;
  float max;
} range_t;

const char *sensor_logic_model_key(int model) {
  switch (model) {
  case SENSOR_DHT11:
    return "dht11";
  case SENSOR_DHT22:
    return "dht22";
  case SENSOR_BMP280:
    return "bmp280";
  case SENSOR_BME280:
    return "bme280";
  default:
    return NULL;
  }
}

const char *sensor_logic_model_name(int model) {
  switch (model) {
  case SENSOR_DHT11:
    return "DHT11";
  case SENSOR_DHT22:
    return "DHT22";
  case SENSOR_BMP280:
    return "BMP280";
  case SENSOR_BME280:
    return "BME280";
  default:
    return "?";
  }
}

bool sensor_logic_measures_humidity(int model) {
  return model == SENSOR_DHT11 || model == SENSOR_DHT22 ||
         model == SENSOR_BME280;
}

bool sensor_logic_measures_pressure(int model) {
  return model == SENSOR_BMP280 || model == SENSOR_BME280;
}

// Operating ranges from the datasheets, widened a little so a real reading at
// the edge is not lost; anything outside is a bus/decoding error.
static range_t temperature_range(int model) {
  switch (model) {
  case SENSOR_DHT11:
    return (range_t){-10.0f, 60.0f};
  case SENSOR_DHT22:
    return (range_t){-40.0f, 80.0f};
  default:
    return (range_t){-40.0f, 85.0f};
  }
}

static bool in_range(float value, range_t range) {
  return isfinite(value) && value >= range.min && value <= range.max;
}

bool sensor_logic_sanitize(int model, sensor_reading_t *reading) {
  if (reading == NULL) return false;
  if (sensor_logic_model_key(model) == NULL) {
    reading->has_temperature = false;
    reading->has_relative_humidity = false;
    reading->has_pressure = false;
    return false;
  }
  bool is_dht = model == SENSOR_DHT11 || model == SENSOR_DHT22;
  bool dht_frame = is_dht && reading->has_temperature && reading->has_relative_humidity;

  if (reading->has_temperature &&
      !in_range(reading->temperature, temperature_range(model))) {
    reading->has_temperature = false;
  }
  if (reading->has_relative_humidity &&
      (!sensor_logic_measures_humidity(model) ||
       !in_range(reading->relative_humidity, (range_t){0.0f, 100.0f}))) {
    reading->has_relative_humidity = false;
  }
  if (reading->has_pressure &&
      (!sensor_logic_measures_pressure(model) ||
       !in_range(reading->pressure, (range_t){300.0f, 1100.0f}))) {
    reading->has_pressure = false;
  }

  // Both DHT values come from one frame: if either is out of range the frame
  // is not trustworthy (a saturated/faulty DHT22 reports 125 C with 100 %),
  // so the other value is dropped too instead of publishing it alone.
  if (dht_frame && (!reading->has_temperature || !reading->has_relative_humidity)) {
    reading->has_temperature = false;
    reading->has_relative_humidity = false;
  }

  // A DHT frame of all zeros passes the checksum but is a failed read.
  if (is_dht && reading->has_temperature && reading->has_relative_humidity &&
      reading->temperature == 0.0f && reading->relative_humidity == 0.0f) {
    reading->has_temperature = false;
    reading->has_relative_humidity = false;
  }

  return reading->has_temperature || reading->has_relative_humidity ||
         reading->has_pressure;
}

bool sensor_logic_is_model(int model) {
  return model >= SENSOR_DHT11 && model <= SENSOR_BME280;
}

static bool equals_ignore_case(const char *a, const char *b) {
  while (*a && *b) {
    if (tolower((unsigned char)*a) != tolower((unsigned char)*b)) return false;
    a++;
    b++;
  }
  return *a == *b;
}

bool sensor_logic_parse_setting(const char *text, int *setting) {
  if (text == NULL || setting == NULL) return false;
  if (equals_ignore_case(text, "auto")) {
    *setting = SENSOR_SETTING_AUTO;
    return true;
  }
  for (int model = SENSOR_DHT11; model <= SENSOR_BME280; model++) {
    if (equals_ignore_case(text, sensor_logic_model_key(model))) {
      *setting = model;
      return true;
    }
  }
  return false;
}

const char *sensor_logic_setting_key(int setting) {
  if (setting == SENSOR_SETTING_AUTO) return "auto";
  return sensor_logic_model_key(setting);
}

int sensor_logic_model_from_key(const char *key) {
  if (key == NULL) return SENSOR_NONE;
  for (int model = SENSOR_DHT11; model <= SENSOR_BME280; model++) {
    if (strcmp(key, sensor_logic_model_key(model)) == 0) return model;
  }
  return SENSOR_NONE;
}

int sensor_logic_effective_model(int setting, int detected) {
  if (setting == SENSOR_SETTING_AUTO) {
    return sensor_logic_is_model(detected) ? detected : SENSOR_NONE;
  }
  return sensor_logic_is_model(setting) ? setting : SENSOR_NONE;
}

int sensor_logic_model_from_chip_id(uint8_t chip_id) {
  switch (chip_id) {
  case 0x60:
    return SENSOR_BME280;
  case 0x56:
  case 0x57:
  case 0x58:
    return SENSOR_BMP280;
  default:
    return SENSOR_NONE;
  }
}

bool sensor_logic_dht22_plausible(float temperature, float relative_humidity) {
  if (!in_range(temperature, (range_t){-40.0f, 80.0f}) ||
      !in_range(relative_humidity, (range_t){0.0f, 100.0f})) {
    return false;
  }
  return !(temperature == 0.0f && relative_humidity == 0.0f);
}

bool sensor_logic_dht11_plausible(float temperature, float relative_humidity) {
  return in_range(temperature, (range_t){0.0f, 50.0f}) &&
         in_range(relative_humidity, (range_t){5.0f, 95.0f}) &&
         fabsf(relative_humidity - roundf(relative_humidity)) < 0.05f;
}

int sensor_logic_detect(const sensor_probe_t *probe) {
  if (probe == NULL) return SENSOR_NONE;
  if (probe->i2c_answered) {
    int model = sensor_logic_model_from_chip_id(probe->i2c_chip_id);
    if (model != SENSOR_NONE) return model;
  }
  if (probe->dht22.answered &&
      sensor_logic_dht22_plausible(probe->dht22.temperature,
                                   probe->dht22.relative_humidity)) {
    return SENSOR_DHT22;
  }
  if (probe->dht11.answered &&
      sensor_logic_dht11_plausible(probe->dht11.temperature,
                                   probe->dht11.relative_humidity)) {
    return SENSOR_DHT11;
  }
  return SENSOR_NONE;
}
