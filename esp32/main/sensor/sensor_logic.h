/*
 * sensor_logic.h
 *
 * Hardware-independent sensor rules: the backend key of each variant, the
 * variables it measures and the plausibility checks applied before a value
 * is published. Pure C (host-tested in esp32/tests/).
 */

#ifndef SENSOR_LOGIC_H
#define SENSOR_LOGIC_H

#include <stdbool.h>

#include "config.h"

typedef struct {
  bool has_temperature;
  float temperature; // degrees Celsius
  bool has_relative_humidity;
  float relative_humidity; // percent
  bool has_pressure;
  float pressure; // hPa
} sensor_reading_t;

// Backend sensor-catalog key ("dht11", "dht22", "bmp280", "bme280"), or NULL
// for an unknown model.
const char *sensor_logic_model_key(int model);

// Human-readable variant name ("DHT22", ...), or "?" for an unknown model.
const char *sensor_logic_model_name(int model);

// Whether the model measures each variable.
bool sensor_logic_measures_humidity(int model);
bool sensor_logic_measures_pressure(int model);

// Drops (clears the has_* flag of) every value the model does not measure,
// that is not finite, or that is outside the sensor's physical range.
// Returns true if at least one value is left.
bool sensor_logic_sanitize(int model, sensor_reading_t *reading);

#endif // SENSOR_LOGIC_H
