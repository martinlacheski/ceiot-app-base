/*
 * nvs_manager.h
 * Helper module for managing factory snapshots and NVS operations
 */

#pragma once

#include "esp_err.h"
#include <stdbool.h>

// Initializes NVS partitions if not already done
esp_err_t nvs_manager_init(void);

// Saves current configuration (certs + MQTT) to "factory" namespace IF it is
// empty. logic: check key "factory_set". if 0 or not found -> copy current ->
// set "factory_set"=1
esp_err_t save_factory_snapshot(void);

// Restores configuration from "factory" namespace to "storage" and /littlefs
// logic: read keys from "factory" -> write to "storage" / write files
esp_err_t restore_factory_snapshot(void);

bool factory_has_serial(void);
esp_err_t factory_store_serial_if_missing(const char *serial);
esp_err_t factory_store_certs_if_missing(void);
esp_err_t factory_store_tls_snapshot(void);
esp_err_t restore_factory_defaults(void);
