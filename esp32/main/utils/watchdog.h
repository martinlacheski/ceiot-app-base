/*
 * watchdog.h
 * 
 * Gestión del Task Watchdog Timer (TWDT)
 */

#ifndef WATCHDOG_H
#define WATCHDOG_H

#include "esp_err.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

#ifdef __cplusplus
extern "C" {
#endif

// Inicializar watchdog
esp_err_t watchdog_init(void);

// Agregar tarea al watchdog
esp_err_t watchdog_add_task(TaskHandle_t task_handle);

// Alimentar watchdog (tarea actual)
esp_err_t watchdog_feed(void);

// Alimentar watchdog de una tarea específica
esp_err_t watchdog_feed_task(TaskHandle_t task_handle);

// Verificar si watchdog está inicializado
bool watchdog_is_initialized(void);

#ifdef __cplusplus
}
#endif

#endif // WATCHDOG_H
