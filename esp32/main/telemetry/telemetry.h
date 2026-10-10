/*
 * telemetry.h
 *
 * Periodic sensor reading + publication on iot/devices/{serial}/telemetry.
 */

#ifndef TELEMETRY_H
#define TELEMETRY_H

#include "esp_err.h"

// Starts the task that reads the sensor every TELEMETRY_INTERVAL_SEC and
// publishes the reading while MQTT is connected.
esp_err_t telemetry_start(void);

// Wakes the task up to read and publish right away (e.g. on MQTT connect, or
// to apply a sensor setting saved from the web UI).
void telemetry_request_now(void);

#endif // TELEMETRY_H
