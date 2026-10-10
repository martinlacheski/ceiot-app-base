/* Host tests for main/sensor/sensor_logic.c */
#include <math.h>
#include <string.h>

#include "sensor_logic.h"
#include "test_util.h"

static sensor_reading_t full_reading(float t, float rh, float p) {
  sensor_reading_t r = {.has_temperature = true,
                        .temperature = t,
                        .has_relative_humidity = true,
                        .relative_humidity = rh,
                        .has_pressure = true,
                        .pressure = p};
  return r;
}

static void test_model_keys_match_backend_catalog(void) {
  CHECK(strcmp(sensor_logic_model_key(SENSOR_DHT11), "dht11") == 0);
  CHECK(strcmp(sensor_logic_model_key(SENSOR_DHT22), "dht22") == 0);
  CHECK(strcmp(sensor_logic_model_key(SENSOR_BMP280), "bmp280") == 0);
  CHECK(strcmp(sensor_logic_model_key(SENSOR_BME280), "bme280") == 0);
  CHECK(sensor_logic_model_key(0) == NULL);
  CHECK(strcmp(sensor_logic_model_name(SENSOR_BME280), "BME280") == 0);
  CHECK(strcmp(sensor_logic_model_name(99), "?") == 0);
}

static void test_variables_per_model(void) {
  CHECK(sensor_logic_measures_humidity(SENSOR_DHT11));
  CHECK(sensor_logic_measures_humidity(SENSOR_DHT22));
  CHECK(!sensor_logic_measures_humidity(SENSOR_BMP280));
  CHECK(sensor_logic_measures_humidity(SENSOR_BME280));
  CHECK(!sensor_logic_measures_pressure(SENSOR_DHT11));
  CHECK(!sensor_logic_measures_pressure(SENSOR_DHT22));
  CHECK(sensor_logic_measures_pressure(SENSOR_BMP280));
  CHECK(sensor_logic_measures_pressure(SENSOR_BME280));
}

static void test_dht22_keeps_temperature_and_humidity_only(void) {
  sensor_reading_t r = full_reading(23.4f, 51.2f, 1013.0f);
  CHECK(sensor_logic_sanitize(SENSOR_DHT22, &r));
  CHECK(r.has_temperature && r.has_relative_humidity);
  CHECK(!r.has_pressure);
}

static void test_bmp280_drops_humidity(void) {
  sensor_reading_t r = full_reading(21.0f, 40.0f, 1009.5f);
  CHECK(sensor_logic_sanitize(SENSOR_BMP280, &r));
  CHECK(r.has_temperature && r.has_pressure);
  CHECK(!r.has_relative_humidity);
}

static void test_bme280_keeps_all_three(void) {
  sensor_reading_t r = full_reading(21.0f, 40.0f, 1009.5f);
  CHECK(sensor_logic_sanitize(SENSOR_BME280, &r));
  CHECK(r.has_temperature && r.has_relative_humidity && r.has_pressure);
}

static void test_out_of_range_and_nan_values_are_dropped(void) {
  sensor_reading_t r = full_reading(NAN, 140.0f, 1013.0f);
  CHECK(!sensor_logic_sanitize(SENSOR_DHT22, &r));
  CHECK(!r.has_temperature && !r.has_relative_humidity && !r.has_pressure);

  r = full_reading(25.0f, 50.0f, 150.0f); /* pressure below 300 hPa */
  CHECK(sensor_logic_sanitize(SENSOR_BME280, &r));
  CHECK(r.has_temperature && r.has_relative_humidity && !r.has_pressure);

  r = full_reading(70.0f, 50.0f, 0.0f); /* DHT11 cannot read 70 C */
  CHECK(sensor_logic_sanitize(SENSOR_DHT11, &r));
  CHECK(!r.has_temperature && r.has_relative_humidity);

  r = full_reading(-45.0f, 50.0f, 1000.0f);
  CHECK(sensor_logic_sanitize(SENSOR_BMP280, &r));
  CHECK(!r.has_temperature && r.has_pressure);
}

static void test_dht_all_zero_frame_is_a_failed_read(void) {
  sensor_reading_t r = full_reading(0.0f, 0.0f, 0.0f);
  CHECK(!sensor_logic_sanitize(SENSOR_DHT11, &r));
  CHECK(!r.has_temperature && !r.has_relative_humidity);

  r = full_reading(0.0f, 35.0f, 0.0f); /* 0 C with real humidity is fine */
  CHECK(sensor_logic_sanitize(SENSOR_DHT22, &r));
  CHECK(r.has_temperature && r.has_relative_humidity);
}

static void test_values_not_flagged_stay_absent(void) {
  sensor_reading_t r = {0};
  CHECK(!sensor_logic_sanitize(SENSOR_BME280, &r));
  CHECK(!sensor_logic_sanitize(SENSOR_BME280, NULL));
  r = full_reading(20.0f, 50.0f, 1000.0f);
  CHECK(!sensor_logic_sanitize(42, &r));
  CHECK(!r.has_temperature);
}

int main(void) {
  RUN(test_model_keys_match_backend_catalog);
  RUN(test_variables_per_model);
  RUN(test_dht22_keeps_temperature_and_humidity_only);
  RUN(test_bmp280_drops_humidity);
  RUN(test_bme280_keeps_all_three);
  RUN(test_out_of_range_and_nan_values_are_dropped);
  RUN(test_dht_all_zero_frame_is_a_failed_read);
  RUN(test_values_not_flagged_stay_absent);
  TEST_MAIN_END();
}
