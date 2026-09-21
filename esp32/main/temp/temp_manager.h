/*
 * temp_manager.h
 */

#ifndef TEMP_MANAGER_H
#define TEMP_MANAGER_H

#include "esp_err.h"
#include <stdbool.h>
#include <stddef.h>

esp_err_t temp_manager_init(void);
esp_err_t temp_manager_start(void);
bool temp_manager_get_last_temp(float *out_celsius);
bool temp_manager_get_temp_by_index(size_t index, float *out_celsius);
size_t temp_manager_get_sensor_count(void);

void temp_manager_set_enabled(bool enabled);
bool temp_manager_is_enabled(void);

#endif // TEMP_MANAGER_H
