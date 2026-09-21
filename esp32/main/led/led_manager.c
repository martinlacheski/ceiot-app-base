/*
 * led_manager.c
 *
 * LED de estado con NeoPixel onboard (GPIO configurable en pins_config.h):
 * - INIT: amarillo fijo
 * - OPERATIVO: verde fijo
 * - ERROR: rojo fijo
 */

#include "led_manager.h"

#include "esp_log.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "led_strip.h"
#include "pins_config.h"

#define LED_BLINK_PERIOD_US 300000
#define LED_BRIGHTNESS 180

static const char *TAG = "LED_MANAGER";

#if LED_STATUS_NEOPIXEL_MODEL == LED_STATUS_NEOPIXEL_MODEL_WS2812
#define LED_NEOPIXEL_MODEL LED_MODEL_WS2812
#elif LED_STATUS_NEOPIXEL_MODEL == LED_STATUS_NEOPIXEL_MODEL_SK6812
#define LED_NEOPIXEL_MODEL LED_MODEL_SK6812
#else
#error "LED_STATUS_NEOPIXEL_MODEL invalido en pins_config.h"
#endif

#if LED_STATUS_NEOPIXEL_COLOR_ORDER == LED_STATUS_NEOPIXEL_ORDER_GRB
#define LED_NEOPIXEL_COLOR_ORDER LED_STRIP_COLOR_COMPONENT_FMT_GRB
#elif LED_STATUS_NEOPIXEL_COLOR_ORDER == LED_STATUS_NEOPIXEL_ORDER_RGB
#define LED_NEOPIXEL_COLOR_ORDER LED_STRIP_COLOR_COMPONENT_FMT_RGB
#else
#error "LED_STATUS_NEOPIXEL_COLOR_ORDER invalido en pins_config.h"
#endif

typedef struct {
  bool wifi_connected;
  bool mqtt_connected;
  bool ap_active;
  bool error;
  bool rollback;
} led_flags_t;

typedef enum {
  LED_MIN_INIT = 0,
  LED_MIN_OPERATIONAL,
  LED_MIN_ERROR,
} led_min_state_t;

static portMUX_TYPE s_led_lock = portMUX_INITIALIZER_UNLOCKED;
static led_flags_t s_flags = {0};
static bool s_blink_on = false;
static bool s_blink_timer_running = false;
static bool s_led_ready = false;
static esp_timer_handle_t s_blink_timer = NULL;
static led_strip_handle_t s_led_strip = NULL;

typedef struct {
  uint8_t r;
  uint8_t g;
  uint8_t b;
  bool off;
} led_output_t;

static esp_err_t led_strip_apply_rgb(led_strip_handle_t strip, uint8_t r,
                                     uint8_t g, uint8_t b,
                                     const char *log_context) {
  if (strip == NULL) {
    ESP_LOGW(TAG, "%s: strip nulo al setear RGB", log_context);
    return ESP_ERR_INVALID_ARG;
  }

  esp_err_t err = led_strip_set_pixel(strip, 0, r, g, b);
  if (err != ESP_OK) {
    ESP_LOGE(TAG, "%s: led_strip_set_pixel fallo (R=%u G=%u B=%u): %s",
             log_context, r, g, b, esp_err_to_name(err));
    return err;
  }

  err = led_strip_refresh(strip);
  if (err != ESP_OK) {
    ESP_LOGE(TAG, "%s: led_strip_refresh fallo (R=%u G=%u B=%u): %s",
             log_context, r, g, b, esp_err_to_name(err));
    return err;
  }

  return ESP_OK;
}

static esp_err_t led_strip_apply_off(led_strip_handle_t strip,
                                     const char *log_context) {
  if (strip == NULL) {
    ESP_LOGW(TAG, "%s: strip nulo al apagar LED", log_context);
    return ESP_ERR_INVALID_ARG;
  }

  esp_err_t err = led_strip_clear(strip);
  if (err != ESP_OK) {
    ESP_LOGE(TAG, "%s: led_strip_clear fallo: %s", log_context,
             esp_err_to_name(err));
    return err;
  }

  return ESP_OK;
}

static void led_apply_rgb(uint8_t r, uint8_t g, uint8_t b) {
  if (!s_led_ready || s_led_strip == NULL) {
    return;
  }
  (void)led_strip_apply_rgb(s_led_strip, r, g, b, "led_apply_rgb");
}

static void led_apply_off(void) {
  if (!s_led_ready || s_led_strip == NULL) {
    return;
  }
  (void)led_strip_apply_off(s_led_strip, "led_apply_off");
}

static led_min_state_t led_compute_state_locked(void) {
  if (s_flags.error || s_flags.rollback) {
    return LED_MIN_ERROR;
  }
  if (!s_flags.wifi_connected || !s_flags.mqtt_connected || s_flags.ap_active) {
    return LED_MIN_INIT;
  }
  return LED_MIN_OPERATIONAL;
}

static led_output_t led_build_output_locked(void) {
  led_output_t out = {.r = 0, .g = 0, .b = 0, .off = false};

  switch (led_compute_state_locked()) {
  case LED_MIN_ERROR:
    out.r = LED_BRIGHTNESS;
    break;
  case LED_MIN_OPERATIONAL:
    out.g = LED_BRIGHTNESS;
    break;
  case LED_MIN_INIT:
  default:
    out.r = LED_BRIGHTNESS;
    out.g = LED_BRIGHTNESS;
    break;
  }

  return out;
}

static void led_apply_output(led_output_t out) {
  if (out.off) {
    led_apply_off();
    return;
  }
  led_apply_rgb(out.r, out.g, out.b);
}

static esp_err_t led_create_strip_for_gpio(int gpio_num,
                                           led_strip_handle_t *out_strip) {
  led_strip_config_t strip_config = {
      .strip_gpio_num = gpio_num,
      .max_leds = 1,
      .led_model = LED_NEOPIXEL_MODEL,
      .color_component_format = LED_NEOPIXEL_COLOR_ORDER,
  };
  led_strip_rmt_config_t rmt_config = {
      .resolution_hz = 10 * 1000 * 1000,
      .flags.with_dma = false,
  };
  esp_err_t err = led_strip_new_rmt_device(&strip_config, &rmt_config, out_strip);
  if (err != ESP_OK) {
    ESP_LOGE(TAG,
             "led_strip_new_rmt_device fallo (gpio=%d model=%d order=%d): %s",
             gpio_num, LED_STATUS_NEOPIXEL_MODEL, LED_STATUS_NEOPIXEL_COLOR_ORDER,
             esp_err_to_name(err));
    return err;
  }

  ESP_LOGI(TAG, "NeoPixel inicializado (gpio=%d model=%d order=%d)", gpio_num,
           LED_STATUS_NEOPIXEL_MODEL, LED_STATUS_NEOPIXEL_COLOR_ORDER);
  return ESP_OK;
}

static void led_blink_cb(void *arg) {
  (void)arg;
  led_output_t out;
  bool refresh = false;

  portENTER_CRITICAL(&s_led_lock);
  s_blink_on = !s_blink_on;
  portEXIT_CRITICAL(&s_led_lock);

  if (refresh) {
    led_apply_output(out);
  }
}

static bool led_need_blink_locked(void) { return false; }

static void led_sync_blink_timer(bool need_blink) {

  if (need_blink && !s_blink_timer_running && s_blink_timer != NULL) {
    if (esp_timer_start_periodic(s_blink_timer, LED_BLINK_PERIOD_US) == ESP_OK) {
      s_blink_timer_running = true;
      s_blink_on = true;
    }
  } else if (!need_blink && s_blink_timer_running && s_blink_timer != NULL) {
    if (esp_timer_stop(s_blink_timer) == ESP_OK) {
      s_blink_timer_running = false;
      s_blink_on = false;
    }
  }
}

static void led_set_flag(bool *target, bool value) {
  led_output_t out;
  bool need_blink;

  portENTER_CRITICAL(&s_led_lock);
  *target = value;
  need_blink = led_need_blink_locked();
  out = led_build_output_locked();
  portEXIT_CRITICAL(&s_led_lock);

  led_sync_blink_timer(need_blink);
  led_apply_output(out);
}

esp_err_t led_manager_init(void) {
  esp_err_t err = led_create_strip_for_gpio(LED_STATUS_NEOPIXEL_GPIO,
                                            &s_led_strip);
  if (err != ESP_OK) {
    ESP_LOGE(TAG,
             "No se pudo crear LED strip principal (gpio=%d model=%d order=%d): %s",
             LED_STATUS_NEOPIXEL_GPIO, LED_STATUS_NEOPIXEL_MODEL,
             LED_STATUS_NEOPIXEL_COLOR_ORDER, esp_err_to_name(err));
    return err;
  }

  esp_timer_create_args_t tcfg = {
      .callback = led_blink_cb,
      .arg = NULL,
      .name = "led_blink",
  };
  err = esp_timer_create(&tcfg, &s_blink_timer);
  if (err != ESP_OK) {
    return err;
  }

  s_flags = (led_flags_t){
      .wifi_connected = false,
      .mqtt_connected = false,
      .ap_active = false,
      .error = false,
      .rollback = false,
  };
  s_blink_on = false;
  s_led_ready = true;
  err = led_strip_apply_off(s_led_strip, "led_manager_init/clear");
  if (err != ESP_OK) {
    ESP_LOGW(TAG, "Continuando init con clear fallido: %s", esp_err_to_name(err));
  }

  portENTER_CRITICAL(&s_led_lock);
  led_output_t out = led_build_output_locked();
  portEXIT_CRITICAL(&s_led_lock);
  led_apply_output(out);

  return ESP_OK;
}

esp_err_t led_manager_start(void) {
  return ESP_OK;
}

void led_set_state(led_state_t state) {
  if (state.pattern == LED_PATTERN_OFF) {
    led_apply_off();
    return;
  }

  led_apply_rgb(state.r, state.g, state.b);
}

void led_set_status(led_status_t status) {
  led_output_t out;
  bool need_blink;

  portENTER_CRITICAL(&s_led_lock);
  switch (status) {
  case LED_STATUS_ERROR_CRITICAL:
  case LED_STATUS_ROLLBACK_OTA:
    s_flags.error = true;
    s_flags.rollback = (status == LED_STATUS_ROLLBACK_OTA);
    break;
  case LED_STATUS_OPERATIONAL:
    s_flags.error = false;
    s_flags.rollback = false;
    s_flags.wifi_connected = true;
    s_flags.mqtt_connected = true;
    s_flags.ap_active = false;
    break;
  case LED_STATUS_INIT:
  case LED_STATUS_WIFI_DISCONNECTED:
  case LED_STATUS_AP_MODE:
  case LED_STATUS_MQTT_DISCONNECTED:
  default:
    s_flags.error = false;
    s_flags.rollback = false;
    break;
  }
  need_blink = led_need_blink_locked();
  out = led_build_output_locked();
  portEXIT_CRITICAL(&s_led_lock);

  led_sync_blink_timer(need_blink);
  led_apply_output(out);
}

void led_set_wifi_connected(bool connected) {
  led_set_flag(&s_flags.wifi_connected, connected);
}

void led_set_ap_active(bool active) { led_set_flag(&s_flags.ap_active, active); }

void led_set_mqtt_connected(bool connected) {
  led_set_flag(&s_flags.mqtt_connected, connected);
}

void led_set_error(bool active) { led_set_flag(&s_flags.error, active); }

void led_set_rollback(bool active) { led_set_flag(&s_flags.rollback, active); }
