/*
 * network_manager.h
 *
 * Data path (Wi-Fi STA) and system time readiness.
 */

#ifndef NETWORK_MANAGER_H
#define NETWORK_MANAGER_H

#include "esp_err.h"
#include <stdbool.h>

esp_err_t network_manager_init(void);

// True when the Wi-Fi station is associated and has an IP address.
bool network_manager_has_data_path(void);

// True when the system clock holds a plausible wall-clock time.
bool network_manager_is_time_synced(void);

#endif // NETWORK_MANAGER_H
