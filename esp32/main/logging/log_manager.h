/*
 * log_manager.h
 * 
 * Sistema de gestión de logs para IOT
 * Soporta logging a UART y LittleFS (opcional)
 */

#ifndef LOG_MANAGER_H
#define LOG_MANAGER_H

#include <stdio.h>
#include <stdint.h>
#include <stdbool.h>
#include "esp_log.h"
#include "esp_err.h"

#ifdef __cplusplus
extern "C" {
#endif

// Niveles de log
typedef enum {
    LOG_LEVEL_ERROR = 0,
    LOG_LEVEL_WARN,
    LOG_LEVEL_INFO,
    LOG_LEVEL_DEBUG,
    LOG_LEVEL_VERBOSE
} log_level_t;

// Inicializar sistema de logs
esp_err_t log_manager_init(void);

// Habilitar/deshabilitar logging a LittleFS
esp_err_t log_manager_enable_filesystem(bool enable);

// Escribir log (wrapper para facilitar uso)
void log_manager_write(log_level_t level, const char *tag, const char *format, ...);

// Rotar logs si es necesario (llamar periódicamente)
void log_manager_rotate_if_needed(void);

// Obtener logs recientes
esp_err_t log_manager_get_recent_logs(char *buffer, size_t buffer_size, 
                                       log_level_t min_level, uint32_t max_lines);

// Limpiar logs antiguos
esp_err_t log_manager_cleanup_old_logs(void);

// Macros para facilitar logging por módulo
#define LOG_E(tag, format, ...) ESP_LOGE(tag, format, ##__VA_ARGS__)
#define LOG_W(tag, format, ...) ESP_LOGW(tag, format, ##__VA_ARGS__)
#define LOG_I(tag, format, ...) ESP_LOGI(tag, format, ##__VA_ARGS__)
#define LOG_D(tag, format, ...) ESP_LOGD(tag, format, ##__VA_ARGS__)
#define LOG_V(tag, format, ...) ESP_LOGV(tag, format, ##__VA_ARGS__)

#ifdef __cplusplus
}
#endif

#endif // LOG_MANAGER_H
