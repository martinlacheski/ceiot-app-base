/*
 * watchdog.c
 *
 * Gestión del Task Watchdog Timer (TWDT) para IOT
 */

#include "watchdog.h"
#include "esp_log.h"
#include "esp_task_wdt.h"

static const char *TAG = "WATCHDOG";

static bool watchdog_initialized = false;

esp_err_t watchdog_init(void) {
  if (watchdog_initialized) {
    ESP_LOGW(TAG, "Watchdog ya está inicializado");
    return ESP_OK;
  }

  // Configurar Task Watchdog Timer (ESP-IDF 5.5 API)
  // Timeout: 30 segundos
  // Panic on timeout: true (reinicia el sistema si una tarea no alimenta el
  // watchdog)
  const esp_task_wdt_config_t wdt_config = {
      .timeout_ms = 30000,  // 30 segundos
      .idle_core_mask = 0,  // No monitorear tareas idle
      .trigger_panic = true // Panic on timeout
  };

  esp_err_t ret = esp_task_wdt_init(&wdt_config);
  if (ret == ESP_ERR_INVALID_STATE) {
    ESP_LOGW(TAG, "Task Watchdog Timer ya estaba inicializado por el sistema. "
                  "Reconfigurando...");
    // Intentar reconfigurar con nuestros parámetros
    ret = esp_task_wdt_reconfigure(&wdt_config);
    if (ret != ESP_OK) {
      ESP_LOGW(TAG,
               "No se pudo reconfigurar el TWDT: %s. Se usará configuración "
               "existente.",
               esp_err_to_name(ret));
      // No retornamos error fatal y continuamos para intentar agregar la tarea
    }
  } else if (ret != ESP_OK) {
    ESP_LOGE(TAG, "Error inicializando watchdog: %s", esp_err_to_name(ret));
    return ret;
  }

  // Agregar tarea principal al watchdog
  ret = esp_task_wdt_add(NULL);
  if (ret != ESP_OK) {
    // Si la tarea ya está suscrita (ESP_ERR_INVALID_STATE), lo ignoramos
    if (ret == ESP_ERR_INVALID_STATE) {
      ESP_LOGW(TAG, "Tarea principal ya estaba suscrita al watchdog");
    } else {
      ESP_LOGE(TAG, "Error agregando tarea al watchdog: %s",
               esp_err_to_name(ret));
      return ret;
    }
  }

  watchdog_initialized = true;
  ESP_LOGI(TAG, "Task Watchdog Timer inicializado (timeout: 30s)");

  return ESP_OK;
}

esp_err_t watchdog_add_task(TaskHandle_t task_handle) {
  if (!watchdog_initialized) {
    ESP_LOGE(TAG, "Watchdog no está inicializado");
    return ESP_ERR_INVALID_STATE;
  }

  esp_err_t ret = esp_task_wdt_add(task_handle);
  if (ret != ESP_OK) {
    ESP_LOGE(TAG, "Error agregando tarea al watchdog: %s",
             esp_err_to_name(ret));
    return ret;
  }

  ESP_LOGI(TAG, "Tarea agregada al watchdog");
  return ESP_OK;
}

esp_err_t watchdog_feed(void) {
  if (!watchdog_initialized) {
    return ESP_ERR_INVALID_STATE;
  }

  return esp_task_wdt_reset();
}

esp_err_t watchdog_feed_task(TaskHandle_t task_handle) {
  if (!watchdog_initialized) {
    return ESP_ERR_INVALID_STATE;
  }

  // En ESP-IDF 5.5, usar esp_task_wdt_reset_user con handle de usuario
  // Por ahora, simplemente resetear el watchdog general
  // Nota: Para resetear una tarea específica, necesitaríamos usar
  // esp_task_wdt_add_user y luego esp_task_wdt_reset_user, pero eso requiere
  // más configuración
  (void)task_handle; // Evitar warning de parámetro no usado
  return esp_task_wdt_reset();
}

bool watchdog_is_initialized(void) { return watchdog_initialized; }
