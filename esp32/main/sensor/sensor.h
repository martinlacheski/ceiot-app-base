/*
 * sensor.h
 *
 * The environmental sensor selected by SENSOR_MODEL in config.h.
 */

#ifndef SENSOR_H
#define SENSOR_H

#include <stdbool.h>
#include <stdint.h>

#include "esp_err.h"
#include "sensor_logic.h"

// Prepares the bus / pin. A missing sensor is not fatal: reads retry it.
esp_err_t sensor_init(void);

// Takes a reading and keeps it as the last one when valid. Values that failed
// or are implausible are left out (has_* = false). Returns ESP_OK when at
// least one variable is valid, an error otherwise.
esp_err_t sensor_read(sensor_reading_t *out);

// Last valid reading and its age in seconds; false if there is none yet.
bool sensor_get_last(sensor_reading_t *out, int64_t *age_seconds);

// Backend key ("dht22", ...) and display name ("DHT22", ...) of this image.
const char *sensor_key(void);
const char *sensor_name(void);

#endif // SENSOR_H
