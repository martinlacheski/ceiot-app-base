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

  r = full_reading(70.0f, 50.0f, 0.0f); /* DHT11 cannot read 70 C: whole frame dropped */
  CHECK(!sensor_logic_sanitize(SENSOR_DHT11, &r));
  CHECK(!r.has_temperature && !r.has_relative_humidity);

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

static void test_saturated_dht22_frame_is_dropped_whole(void) {
  /* A faulty/saturated DHT22 reports its maxima: 125 C and 100 %. The 100 %
   * is in range on its own but comes from the same untrustworthy frame. */
  sensor_reading_t r = full_reading(125.0f, 100.0f, 0.0f);
  CHECK(!sensor_logic_sanitize(SENSOR_DHT22, &r));
  CHECK(!r.has_temperature && !r.has_relative_humidity);
}

static void test_values_not_flagged_stay_absent(void) {
  sensor_reading_t r = {0};
  CHECK(!sensor_logic_sanitize(SENSOR_BME280, &r));
  CHECK(!sensor_logic_sanitize(SENSOR_BME280, NULL));
  r = full_reading(20.0f, 50.0f, 1000.0f);
  CHECK(!sensor_logic_sanitize(42, &r));
  CHECK(!r.has_temperature);
}

static void test_setting_parse_and_keys(void) {
  int setting = -1;
  CHECK(sensor_logic_parse_setting("auto", &setting) && setting == SENSOR_SETTING_AUTO);
  CHECK(sensor_logic_parse_setting("dht11", &setting) && setting == SENSOR_DHT11);
  CHECK(sensor_logic_parse_setting("dht22", &setting) && setting == SENSOR_DHT22);
  CHECK(sensor_logic_parse_setting("bmp280", &setting) && setting == SENSOR_BMP280);
  CHECK(sensor_logic_parse_setting("BME280", &setting) && setting == SENSOR_BME280);
  CHECK(sensor_logic_parse_setting("Auto", &setting) && setting == SENSOR_SETTING_AUTO);
  /* invalid values leave the output untouched */
  setting = SENSOR_DHT22;
  const char *bad[] = {"", "dht", "dht222", "ds18b20", " auto", "none", NULL};
  for (unsigned i = 0; i < sizeof(bad) / sizeof(bad[0]); i++) {
    CHECK(!sensor_logic_parse_setting(bad[i], &setting));
  }
  CHECK(setting == SENSOR_DHT22);
  CHECK(!sensor_logic_parse_setting("auto", NULL));

  CHECK(strcmp(sensor_logic_setting_key(SENSOR_SETTING_AUTO), "auto") == 0);
  CHECK(strcmp(sensor_logic_setting_key(SENSOR_BMP280), "bmp280") == 0);
  CHECK(sensor_logic_setting_key(42) == NULL);
  CHECK(sensor_logic_is_model(SENSOR_DHT11) && sensor_logic_is_model(SENSOR_BME280));
  CHECK(!sensor_logic_is_model(SENSOR_NONE) && !sensor_logic_is_model(5));
}

static void test_model_from_key(void) {
  CHECK(sensor_logic_model_from_key("dht22") == SENSOR_DHT22);
  CHECK(sensor_logic_model_from_key("bme280") == SENSOR_BME280);
  CHECK(sensor_logic_model_from_key("auto") == SENSOR_NONE);
  CHECK(sensor_logic_model_from_key("") == SENSOR_NONE);
  CHECK(sensor_logic_model_from_key(NULL) == SENSOR_NONE);
}

static void test_effective_model(void) {
  /* a manual setting wins over any detection */
  CHECK(sensor_logic_effective_model(SENSOR_BMP280, SENSOR_DHT22) == SENSOR_BMP280);
  CHECK(sensor_logic_effective_model(SENSOR_DHT11, SENSOR_NONE) == SENSOR_DHT11);
  /* automatic: the detected model, or none */
  CHECK(sensor_logic_effective_model(SENSOR_SETTING_AUTO, SENSOR_DHT22) == SENSOR_DHT22);
  CHECK(sensor_logic_effective_model(SENSOR_SETTING_AUTO, SENSOR_NONE) == SENSOR_NONE);
  CHECK(sensor_logic_effective_model(SENSOR_SETTING_AUTO, 9) == SENSOR_NONE);
  CHECK(sensor_logic_effective_model(9, SENSOR_DHT22) == SENSOR_NONE);
}

static void test_chip_id(void) {
  CHECK(sensor_logic_model_from_chip_id(0x60) == SENSOR_BME280);
  CHECK(sensor_logic_model_from_chip_id(0x58) == SENSOR_BMP280);
  CHECK(sensor_logic_model_from_chip_id(0x56) == SENSOR_BMP280);
  CHECK(sensor_logic_model_from_chip_id(0x57) == SENSOR_BMP280);
  CHECK(sensor_logic_model_from_chip_id(0x55) == SENSOR_NONE); /* BMP180 */
  CHECK(sensor_logic_model_from_chip_id(0x00) == SENSOR_NONE);
  CHECK(sensor_logic_model_from_chip_id(0xFF) == SENSOR_NONE);
}

static sensor_probe_t probe_none(void) {
  sensor_probe_t p;
  memset(&p, 0, sizeof(p));
  return p;
}

static sensor_probe_dht_t dht(float t, float rh) {
  sensor_probe_dht_t d = {.answered = true, .temperature = t, .relative_humidity = rh};
  return d;
}

static void test_detect_i2c_first(void) {
  sensor_probe_t p = probe_none();
  p.i2c_answered = true;
  p.i2c_chip_id = 0x60;
  p.dht22 = dht(23.0f, 50.0f); /* ignored: the I2C chip wins */
  CHECK(sensor_logic_detect(&p) == SENSOR_BME280);
  p.i2c_chip_id = 0x58;
  CHECK(sensor_logic_detect(&p) == SENSOR_BMP280);
  /* an unknown chip on the bus falls through to the DHT probes */
  p.i2c_chip_id = 0x55;
  CHECK(sensor_logic_detect(&p) == SENSOR_DHT22);
}

static void test_detect_dht22(void) {
  sensor_probe_t p = probe_none();
  p.dht22 = dht(23.4f, 51.2f);
  CHECK(sensor_logic_detect(&p) == SENSOR_DHT22);
  p.dht22 = dht(-12.5f, 99.9f);
  CHECK(sensor_logic_detect(&p) == SENSOR_DHT22);
  /* the all-zero frame is a failed read, not a DHT22 */
  p.dht22 = dht(0.0f, 0.0f);
  CHECK(sensor_logic_detect(&p) == SENSOR_NONE);
  p.dht22 = dht(NAN, 50.0f);
  CHECK(sensor_logic_detect(&p) == SENSOR_NONE);
}

static void test_detect_dht11_frame_read_as_dht22(void) {
  /* DHT11 frame 45 % / 25 C decoded as DHT22: (45 << 8) / 10 = 1152 % and
   * (25 << 8) / 10 = 640 C -> implausible, then the DHT11 decode wins. */
  sensor_probe_t p = probe_none();
  p.dht22 = dht(640.0f, 1152.0f);
  p.dht11 = dht(25.0f, 45.0f);
  CHECK(sensor_logic_detect(&p) == SENSOR_DHT11);
  /* humidity > 100 % alone already rules out a DHT22 */
  p.dht22 = dht(25.0f, 115.2f);
  CHECK(sensor_logic_detect(&p) == SENSOR_DHT11);
  /* DHT22 timed out, the DHT11 read answered */
  p.dht22.answered = false;
  CHECK(sensor_logic_detect(&p) == SENSOR_DHT11);
}

static void test_detect_dht11_plausibility(void) {
  sensor_probe_t p = probe_none();
  p.dht22 = dht(640.0f, 1152.0f);
  p.dht11 = dht(25.0f, 3.0f); /* < 5 %: a DHT22 frame decoded as DHT11 */
  CHECK(sensor_logic_detect(&p) == SENSOR_NONE);
  p.dht11 = dht(25.0f, 45.5f); /* DHT11 humidity is integer */
  CHECK(sensor_logic_detect(&p) == SENSOR_NONE);
  p.dht11 = dht(55.0f, 45.0f); /* above 50 C */
  CHECK(sensor_logic_detect(&p) == SENSOR_NONE);
  p.dht11 = dht(-1.0f, 45.0f);
  CHECK(sensor_logic_detect(&p) == SENSOR_NONE);
  p.dht11 = dht(0.0f, 5.0f);
  CHECK(sensor_logic_detect(&p) == SENSOR_DHT11);
  p.dht11 = dht(50.0f, 95.0f);
  CHECK(sensor_logic_detect(&p) == SENSOR_DHT11);
  p.dht11 = dht(20.0f, 96.0f);
  CHECK(sensor_logic_detect(&p) == SENSOR_NONE);
  p.dht11.answered = false;
  p.dht11.relative_humidity = 50.0f;
  CHECK(sensor_logic_detect(&p) == SENSOR_NONE);
}

static void test_detect_nothing(void) {
  sensor_probe_t p = probe_none();
  CHECK(sensor_logic_detect(&p) == SENSOR_NONE);
  CHECK(sensor_logic_detect(NULL) == SENSOR_NONE);
  CHECK(sensor_logic_dht22_plausible(20.0f, 50.0f));
  CHECK(!sensor_logic_dht22_plausible(20.0f, 100.5f));
  CHECK(sensor_logic_dht11_plausible(20.0f, 50.0f));
  CHECK(!sensor_logic_dht11_plausible(20.0f, 4.0f));
}

/* The chip on the bus vs the model in use (web status warning). */
static void test_chip_mismatch(void) {
  CHECK(!sensor_logic_chip_mismatch(SENSOR_BME280, 0x60));
  CHECK(!sensor_logic_chip_mismatch(SENSOR_BMP280, 0x58));
  CHECK(!sensor_logic_chip_mismatch(SENSOR_BMP280, 0x56));
  CHECK(sensor_logic_chip_mismatch(SENSOR_BMP280, 0x60)); /* forced bmp280 on a BME280 */
  CHECK(sensor_logic_chip_mismatch(SENSOR_BME280, 0x58)); /* no humidity */
  CHECK(sensor_logic_chip_mismatch(SENSOR_BME280, 0x55)); /* not a BMx280 */
  CHECK(!sensor_logic_chip_mismatch(SENSOR_DHT22, 0x60)); /* DHT models: not applicable */
  CHECK(!sensor_logic_chip_mismatch(SENSOR_DHT11, 0x58));
  CHECK(!sensor_logic_chip_mismatch(SENSOR_NONE, 0x60));
}

int main(void) {
  RUN(test_model_keys_match_backend_catalog);
  RUN(test_variables_per_model);
  RUN(test_dht22_keeps_temperature_and_humidity_only);
  RUN(test_bmp280_drops_humidity);
  RUN(test_bme280_keeps_all_three);
  RUN(test_out_of_range_and_nan_values_are_dropped);
  RUN(test_dht_all_zero_frame_is_a_failed_read);
  RUN(test_saturated_dht22_frame_is_dropped_whole);
  RUN(test_values_not_flagged_stay_absent);
  RUN(test_setting_parse_and_keys);
  RUN(test_model_from_key);
  RUN(test_effective_model);
  RUN(test_chip_id);
  RUN(test_chip_mismatch);
  RUN(test_detect_i2c_first);
  RUN(test_detect_dht22);
  RUN(test_detect_dht11_frame_read_as_dht22);
  RUN(test_detect_dht11_plausibility);
  RUN(test_detect_nothing);
  TEST_MAIN_END();
}
