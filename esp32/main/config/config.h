/*
 * config.h
 *
 * Build-time device configuration. Edit this file to choose the sensor
 * variant of the image and its pins, then rebuild and flash.
 */

#ifndef CONFIG_H
#define CONFIG_H

// ---------------------------------------------------------------------------
// Sensor variant: exactly one per firmware image.
// ---------------------------------------------------------------------------
#define SENSOR_DHT11 1  // temperature, relative_humidity
#define SENSOR_DHT22 2  // temperature, relative_humidity (also AM2302)
#define SENSOR_BMP280 3 // temperature, pressure
#define SENSOR_BME280 4 // temperature, relative_humidity, pressure

// Default variant. A build can override it without editing this file:
//   idf.py -B build-dht11 -DCEIOT_SENSOR=dht11 build   (dht11|dht22|bmp280|bme280)
// main/CMakeLists.txt maps it to -DSENSOR_MODEL=SENSOR_<VARIANT>.
#ifndef SENSOR_MODEL
#define SENSOR_MODEL SENSOR_DHT22
#endif

#if SENSOR_MODEL != SENSOR_DHT11 && SENSOR_MODEL != SENSOR_DHT22 &&           \
    SENSOR_MODEL != SENSOR_BMP280 && SENSOR_MODEL != SENSOR_BME280
#error "SENSOR_MODEL must be SENSOR_DHT11, SENSOR_DHT22, SENSOR_BMP280 or SENSOR_BME280"
#endif

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

#endif // CONFIG_H
