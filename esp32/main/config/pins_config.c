/*
 * pins_config.c
 * 
 * Inicialización de pines GPIO
 */

#include "pins_config.h"
#include "driver/gpio.h"
#include "driver/i2c_master.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

static const char *TAG = "PINS_CONFIG";

#define DISPLAY_BOOTSTRAP_I2C_SPEED_HZ 100000
#define TCA9554_ADDR 0x20
#define AXP2101_ADDR 0x34
#define TCA9554_REG_OUTPUT 0x01
#define TCA9554_REG_CONFIG 0x03
#define TCA9554_EXIO1_MASK 0x02

static esp_err_t i2c_write_reg8(i2c_master_dev_handle_t dev_handle, uint8_t reg,
                                uint8_t value, const char *dev_name)
{
    uint8_t payload[2] = {reg, value};
    esp_err_t err = i2c_master_transmit(dev_handle, payload, sizeof(payload), 50);
    if (err != ESP_OK) {
        ESP_LOGW(TAG, "%s write reg 0x%02X fallo: %s", dev_name, reg,
                 esp_err_to_name(err));
    }
    return err;
}

static esp_err_t i2c_read_reg8(i2c_master_dev_handle_t dev_handle, uint8_t reg,
                               uint8_t *value, const char *dev_name)
{
    esp_err_t err = i2c_master_transmit_receive(dev_handle, &reg, 1, value, 1, 50);
    if (err != ESP_OK) {
        ESP_LOGW(TAG, "%s read reg 0x%02X fallo: %s", dev_name, reg,
                 esp_err_to_name(err));
    }
    return err;
}

esp_err_t pins_config_prepare_display_bootstrap(void)
{
    ESP_LOGI(TAG,
             "Display bootstrap temprano: I2C SCL=GPIO%d SDA=GPIO%d",
             DISPLAY_I2C_SCL, DISPLAY_I2C_SDA);

    i2c_master_bus_handle_t i2c_bus = NULL;
    i2c_master_dev_handle_t tca_dev = NULL;

    i2c_master_bus_config_t bus_cfg = {
        .i2c_port = DISPLAY_I2C_PORT,
        .sda_io_num = DISPLAY_I2C_SDA,
        .scl_io_num = DISPLAY_I2C_SCL,
        .clk_source = I2C_CLK_SRC_DEFAULT,
        .glitch_ignore_cnt = 7,
        .intr_priority = 0,
        .trans_queue_depth = 0,
        .flags.enable_internal_pullup = true,
        .flags.allow_pd = false,
    };

    esp_err_t err = i2c_new_master_bus(&bus_cfg, &i2c_bus);
    if (err != ESP_OK) {
        ESP_LOGW(TAG, "No se pudo crear bus I2C bootstrap: %s", esp_err_to_name(err));
        return ESP_OK;
    }

    err = i2c_master_probe(i2c_bus, TCA9554_ADDR, 50);
    if (err == ESP_OK) {
        ESP_LOGI(TAG, "TCA9554 detectado en 0x%02X", TCA9554_ADDR);
    } else {
        ESP_LOGW(TAG, "TCA9554 no detectado en 0x%02X: %s", TCA9554_ADDR,
                 esp_err_to_name(err));
    }

    err = i2c_master_probe(i2c_bus, AXP2101_ADDR, 50);
    if (err == ESP_OK) {
        ESP_LOGI(TAG, "AXP2101 detectado en 0x%02X", AXP2101_ADDR);
    } else {
        ESP_LOGW(TAG, "AXP2101 no detectado en 0x%02X: %s", AXP2101_ADDR,
                 esp_err_to_name(err));
    }

    i2c_device_config_t tca_dev_cfg = {
        .dev_addr_length = I2C_ADDR_BIT_LEN_7,
        .device_address = TCA9554_ADDR,
        .scl_speed_hz = DISPLAY_BOOTSTRAP_I2C_SPEED_HZ,
        .scl_wait_us = 0,
        .flags.disable_ack_check = false,
    };

    err = i2c_master_bus_add_device(i2c_bus, &tca_dev_cfg, &tca_dev);
    if (err != ESP_OK) {
        ESP_LOGW(TAG, "No se pudo crear handle TCA9554: %s", esp_err_to_name(err));
    } else {
        uint8_t cfg_reg = 0xFF;
        uint8_t out_reg = 0x00;

        err = i2c_read_reg8(tca_dev, TCA9554_REG_CONFIG, &cfg_reg, "TCA9554");
        if (err != ESP_OK) {
            ESP_LOGE(TAG, "Reset display abortado: no se pudo leer CONFIG de TCA9554: %s",
                     esp_err_to_name(err));
            goto tca_cleanup;
        }
        ESP_LOGI(TAG, "TCA9554 config inicial: 0x%02X", cfg_reg);

        err = i2c_read_reg8(tca_dev, TCA9554_REG_OUTPUT, &out_reg, "TCA9554");
        if (err != ESP_OK) {
            ESP_LOGE(TAG, "Reset display abortado: no se pudo leer OUTPUT de TCA9554: %s",
                     esp_err_to_name(err));
            goto tca_cleanup;
        }
        ESP_LOGI(TAG, "TCA9554 output inicial: 0x%02X", out_reg);

        cfg_reg &= (uint8_t)~TCA9554_EXIO1_MASK;
        err = i2c_write_reg8(tca_dev, TCA9554_REG_CONFIG, cfg_reg, "TCA9554");
        if (err != ESP_OK) {
            ESP_LOGE(TAG, "Reset display abortado: no se pudo escribir CONFIG de TCA9554: %s",
                     esp_err_to_name(err));
            goto tca_cleanup;
        }

        uint8_t out_low = (uint8_t)(out_reg & (uint8_t)~TCA9554_EXIO1_MASK);
        uint8_t out_high = (uint8_t)(out_reg | TCA9554_EXIO1_MASK);

        ESP_LOGI(TAG, "TCA9554 reset display (EXIO1): LOW 100ms");
        err = i2c_write_reg8(tca_dev, TCA9554_REG_OUTPUT, out_low, "TCA9554");
        if (err != ESP_OK) {
            ESP_LOGE(TAG, "Reset display abortado: no se pudo forzar LOW en EXIO1: %s",
                     esp_err_to_name(err));
            goto tca_cleanup;
        }
        vTaskDelay(pdMS_TO_TICKS(100));

        ESP_LOGI(TAG, "TCA9554 reset display (EXIO1): HIGH 200ms");
        err = i2c_write_reg8(tca_dev, TCA9554_REG_OUTPUT, out_high, "TCA9554");
        if (err != ESP_OK) {
            ESP_LOGE(TAG, "Reset display abortado: no se pudo forzar HIGH en EXIO1: %s",
                     esp_err_to_name(err));
            goto tca_cleanup;
        }
        vTaskDelay(pdMS_TO_TICKS(200));

        ESP_LOGI(TAG, "Bootstrap display via TCA9554 finalizado");
    }

tca_cleanup:
    if (tca_dev != NULL) {
        esp_err_t rm_err = i2c_master_bus_rm_device(tca_dev);
        if (rm_err != ESP_OK) {
            ESP_LOGW(TAG, "No se pudo remover handle TCA9554: %s",
                     esp_err_to_name(rm_err));
        }
    }

    err = i2c_del_master_bus(i2c_bus);
    if (err != ESP_OK) {
        ESP_LOGW(TAG, "No se pudo liberar bus I2C bootstrap: %s", esp_err_to_name(err));
    }

    return ESP_OK;
}

void pins_config_init(void)
{
    ESP_LOGI(TAG, "Inicializando configuración de pines...");

    // Configurar botones como entradas con pull-up
    uint64_t button_mask = (1ULL << BUTTON_RESET_GPIO);
#if BUTTON_AP_MODE_ENABLED
    button_mask |= (1ULL << BUTTON_AP_MODE_GPIO);
#endif

    gpio_config_t button_config = {
        .pin_bit_mask = button_mask,
        .mode = GPIO_MODE_INPUT,
        .pull_up_en = GPIO_PULLUP_ENABLE,
        .pull_down_en = GPIO_PULLDOWN_DISABLE,
        .intr_type = GPIO_INTR_DISABLE  // Se configurará después si es necesario
    };
    gpio_config(&button_config);
    ESP_LOGI(TAG, "Boton RESET configurado en GPIO%d", BUTTON_RESET_GPIO);
#if BUTTON_AP_MODE_ENABLED
    ESP_LOGI(TAG, "Boton MODO_AP configurado en GPIO%d", BUTTON_AP_MODE_GPIO);
#else
    ESP_LOGW(TAG, "Boton MODO_AP deshabilitado: GPIO%d reservado por LCD QSPI", BUTTON_AP_MODE_GPIO);
#endif

#if TOUCH_MVP_ENABLED
    // Touch IRQ como entrada con pull-up
    gpio_config_t touch_irq_cfg = {
        .pin_bit_mask = (1ULL << TOUCH_PIN_IRQ),
        .mode = GPIO_MODE_INPUT,
        .pull_up_en = GPIO_PULLUP_ENABLE,
        .pull_down_en = GPIO_PULLDOWN_DISABLE,
        .intr_type = GPIO_INTR_DISABLE,
    };
    gpio_config(&touch_irq_cfg);

    // Touch CS en alto por defecto (inactivo)
    gpio_set_direction(TOUCH_PIN_CS, GPIO_MODE_OUTPUT);
    gpio_set_level(TOUCH_PIN_CS, 1);
    ESP_LOGI(TAG, "Touch configurado: CS=GPIO%d IRQ=GPIO%d", TOUCH_PIN_CS,
             TOUCH_PIN_IRQ);
#else
    ESP_LOGW(TAG, "Touch deshabilitado en MVP para evitar conflicto con bus QSPI del display");
#endif

    // Sensores DS18B20 se configurarán en temp_manager
    ESP_LOGI(TAG,
             "Sensores DS18B20: HOT=GPIO%d COLD=GPIO%d ICE=GPIO%d (1-Wire)",
             TEMP_HOT_GPIO, TEMP_COLD_GPIO, TEMP_ICE_GPIO);

    // Módem A7670SA se configura en cellular_manager
    ESP_LOGI(TAG, "Modem UART: TX=GPIO%d RX=GPIO%d PWRKEY=GPIO%d SLEEP=GPIO%d",
             MODEM_UART_TX_GPIO, MODEM_UART_RX_GPIO,
             MODEM_PWRKEY_GPIO, MODEM_SLEEP_GPIO);

    ESP_LOGI(TAG, "Configuración de pines completada");
}
