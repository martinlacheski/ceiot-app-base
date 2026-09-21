/* Generic device display for the environmental IoT firmware. */

#include "display_manager.h"
#include "driver/gpio.h"
#include "driver/spi_master.h"
#include "esp_heap_caps.h"
#include "esp_lcd_axs15231b.h"
#include "esp_lcd_panel_io.h"
#include "esp_lcd_panel_ops.h"
#include "esp_lcd_panel_vendor.h"
#include "esp_log.h"
#include "pins_config.h"

static const char *TAG = "DISPLAY";

#define LCD_H_RES 240
#define LCD_V_RES 320
#define LINEBUF_LINES 8
#define LCD_COLOR_BACKGROUND 0x001F
#define LCD_COLOR_FOREGROUND 0xFFFF

static const axs15231b_lcd_init_cmd_t lcd_init_cmds[] = {
    {0xBB, (uint8_t[]){0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x5A, 0xA5}, 8, 0},
    {0xA0, (uint8_t[]){0xC0, 0x10, 0x00, 0x02, 0x00, 0x00, 0x04, 0x3F, 0x20, 0x05, 0x3F, 0x3F, 0x00, 0x00, 0x00, 0x00, 0x00}, 17, 0},
    {0xA2, (uint8_t[]){0x30, 0x3C, 0x24, 0x14, 0xD0, 0x20, 0xFF, 0xE0, 0x40, 0x19, 0x80, 0x80, 0x80, 0x20, 0xF9, 0x10, 0x02, 0xFF, 0xFF, 0xF0, 0x90, 0x01, 0x32, 0xA0, 0x91, 0xE0, 0x20, 0x7F, 0xFF, 0x00, 0x5A}, 31, 0},
    {0xD0, (uint8_t[]){0xE0, 0x40, 0x51, 0x24, 0x08, 0x05, 0x10, 0x01, 0x20, 0x15, 0x42, 0xC2, 0x22, 0x22, 0xAA, 0x03, 0x10, 0x12, 0x60, 0x14, 0x1E, 0x51, 0x15, 0x00, 0x8A, 0x20, 0x00, 0x03, 0x3A, 0x12}, 30, 0},
    {0x11, (uint8_t[]){0x00}, 0, 120},
};

static esp_lcd_panel_io_handle_t s_io = NULL;
static esp_lcd_panel_handle_t s_panel = NULL;
static uint16_t *s_linebuf = NULL;
static bool s_ready = false;

static bool iot_mark_pixel(int x, int y) {
  const int top = 120;
  const int height = 80;
  const int stroke = 10;
  if (y < top || y >= top + height) return false;
  if (x >= 35 && x < 35 + stroke) return true;
  if (x >= 75 && x < 135) {
    return x < 75 + stroke || x >= 135 - stroke || y < top + stroke ||
           y >= top + height - stroke;
  }
  if (x >= 165 && x < 225) {
    return y < top + stroke || (x >= 190 && x < 200);
  }
  return false;
}

static void render_status_screen(void) {
  if (!s_ready || s_panel == NULL || s_linebuf == NULL) return;

  for (int y0 = 0; y0 < LCD_V_RES; y0 += LINEBUF_LINES) {
    int lines = LINEBUF_LINES;
    if (y0 + lines > LCD_V_RES) lines = LCD_V_RES - y0;
    for (int row = 0; row < lines; row++) {
      int y = y0 + row;
      for (int x = 0; x < LCD_H_RES; x++) {
        s_linebuf[row * LCD_H_RES + x] =
            iot_mark_pixel(x, y) ? LCD_COLOR_FOREGROUND : LCD_COLOR_BACKGROUND;
      }
    }
    esp_lcd_panel_draw_bitmap(s_panel, 0, y0, LCD_H_RES, y0 + lines, s_linebuf);
  }
}

void display_manager_init(void) {
  if (s_ready) return;

  gpio_config_t backlight = {
      .pin_bit_mask = 1ULL << LCD_PIN_BL,
      .mode = GPIO_MODE_OUTPUT,
      .pull_up_en = GPIO_PULLUP_DISABLE,
      .pull_down_en = GPIO_PULLDOWN_DISABLE,
      .intr_type = GPIO_INTR_DISABLE,
  };
  gpio_config(&backlight);
  gpio_set_level(LCD_PIN_BL, 1);

  const spi_bus_config_t bus = AXS15231B_PANEL_BUS_QSPI_CONFIG(
      LCD_PIN_QSPI_SCLK, LCD_PIN_QSPI_DATA0, LCD_PIN_QSPI_DATA1,
      LCD_PIN_QSPI_DATA2, LCD_PIN_QSPI_DATA3,
      LINEBUF_LINES * LCD_H_RES * sizeof(uint16_t));
  esp_err_t err = spi_bus_initialize(LCD_SPI_HOST, &bus, SPI_DMA_CH_AUTO);
  if (err != ESP_OK && err != ESP_ERR_INVALID_STATE) {
    ESP_LOGE(TAG, "Display bus initialization failed: %s", esp_err_to_name(err));
    return;
  }

  esp_lcd_panel_io_spi_config_t io_config =
      AXS15231B_PANEL_IO_QSPI_CONFIG(LCD_PIN_CS, NULL, NULL);
  io_config.pclk_hz = LCD_PIXEL_CLOCK_HZ;
  if (esp_lcd_new_panel_io_spi((esp_lcd_spi_bus_handle_t)LCD_SPI_HOST,
                               &io_config, &s_io) != ESP_OK) {
    ESP_LOGE(TAG, "Display I/O initialization failed");
    return;
  }

  const axs15231b_vendor_config_t vendor_config = {
      .init_cmds = lcd_init_cmds,
      .init_cmds_size = sizeof(lcd_init_cmds) / sizeof(lcd_init_cmds[0]),
      .flags = {.use_qspi_interface = 1},
  };
  const esp_lcd_panel_dev_config_t panel_config = {
      .reset_gpio_num = LCD_PIN_RST,
      .rgb_ele_order = LCD_RGB_ELEMENT_ORDER_RGB,
      .bits_per_pixel = 16,
      .vendor_config = (void *)&vendor_config,
  };
  if (esp_lcd_new_panel_axs15231b(s_io, &panel_config, &s_panel) != ESP_OK) {
    ESP_LOGE(TAG, "Display panel initialization failed");
    return;
  }

  ESP_ERROR_CHECK(esp_lcd_panel_reset(s_panel));
  ESP_ERROR_CHECK(esp_lcd_panel_init(s_panel));
  ESP_ERROR_CHECK(esp_lcd_panel_swap_xy(s_panel, false));
  ESP_ERROR_CHECK(esp_lcd_panel_mirror(s_panel, false, false));
  ESP_ERROR_CHECK(esp_lcd_panel_disp_on_off(s_panel, true));

  s_linebuf = heap_caps_malloc(LCD_H_RES * LINEBUF_LINES * sizeof(uint16_t),
                               MALLOC_CAP_DMA);
  if (s_linebuf == NULL) {
    ESP_LOGE(TAG, "Display line buffer allocation failed");
    return;
  }

  s_ready = true;
  render_status_screen();
  ESP_LOGI(TAG, "Generic IOT status screen initialized");
}

void display_show_status(void) {
  if (!s_ready) display_manager_init();
  render_status_screen();
}
