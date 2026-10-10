/*
 * sensor_logic.c
 */

#include "sensor_logic.h"

#include <math.h>
#include <stddef.h>

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

  // A DHT frame of all zeros passes the checksum but is a failed read.
  bool is_dht = model == SENSOR_DHT11 || model == SENSOR_DHT22;
  if (is_dht && reading->has_temperature && reading->has_relative_humidity &&
      reading->temperature == 0.0f && reading->relative_humidity == 0.0f) {
    reading->has_temperature = false;
    reading->has_relative_humidity = false;
  }

  return reading->has_temperature || reading->has_relative_humidity ||
         reading->has_pressure;
}
