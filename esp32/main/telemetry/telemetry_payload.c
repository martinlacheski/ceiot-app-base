/*
 * telemetry_payload.c
 */

#include "telemetry_payload.h"

#include <math.h>
#include <stddef.h>

#include "cJSON.h"

static double round2(float value) { return round((double)value * 100.0) / 100.0; }

char *telemetry_payload_build(const char *sensor_key,
                              const sensor_reading_t *reading,
                              long uptime_seconds,
                              const char *firmware_version) {
  if (sensor_key == NULL || sensor_key[0] == '\0' || reading == NULL) {
    return NULL;
  }
  if (!reading->has_temperature && !reading->has_relative_humidity &&
      !reading->has_pressure) {
    return NULL;
  }

  cJSON *root = cJSON_CreateObject();
  cJSON *sensors = cJSON_AddObjectToObject(root, "sensors");
  cJSON *values = sensors ? cJSON_AddObjectToObject(sensors, sensor_key) : NULL;
  if (values == NULL) {
    cJSON_Delete(root);
    return NULL;
  }
  if (reading->has_temperature) {
    cJSON_AddNumberToObject(values, "temperature", round2(reading->temperature));
  }
  if (reading->has_relative_humidity) {
    cJSON_AddNumberToObject(values, "relative_humidity",
                            round2(reading->relative_humidity));
  }
  if (reading->has_pressure) {
    cJSON_AddNumberToObject(values, "pressure", round2(reading->pressure));
  }
  cJSON_AddNumberToObject(root, "uptime",
                          (double)(uptime_seconds < 0 ? 0 : uptime_seconds));
  cJSON_AddStringToObject(root, "firmware_version",
                          firmware_version ? firmware_version : "");

  char *json = cJSON_PrintUnformatted(root);
  cJSON_Delete(root);
  return json;
}

char *telemetry_presence_build(const char *serial, bool online) {
  cJSON *root = cJSON_CreateObject();
  if (root == NULL) return NULL;
  cJSON_AddStringToObject(root, "serial", serial ? serial : "");
  cJSON_AddStringToObject(root, "status", online ? "online" : "offline");
  char *json = cJSON_PrintUnformatted(root);
  cJSON_Delete(root);
  return json;
}
