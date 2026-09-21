/*
 * pins_config.h
 *
 * Configuración de pines GPIO para dispositivo IOT ESP32-S3-WROOM-1 N16R8
 */

#ifndef PINS_CONFIG_H
#define PINS_CONFIG_H

#include "driver/gpio.h"
#include "esp_err.h"
#include "driver/uart.h"

#ifdef __cplusplus
extern "C" {
#endif

// ============================================
// Display TFT AXS15231B (QSPI sobre SPI2)
// ============================================
#define LCD_SPI_HOST    SPI2_HOST
#define LCD_PIN_QSPI_SCLK    5
#define LCD_PIN_QSPI_DATA0   1
#define LCD_PIN_QSPI_DATA1   2
#define LCD_PIN_QSPI_DATA2   3
#define LCD_PIN_QSPI_DATA3   4
#define LCD_PIN_CS           12
#define LCD_PIN_BL           6
#define LCD_PIN_RST          (-1)
#define LCD_PIXEL_CLOCK_HZ   (40 * 1000 * 1000)

// ============================================
// Bus I2C para bootstrap del display
// ============================================
#define DISPLAY_I2C_PORT    I2C_NUM_0
#define DISPLAY_I2C_SDA     8
#define DISPLAY_I2C_SCL     7

// ============================================
// Touch controlador (XPT2046 compatible)
// SPI compartido con TFT ILI9341
// ============================================
#define TOUCH_MVP_ENABLED    0
#define TOUCH_PIN_CS         1
#define TOUCH_PIN_IRQ        2

// ============================================
// LED de estado (NeoPixel onboard)
// ============================================
#define LED_STATUS_NEOPIXEL_GPIO 48

// Modelo de NeoPixel para pruebas de campo:
// - LED_STATUS_NEOPIXEL_MODEL_WS2812
// - LED_STATUS_NEOPIXEL_MODEL_SK6812
#define LED_STATUS_NEOPIXEL_MODEL_WS2812 1
#define LED_STATUS_NEOPIXEL_MODEL_SK6812 2
#define LED_STATUS_NEOPIXEL_MODEL LED_STATUS_NEOPIXEL_MODEL_WS2812

// Orden de color para pruebas de campo:
// - LED_STATUS_NEOPIXEL_ORDER_GRB
// - LED_STATUS_NEOPIXEL_ORDER_RGB
#define LED_STATUS_NEOPIXEL_ORDER_GRB 1
#define LED_STATUS_NEOPIXEL_ORDER_RGB 2
#define LED_STATUS_NEOPIXEL_COLOR_ORDER LED_STATUS_NEOPIXEL_ORDER_GRB

// ============================================
// Sensores de Temperatura DS18B20 (1-Wire)
// ============================================
#define TEMP_HOT_GPIO       38
#define TEMP_COLD_GPIO      39
#define TEMP_ICE_GPIO       40

// Compatibilidad interna
#define TEMP_SENSOR_1_GPIO  TEMP_HOT_GPIO
#define TEMP_SENSOR_2_GPIO  TEMP_COLD_GPIO
#define TEMP_SENSOR_3_GPIO  TEMP_ICE_GPIO
#define TEMP_SENSOR_GPIO    TEMP_SENSOR_1_GPIO

// ============================================
// Módem 4G A7670SA (UART1)
// BK-A7670SA board: TX/RX en UART1 dedicado para evitar conflicto con consola
// PWRKEY y SLEEP cableados físicamente
// ============================================
#define MODEM_UART_PORT         UART_NUM_1
#define MODEM_UART_TX_GPIO      15      // ESP32 TX → MODEM RXD (pin R)
#define MODEM_UART_RX_GPIO      16      // ESP32 RX ← MODEM TXD (pin T)
#define MODEM_PWRKEY_GPIO       41
#define MODEM_SLEEP_GPIO        42
#define MODEM_BAUD_RATE         115200
#define MODEM_AT_DIAG_BEFORE_MODEM_CREATE 1

// ============================================
// Botones
// ============================================
#define BUTTON_RESET_GPIO       0   // BOOT Button: Press=Reboot, Hold 5s=Factory Reset
#define BUTTON_AP_MODE_GPIO     3   // Activa Access Point manualmente
#define BUTTON_AP_MODE_ENABLED  0

// ============================================
// Configuración de Pull-up
// ============================================
#define BUTTON_RESET_PULLUP     GPIO_PULLUP_ONLY
#define BUTTON_AP_MODE_PULLUP   GPIO_PULLUP_ONLY

// ============================================
// Funciones
// ============================================
void pins_config_init(void);
esp_err_t pins_config_prepare_display_bootstrap(void);

#ifdef __cplusplus
}
#endif

#endif // PINS_CONFIG_H
