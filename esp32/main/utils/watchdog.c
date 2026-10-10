/*
 * watchdog.c
 *
 * Gestión del Task Watchdog Timer (TWDT) para IOT
 */

#include "watchdog.h"
#include "esp_log.h"
#include "esp_task_wdt.h"
#include "sdkconfig.h"

static const char *TAG = "WATCHDOG";

static bool watchdog_initialized = false;

esp_err_t watchdog_init(void) {
  if (watchdog_initialized) {
    ESP_LOGW(TAG, "Watchdog ya está inicializado");
    return ESP_OK;
  }

  // With CONFIG_ESP_TASK_WDT_INIT (sdkconfig.defaults) ESP-IDF starts the TWDT
  // before app_main with the sdkconfig settings: 30 s, panic, idle tasks not
  // watched (CONFIG_ESP_TASK_WDT_CHECK_IDLE_TASK_CPU0/1 off). It is used as
  // is. Reconfiguring it here to stop watching the idle tasks raced with the
  // idle hook of the other core: IDLE1, already blocked inside
  // esp_task_wdt_reset() on the TWDT spinlock while app_main unsubscribed it,
  // then logged "E task_wdt: esp_task_wdt_reset(707): task not found".
  esp_err_t ret;
#if !CONFIG_ESP_TASK_WDT_INIT
  const esp_task_wdt_config_t wdt_config = {
      .timeout_ms = 30000,  // 30 s
      .idle_core_mask = 0,  // idle tasks not watched
      .trigger_panic = true // restart when a subscribed task stops feeding it
  };
  ret = esp_task_wdt_init(&wdt_config);
  if (ret != ESP_OK) {
    ESP_LOGE(TAG, "Error configurando el watchdog: %s", esp_err_to_name(ret));
    return ret;
  }
#endif

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
  ESP_LOGI(TAG, "Task Watchdog Timer: main task subscribed (timeout %d s)",
           CONFIG_ESP_TASK_WDT_TIMEOUT_S);

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
