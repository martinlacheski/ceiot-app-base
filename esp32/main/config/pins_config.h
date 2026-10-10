/*
 * pins_config.h
 *
 * Board pins of the ESP32-WROOM-32 environmental device (fixed hardware).
 * Sensor pins are user-editable and live in config.h.
 */

#ifndef PINS_CONFIG_H
#define PINS_CONFIG_H

#include "driver/gpio.h"

#ifdef __cplusplus
extern "C" {
#endif

// BOOT button (active low, external pull-up on the dev boards).
// Hold >= 3 s: start the configuration AP. Hold >= 10 s: factory reset.
#define BUTTON_BOOT_GPIO GPIO_NUM_0

// Plain status LED (blue LED of most ESP32 DevKit boards, active high).
#define STATUS_LED_GPIO GPIO_NUM_2
#define STATUS_LED_ON_LEVEL 1

void pins_config_init(void);

#ifdef __cplusplus
}
#endif

#endif // PINS_CONFIG_H
