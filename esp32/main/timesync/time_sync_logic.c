/*
 * time_sync_logic.c
 */

#include "time_sync_logic.h"

#include <math.h>
#include <stdio.h>
#include <string.h>

#include "cJSON.h"

time_sync_action_t time_sync_next_action(const time_sync_view_t *view) {
  if (view == NULL || view->time_valid || !view->link_up) {
    return TIME_SYNC_ACTION_NONE;
  }
  // 1. NTP gets the first TIME_SYNC_NTP_TIMEOUT_MS on its own.
  if (view->link_up_ms < TIME_SYNC_NTP_TIMEOUT_MS) {
    return TIME_SYNC_ACTION_NONE;
  }
  // 2. One HTTP bootstrap attempt before anything else.
  if (view->http_attempts == 0) {
    return TIME_SYNC_ACTION_HTTP;
  }
  // 3. Over MQTT once connected (cheap, no new connection).
  if (view->mqtt_connected &&
      (view->mqtt_requests == 0 ||
       view->since_mqtt_request_ms >= TIME_SYNC_MQTT_RETRY_MS)) {
    return TIME_SYNC_ACTION_MQTT_REQUEST;
  }
  // Keep retrying HTTP slowly (SNTP keeps polling on its own too).
  if (view->since_http_ms >= TIME_SYNC_HTTP_RETRY_MS) {
    return TIME_SYNC_ACTION_HTTP;
  }
  return TIME_SYNC_ACTION_NONE;
}

bool time_sync_mqtt_may_start(const time_sync_view_t *view) {
  if (view == NULL) return false;
  if (view->time_valid) return true;
  return view->link_up && view->link_up_ms >= TIME_SYNC_NTP_TIMEOUT_MS &&
         view->http_attempts > 0;
}

bool time_sync_epoch_is_valid(int64_t epoch_ms) {
  return epoch_ms >= TIME_SYNC_MIN_VALID_EPOCH_MS;
}

bool time_sync_parse_reply(const char *json, size_t len,
                           const char *expected_req_id, int64_t *epoch_ms) {
  if (json == NULL || len == 0 || epoch_ms == NULL) return false;
  cJSON *root = cJSON_ParseWithLength(json, len);
  if (root == NULL) return false;

  bool ok = false;
  cJSON *epoch = cJSON_GetObjectItemCaseSensitive(root, "epoch_ms");
  if (cJSON_IsNumber(epoch) && isfinite(epoch->valuedouble) &&
      epoch->valuedouble == floor(epoch->valuedouble)) {
    int64_t value = (int64_t)epoch->valuedouble;
    ok = time_sync_epoch_is_valid(value);
    if (ok && expected_req_id != NULL) {
      cJSON *req_id = cJSON_GetObjectItemCaseSensitive(root, "req_id");
      ok = cJSON_IsString(req_id) &&
           strcmp(req_id->valuestring, expected_req_id) == 0;
    }
    if (ok) *epoch_ms = value;
  }
  cJSON_Delete(root);
  return ok;
}

char *time_sync_build_request(const char *req_id) {
  cJSON *root = cJSON_CreateObject();
  if (root == NULL) return NULL;
  if (req_id != NULL) cJSON_AddStringToObject(root, "req_id", req_id);
  char *json = cJSON_PrintUnformatted(root);
  cJSON_Delete(root);
  return json;
}

int64_t time_sync_compensate(int64_t epoch_ms, int64_t t_request_us,
                             int64_t t_response_us) {
  if (t_response_us <= t_request_us) return epoch_ms;
  return epoch_ms + (t_response_us - t_request_us) / 2000;
}

bool time_sync_default_backend_url(const char *mqtt_host, char *out,
                                   size_t out_size) {
  if (mqtt_host == NULL || mqtt_host[0] == '\0' || out == NULL ||
      out_size == 0) {
    return false;
  }
  // A bare IPv6 literal needs brackets in a URL.
  bool bracket = strchr(mqtt_host, ':') != NULL && mqtt_host[0] != '[';
  int n = snprintf(out, out_size, bracket ? "http://[%s]:%d" : "http://%s:%d",
                   mqtt_host, TIME_SYNC_DEFAULT_BACKEND_PORT);
  if (n < 0 || (size_t)n >= out_size) {
    out[0] = '\0';
    return false;
  }
  return true;
}

bool time_sync_time_url(const char *backend_base, char *out, size_t out_size) {
  if (backend_base == NULL || backend_base[0] == '\0' || out == NULL ||
      out_size == 0) {
    return false;
  }
  size_t base_len = strlen(backend_base);
  while (base_len > 0 && backend_base[base_len - 1] == '/') base_len--;
  if (base_len == 0) {
    out[0] = '\0';
    return false;
  }
  int n = snprintf(out, out_size, "%.*s/api/public/time", (int)base_len,
                   backend_base);
  if (n < 0 || (size_t)n >= out_size) {
    out[0] = '\0';
    return false;
  }
  return true;
}

const char *time_sync_source_name(time_source_t source) {
  switch (source) {
  case TIME_SOURCE_NTP:
    return "ntp";
  case TIME_SOURCE_HTTP:
    return "http";
  case TIME_SOURCE_MQTT:
    return "mqtt";
  case TIME_SOURCE_RTC:
    return "rtc";
  case TIME_SOURCE_NONE:
  default:
    return "none";
  }
}
