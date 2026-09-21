/*
 * led_manager.h
 *
 * Control de LED RGB con PWM (LEDC)
 */

#ifndef LED_MANAGER_H
#define LED_MANAGER_H

#include "esp_err.h"
#include <stdbool.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef enum {
  LED_PATTERN_OFF = 0,
  LED_PATTERN_SOLID,
  LED_PATTERN_BLINK_SLOW,
  LED_PATTERN_BLINK_FAST,
  LED_PATTERN_PULSE_SLOW,
  LED_PATTERN_PULSE_FAST,
  LED_PATTERN_DOUBLE_BLINK
} led_pattern_t;

typedef struct {
  uint8_t r;
  uint8_t g;
  uint8_t b;
  led_pattern_t pattern;
} led_state_t;

typedef enum {
  LED_STATUS_INIT = 0,
  LED_STATUS_WIFI_DISCONNECTED,
  LED_STATUS_AP_MODE,
  LED_STATUS_MQTT_DISCONNECTED,
  LED_STATUS_OPERATIONAL,
  LED_STATUS_ERROR_CRITICAL,
  LED_STATUS_ROLLBACK_OTA
} led_status_t;

esp_err_t led_manager_init(void);
esp_err_t led_manager_start(void);
void led_set_state(led_state_t state);
void led_set_status(led_status_t status);
void led_set_wifi_connected(bool connected);
void led_set_ap_active(bool active);
void led_set_mqtt_connected(bool connected);
void led_set_error(bool active);
void led_set_rollback(bool active);

#ifdef __cplusplus
}
#endif

#endif // LED_MANAGER_H
