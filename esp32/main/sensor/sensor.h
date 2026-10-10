/*
 * sensor.h
 *
 * The environmental sensor. Every image drives the DHT11, DHT22, BMP280 and
 * BME280; the model in use is a runtime setting kept in NVS ("storage"):
 *
 *   sensor_model     "auto" (default) or dht11 | dht22 | bmp280 | bme280
 *   sensor_detected  model found by the last autodetection ("auto" only)
 *
 * The sensor hardware is only touched from the telemetry task
 * (sensor_read()); the web server changes the setting through
 * sensor_set_setting() / sensor_request_detection() and the telemetry task
 * applies it on its next cycle (wake it with telemetry_request_now()).
 */

#ifndef SENSOR_H
#define SENSOR_H

#include <stdbool.h>
#include <stdint.h>

#include "esp_err.h"
#include "sensor_logic.h"

typedef enum {
  SENSOR_STATE_DETECTING = 0, // "auto" with a detection pending
  SENSOR_STATE_READY,         // a model is in use
  SENSOR_STATE_NOT_DETECTED,  // "auto" and nothing found; retried periodically
} sensor_state_t;

typedef struct {
  int setting;        // SENSOR_SETTING_AUTO or a model
  int model;          // model in use, SENSOR_NONE when there is none
  bool auto_detected; // the model comes from autodetection
  sensor_state_t state;
  // BMP280/BME280 chip last seen on the I2C bus this boot (detection or
  // initialization); chip_seen false when the last probe found none.
  bool chip_seen;
  uint8_t chip_id;      // register 0xD0: 0x60 BME280, 0x58 BMP280
  uint8_t chip_address; // 0x76 or 0x77
} sensor_status_t;

// Loads the setting and the last detected model from NVS. No hardware
// access: a missing sensor is not fatal, reads detect / retry it.
esp_err_t sensor_init(void);

// Telemetry task only. Applies a pending setting change, runs the
// autodetection when it is due and takes a reading with the model in use.
// Values that failed or are implausible are left out (has_* = false).
// `*model` (nullable) gets the model the reading came from. Returns ESP_OK
// when at least one variable is valid, ESP_ERR_NOT_FOUND when no sensor is
// in use ("auto" and nothing detected), another error otherwise.
esp_err_t sensor_read(sensor_reading_t *out, int *model);

// Last valid reading, its model and its age in seconds (all nullable); false
// if there is none for the model in use.
bool sensor_get_last(sensor_reading_t *out, int *model, int64_t *age_seconds);

void sensor_get_status(sensor_status_t *out);

// Stores a new setting (SENSOR_SETTING_AUTO or a model). Switching to "auto"
// from a manual model detects again; "auto" over "auto" keeps the detected
// model. ESP_ERR_INVALID_ARG for an invalid setting.
esp_err_t sensor_set_setting(int setting);

// "Detectar de nuevo": setting "auto", forget the detected model and detect
// again on the next telemetry cycle.
esp_err_t sensor_request_detection(void);

// "detecting", "ready" or "not_detected".
const char *sensor_state_name(sensor_state_t state);

#endif // SENSOR_H
