/*
 * pins_config.c
 */

#include "pins_config.h"

#include "esp_log.h"

static const char *TAG = "PINS";

void pins_config_init(void) {
  gpio_config_t button = {
      .pin_bit_mask = 1ULL << BUTTON_BOOT_GPIO,
      .mode = GPIO_MODE_INPUT,
      .pull_up_en = GPIO_PULLUP_ENABLE,
      .pull_down_en = GPIO_PULLDOWN_DISABLE,
      .intr_type = GPIO_INTR_DISABLE,
  };
  ESP_ERROR_CHECK(gpio_config(&button));
  ESP_LOGI(TAG, "BOOT button on GPIO%d", BUTTON_BOOT_GPIO);
}
