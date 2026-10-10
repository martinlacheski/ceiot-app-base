/*
 * led_manager.c
 */

#include "led_manager.h"

#include "driver/gpio.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "pins_config.h"

static const char *TAG = "LED";

#define LED_TICK_MS 50

static volatile bool s_wifi_connected = false;
static volatile bool s_ap_active = false;
static volatile bool s_mqtt_connected = false;
static volatile led_override_t s_override = LED_OVERRIDE_NONE;

// Returns whether the LED is lit `t_ms` milliseconds into the pattern.
static bool led_level_at(uint32_t t_ms) {
  switch (s_override) {
  case LED_OVERRIDE_SOLID:
    return true;
  case LED_OVERRIDE_BLINK_FAST:
    return (t_ms % 100) < 50;
  case LED_OVERRIDE_NONE:
  default:
    break;
  }
  if (s_ap_active) return (t_ms % 300) < 150;
  if (s_mqtt_connected) return true;
  if (s_wifi_connected) return (t_ms % 1000) < 500;
  return (t_ms % 2000) < 100;
}

static void led_task(void *arg) {
  (void)arg;
  uint32_t t_ms = 0;
  while (1) {
    bool on = led_level_at(t_ms);
    gpio_set_level(STATUS_LED_GPIO,
                   on ? STATUS_LED_ON_LEVEL : !STATUS_LED_ON_LEVEL);
    vTaskDelay(pdMS_TO_TICKS(LED_TICK_MS));
    t_ms += LED_TICK_MS;
  }
}

esp_err_t led_manager_init(void) {
  gpio_config_t led = {
      .pin_bit_mask = 1ULL << STATUS_LED_GPIO,
      .mode = GPIO_MODE_OUTPUT,
      .pull_up_en = GPIO_PULLUP_DISABLE,
      .pull_down_en = GPIO_PULLDOWN_DISABLE,
      .intr_type = GPIO_INTR_DISABLE,
  };
  esp_err_t err = gpio_config(&led);
  if (err != ESP_OK) return err;
  if (xTaskCreate(led_task, "led_task", 2048, NULL, 2, NULL) != pdPASS) {
    return ESP_ERR_NO_MEM;
  }
  ESP_LOGI(TAG, "Status LED on GPIO%d", STATUS_LED_GPIO);
  return ESP_OK;
}

void led_set_wifi_connected(bool connected) { s_wifi_connected = connected; }
void led_set_ap_active(bool active) { s_ap_active = active; }
void led_set_mqtt_connected(bool connected) { s_mqtt_connected = connected; }
void led_set_override(led_override_t override) { s_override = override; }
