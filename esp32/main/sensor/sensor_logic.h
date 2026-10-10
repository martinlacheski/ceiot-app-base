/*
 * sensor_logic.h
 *
 * Hardware-independent sensor rules: the supported models and their backend
 * keys, the runtime sensor setting ("auto" or a model), the autodetection
 * decision, the variables each model measures and the plausibility checks
 * applied before a value is published. Pure C (host-tested in esp32/tests/).
 */

#ifndef SENSOR_LOGIC_H
#define SENSOR_LOGIC_H

#include <stdbool.h>
#include <stdint.h>

// Sensor models. Every image drives all of them; which one is used is a
// runtime setting (NVS "storage"/"sensor_model").
#define SENSOR_NONE 0   // no sensor (autodetection found nothing)
#define SENSOR_DHT11 1  // temperature, relative_humidity
#define SENSOR_DHT22 2  // temperature, relative_humidity (also AM2302)
#define SENSOR_BMP280 3 // temperature, pressure
#define SENSOR_BME280 4 // temperature, relative_humidity, pressure

// Sensor setting: SENSOR_SETTING_AUTO (autodetect) or one of the models.
#define SENSOR_SETTING_AUTO 0

typedef struct {
  bool has_temperature;
  float temperature; // degrees Celsius
  bool has_relative_humidity;
  float relative_humidity; // percent
  bool has_pressure;
  float pressure; // hPa
} sensor_reading_t;

// Backend sensor-catalog key ("dht11", "dht22", "bmp280", "bme280"), or NULL
// for an unknown model.
const char *sensor_logic_model_key(int model);

// Human-readable variant name ("DHT22", ...), or "?" for an unknown model.
const char *sensor_logic_model_name(int model);

// Whether the model measures each variable.
bool sensor_logic_measures_humidity(int model);
bool sensor_logic_measures_pressure(int model);

// Drops (clears the has_* flag of) every value the model does not measure,
// that is not finite, or that is outside the sensor's physical range.
// Returns true if at least one value is left.
bool sensor_logic_sanitize(int model, sensor_reading_t *reading);

// --- Runtime setting -------------------------------------------------------

// Whether `model` is one of the four supported models.
bool sensor_logic_is_model(int model);

// "auto", "dht11", "dht22", "bmp280" or "bme280" (case-insensitive) into a
// setting. False (and `*setting` untouched) for anything else.
bool sensor_logic_parse_setting(const char *text, int *setting);

// "auto" or the model key, NULL for an invalid setting.
const char *sensor_logic_setting_key(int setting);

// Model of a backend key ("dht22" -> SENSOR_DHT22), SENSOR_NONE otherwise.
int sensor_logic_model_from_key(const char *key);

// Model in use: a manual setting wins; "auto" uses the detected model
// (SENSOR_NONE when nothing was detected).
int sensor_logic_effective_model(int setting, int detected);

// --- Autodetection ---------------------------------------------------------

// BMP280/BME280 chip ID register (0xD0): 0x60 BME280; 0x58 BMP280 (0x56 and
// 0x57 on early BMP280 samples). SENSOR_NONE for any other value.
int sensor_logic_model_from_chip_id(uint8_t chip_id);

// One DHT frame (checksum valid = answered) decoded as a given type.
typedef struct {
  bool answered;
  float temperature;
  float relative_humidity;
} sensor_probe_dht_t;

// What the probes found: the I2C chip at 0x76/0x77, and the DHT on its pin
// read as DHT22 (AM2301 decoding) and as DHT11.
typedef struct {
  bool i2c_answered;
  uint8_t i2c_chip_id;
  sensor_probe_dht_t dht22;
  sensor_probe_dht_t dht11;
} sensor_probe_t;

// DHT22 decoding plausible: humidity 0-100 %, temperature -40..80 C, not the
// all-zero frame.
bool sensor_logic_dht22_plausible(float temperature, float relative_humidity);

// DHT11 decoding plausible: integer humidity 5-95 %, temperature 0..50 C.
bool sensor_logic_dht11_plausible(float temperature, float relative_humidity);

// The detected model: a known I2C chip first, else a plausible DHT22
// decoding, else a plausible DHT11 decoding, else SENSOR_NONE. A DHT11 frame
// decoded as DHT22 gives a humidity far above 100 % (the integer byte lands
// in the high byte), which is what tells the two apart.
int sensor_logic_detect(const sensor_probe_t *probe);

#endif // SENSOR_LOGIC_H
