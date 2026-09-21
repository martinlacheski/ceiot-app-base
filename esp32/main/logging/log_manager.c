/*
 * log_manager.c
 * 
 * Implementación del sistema de gestión de logs
 */

#include "log_manager.h"
#include "esp_log.h"
#include "esp_err.h"
#include <string.h>
#include <time.h>
#include <sys/time.h>
#include <stdarg.h>

static const char *TAG = "LOG_MANAGER";

// Estado del log manager
static struct {
    bool fs_enabled;
    FILE *log_file;
    char current_date[11];  // "YYYY-MM-DD"
    size_t current_size;
    uint32_t max_file_size;  // 500KB
} log_state = {
    .fs_enabled = false,
    .log_file = NULL,
    .current_date = {0},
    .current_size = 0,
    .max_file_size = 500 * 1024  // 500KB
};

// Obtener fecha actual en formato YYYY-MM-DD
static void get_current_date_string(char *date_str, size_t len)
{
    time_t now;
    struct tm timeinfo;
    
    time(&now);
    localtime_r(&now, &timeinfo);
    
    snprintf(date_str, len, "%04d-%02d-%02d", 
             timeinfo.tm_year + 1900,
             timeinfo.tm_mon + 1,
             timeinfo.tm_mday);
}

// Generar nombre de archivo de log
__attribute__((unused)) static void get_log_filename(char *filename, size_t len, const char *date)
{
    snprintf(filename, len, "/littlefs/logs/system_%s.log", date);
}

esp_err_t log_manager_init(void)
{
    ESP_LOGI(TAG, "Inicializando sistema de logs...");
    
    // Por ahora solo logging a UART (LittleFS se habilitará después)
    log_state.fs_enabled = false;
    log_state.log_file = NULL;
    
    get_current_date_string(log_state.current_date, sizeof(log_state.current_date));
    
    ESP_LOGI(TAG, "Sistema de logs inicializado (solo UART por ahora)");
    ESP_LOGI(TAG, "LittleFS logging se habilitará cuando LittleFS esté disponible");
    
    return ESP_OK;
}

esp_err_t log_manager_enable_filesystem(bool enable)
{
    if (enable && !log_state.fs_enabled) {
        // TODO: Abrir archivo de log en LittleFS cuando esté disponible
        // Por ahora solo marcamos como habilitado
        log_state.fs_enabled = true;
        ESP_LOGI(TAG, "Logging a LittleFS habilitado (pendiente de implementar)");
    } else if (!enable && log_state.fs_enabled) {
        if (log_state.log_file) {
            fclose(log_state.log_file);
            log_state.log_file = NULL;
        }
        log_state.fs_enabled = false;
        ESP_LOGI(TAG, "Logging a LittleFS deshabilitado");
    }
    
    return ESP_OK;
}

void log_manager_write(log_level_t level, const char *tag, const char *format, ...)
{
    // Por ahora solo usamos el sistema de logs estándar de ESP-IDF
    // La escritura a archivo se implementará cuando LittleFS esté disponible
    va_list args;
    va_start(args, format);
    
    switch (level) {
        case LOG_LEVEL_ERROR:
            esp_log_write(ESP_LOG_ERROR, tag, format, args);
            break;
        case LOG_LEVEL_WARN:
            esp_log_write(ESP_LOG_WARN, tag, format, args);
            break;
        case LOG_LEVEL_INFO:
            esp_log_write(ESP_LOG_INFO, tag, format, args);
            break;
        case LOG_LEVEL_DEBUG:
            esp_log_write(ESP_LOG_DEBUG, tag, format, args);
            break;
        case LOG_LEVEL_VERBOSE:
            esp_log_write(ESP_LOG_VERBOSE, tag, format, args);
            break;
    }
    
    va_end(args);
}

void log_manager_rotate_if_needed(void)
{
    // TODO: Implementar rotación de logs cuando LittleFS esté disponible
    // - Verificar si cambió la fecha
    // - Verificar si el archivo excede max_file_size
    // - Crear nuevo archivo si es necesario
    // - Eliminar logs antiguos (> 7 días)
}

esp_err_t log_manager_get_recent_logs(char *buffer, size_t buffer_size, 
                                       log_level_t min_level, uint32_t max_lines)
{
    // TODO: Implementar lectura de logs desde LittleFS
    (void)buffer;
    (void)buffer_size;
    (void)min_level;
    (void)max_lines;
    return ESP_ERR_NOT_FINISHED;
}

esp_err_t log_manager_cleanup_old_logs(void)
{
    // TODO: Implementar limpieza de logs antiguos (> 7 días)
    return ESP_ERR_NOT_FINISHED;
}
