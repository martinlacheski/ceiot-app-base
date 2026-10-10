/*
 * time_sync.h
 *
 * System clock: SNTP, then GET {backend}/api/public/time, then MQTT
 * iot/devices/{serial}/time/request (rules in time_sync_logic.h).
 */

#ifndef TIME_SYNC_H
#define TIME_SYNC_H

#include <stdbool.h>
#include <stddef.h>

#include "esp_err.h"
#include "time_sync_logic.h"

// Starts SNTP and the fallback task.
esp_err_t time_sync_init(void);

// Whether MQTT may start connecting (see time_sync_mqtt_may_start()). Once
// true it stays true.
bool time_sync_mqtt_ready(void);

// Where the current clock came from.
time_source_t time_sync_get_source(void);

// Handles a message received on iot/devices/{serial}/time.
void time_sync_on_mqtt_time(const char *data, int len);

// Effective backend base URL: NVS "backend_url", or http://<broker>:18000.
void time_sync_get_backend_url(char *out, size_t out_size);

#endif // TIME_SYNC_H
