/* Host tests for main/telemetry/telemetry_payload.c */
#include <stdlib.h>
#include <string.h>

#include "cJSON.h"
#include "telemetry_payload.h"
#include "test_util.h"

static void test_dht22_payload_matches_contract(void) {
  sensor_reading_t r = {.has_temperature = true,
                        .temperature = 23.456f,
                        .has_relative_humidity = true,
                        .relative_humidity = 51.2f};
  char *json = telemetry_payload_build("dht22", &r, 125, "0.1.0");
  CHECK(json != NULL);
  cJSON *root = cJSON_Parse(json);
  CHECK(root != NULL);
  cJSON *sensors = cJSON_GetObjectItem(root, "sensors");
  CHECK(cJSON_IsObject(sensors) && cJSON_GetArraySize(sensors) == 1);
  cJSON *dht = cJSON_GetObjectItem(sensors, "dht22");
  CHECK(cJSON_IsObject(dht) && cJSON_GetArraySize(dht) == 2);
  CHECK(cJSON_GetObjectItem(dht, "temperature")->valuedouble == 23.46);
  CHECK(cJSON_GetObjectItem(dht, "relative_humidity")->valuedouble == 51.2);
  CHECK(cJSON_GetObjectItem(dht, "pressure") == NULL);
  CHECK(cJSON_GetObjectItem(root, "uptime")->valueint == 125);
  CHECK(strcmp(cJSON_GetObjectItem(root, "firmware_version")->valuestring,
               "0.1.0") == 0);
  CHECK(cJSON_GetArraySize(root) == 3);
  /* rounded values print without float noise */
  CHECK(strstr(json, "\"relative_humidity\":51.2") != NULL);
  cJSON_Delete(root);
  free(json);
}

static void test_bmp280_payload_has_pressure_in_hpa(void) {
  sensor_reading_t r = {.has_temperature = true,
                        .temperature = 21.0f,
                        .has_pressure = true,
                        .pressure = 1013.254f};
  char *json = telemetry_payload_build("bmp280", &r, 0, "0.1.0");
  CHECK(json != NULL);
  cJSON *root = cJSON_Parse(json);
  cJSON *bmp = cJSON_GetObjectItem(cJSON_GetObjectItem(root, "sensors"), "bmp280");
  CHECK(cJSON_GetObjectItem(bmp, "pressure")->valuedouble == 1013.25);
  CHECK(cJSON_GetObjectItem(bmp, "relative_humidity") == NULL);
  cJSON_Delete(root);
  free(json);
}

static void test_partial_reading_publishes_only_valid_variables(void) {
  sensor_reading_t r = {.has_temperature = false,
                        .has_relative_humidity = true,
                        .relative_humidity = 40.0f,
                        .has_pressure = true,
                        .pressure = 990.0f};
  char *json = telemetry_payload_build("bme280", &r, 10, "0.1.0");
  CHECK(json != NULL);
  CHECK(strstr(json, "temperature") == NULL);
  CHECK(strstr(json, "\"relative_humidity\":40") != NULL);
  free(json);
}

static void test_nothing_to_publish_returns_null(void) {
  sensor_reading_t empty = {0};
  CHECK(telemetry_payload_build("dht11", &empty, 1, "0.1.0") == NULL);
  sensor_reading_t r = {.has_temperature = true, .temperature = 20.0f};
  CHECK(telemetry_payload_build(NULL, &r, 1, "0.1.0") == NULL);
  CHECK(telemetry_payload_build("", &r, 1, "0.1.0") == NULL);
  CHECK(telemetry_payload_build("dht11", NULL, 1, "0.1.0") == NULL);
}

static void test_negative_uptime_is_clamped(void) {
  sensor_reading_t r = {.has_temperature = true, .temperature = 20.0f};
  char *json = telemetry_payload_build("dht11", &r, -5, NULL);
  CHECK(json != NULL);
  CHECK(strstr(json, "\"uptime\":0") != NULL);
  CHECK(strstr(json, "\"firmware_version\":\"\"") != NULL);
  free(json);
}

static void test_presence_payloads(void) {
  char *online = telemetry_presence_build("IOT-DEM0-0001", true);
  CHECK(online != NULL &&
        strcmp(online, "{\"serial\":\"IOT-DEM0-0001\",\"status\":\"online\"}") == 0);
  char *offline = telemetry_presence_build("IOT-DEM0-0001", false);
  CHECK(offline != NULL &&
        strcmp(offline, "{\"serial\":\"IOT-DEM0-0001\",\"status\":\"offline\"}") == 0);
  free(online);
  free(offline);
}

int main(void) {
  RUN(test_dht22_payload_matches_contract);
  RUN(test_bmp280_payload_has_pressure_in_hpa);
  RUN(test_partial_reading_publishes_only_valid_variables);
  RUN(test_nothing_to_publish_returns_null);
  RUN(test_negative_uptime_is_clamped);
  RUN(test_presence_payloads);
  TEST_MAIN_END();
}
