/*
 * config.h
 *
 * Build-time device configuration: sensor pins, I2C bus and telemetry
 * period. The sensor model is not chosen here: every image drives the DHT11,
 * DHT22, BMP280 and BME280, and the model is a runtime setting stored in NVS
 * (web UI "Dispositivo", or "sensor" in provisioning.json), autodetected by
 * default.
 */

#ifndef CONFIG_H
#define CONFIG_H

// ---------------------------------------------------------------------------
// Sensor pins
// ---------------------------------------------------------------------------
// DHT11 / DHT22 data line (needs a 4.7-10 kOhm pull-up to 3.3 V; most
// breakout modules already include it).
#define SENSOR_DHT_GPIO 4

// BMP280 / BME280 on I2C.
#define SENSOR_I2C_SDA_GPIO 21
#define SENSOR_I2C_SCL_GPIO 22
#define SENSOR_I2C_ADDRESS 0x76 // 0x77 when the SDO pin is tied high (both are tried)
#define SENSOR_I2C_CLOCK_HZ 100000 // standard mode: reliable on jumper wires

// ---------------------------------------------------------------------------
// Telemetry
// ---------------------------------------------------------------------------
// Seconds between readings published on iot/devices/{serial}/telemetry.
#define TELEMETRY_INTERVAL_SEC 60

// Seconds between autodetection attempts while the setting is "auto" and no
// sensor has been found.
#define SENSOR_DETECT_RETRY_SEC 60

#endif // CONFIG_H
