/*
 * led_manager.h
 *
 * Single-color status LED (STATUS_LED_GPIO). The blink pattern follows the
 * device state, highest priority first:
 *   button feedback (override) > AP active (fast blink) >
 *   MQTT connected (solid on) > Wi-Fi connected (slow blink) > off-line
 *   (short flash every 2 s).
 */

#ifndef LED_MANAGER_H
#define LED_MANAGER_H

#include "esp_err.h"
#include <stdbool.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef enum {
  LED_OVERRIDE_NONE = 0,
  LED_OVERRIDE_SOLID,      // e.g. BOOT button held past the AP threshold
  LED_OVERRIDE_BLINK_FAST, // e.g. BOOT button held past the reset threshold
} led_override_t;

esp_err_t led_manager_init(void);
void led_set_wifi_connected(bool connected);
void led_set_ap_active(bool active);
void led_set_mqtt_connected(bool connected);
void led_set_override(led_override_t override);

#ifdef __cplusplus
}
#endif

#endif // LED_MANAGER_H
