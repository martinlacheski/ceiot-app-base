/*
 * telemetry_payload.h
 *
 * JSON payloads of the backend device contract (see
 * tools/emulador-dispositivo.py). Pure C + cJSON, host-tested.
 */

#ifndef TELEMETRY_PAYLOAD_H
#define TELEMETRY_PAYLOAD_H

#include <stdbool.h>

#include "sensor_logic.h"

// iot/devices/{serial}/telemetry:
//   {"sensors":{"<key>":{"<variable>":<float>,...}},"uptime":<int>,
//    "firmware_version":"<version>"}
// Only the variables with has_* set are included, rounded to 2 decimals.
// Returns a malloc'd string (caller frees) or NULL when there is nothing to
// publish (no valid variable, missing key or allocation failure).
char *telemetry_payload_build(const char *sensor_key,
                              const sensor_reading_t *reading,
                              long uptime_seconds,
                              const char *firmware_version);

// iot/devices/{serial}/status (retained): {"serial":"...","status":"online"}
// or "offline" (Last Will). Returns a malloc'd string or NULL.
char *telemetry_presence_build(const char *serial, bool online);

#endif // TELEMETRY_PAYLOAD_H
