/* Host tests for main/timesync/time_sync_logic.c */
#include <stdlib.h>
#include <string.h>

#include "test_util.h"
#include "time_sync_logic.h"

static time_sync_view_t up_for(uint32_t ms) {
  time_sync_view_t v = {0};
  v.link_up = true;
  v.link_up_ms = ms;
  return v;
}

static void test_nothing_when_synced_or_offline(void) {
  time_sync_view_t v = up_for(60000);
  v.time_valid = true;
  CHECK(time_sync_next_action(&v) == TIME_SYNC_ACTION_NONE);
  CHECK(time_sync_mqtt_may_start(&v));
  v = up_for(60000);
  v.link_up = false;
  CHECK(time_sync_next_action(&v) == TIME_SYNC_ACTION_NONE);
  CHECK(!time_sync_mqtt_may_start(&v));
  CHECK(time_sync_next_action(NULL) == TIME_SYNC_ACTION_NONE);
  CHECK(!time_sync_mqtt_may_start(NULL));
}

static void test_ntp_gets_the_first_window(void) {
  time_sync_view_t v = up_for(TIME_SYNC_NTP_TIMEOUT_MS - 1);
  CHECK(time_sync_next_action(&v) == TIME_SYNC_ACTION_NONE);
  CHECK(!time_sync_mqtt_may_start(&v));
}

static void test_http_after_ntp_timeout_then_mqtt_may_start(void) {
  time_sync_view_t v = up_for(TIME_SYNC_NTP_TIMEOUT_MS);
  CHECK(time_sync_next_action(&v) == TIME_SYNC_ACTION_HTTP);
  CHECK(!time_sync_mqtt_may_start(&v)); /* HTTP not tried yet */
  v.http_attempts = 1;
  v.since_http_ms = 0;
  CHECK(time_sync_mqtt_may_start(&v)); /* never blocked forever */
  CHECK(time_sync_next_action(&v) == TIME_SYNC_ACTION_NONE);
}

static void test_mqtt_request_once_connected_and_retried(void) {
  time_sync_view_t v = up_for(30000);
  v.http_attempts = 1;
  v.since_http_ms = 1000;
  v.mqtt_connected = true;
  CHECK(time_sync_next_action(&v) == TIME_SYNC_ACTION_MQTT_REQUEST);
  v.mqtt_requests = 1;
  v.since_mqtt_request_ms = TIME_SYNC_MQTT_RETRY_MS - 1;
  CHECK(time_sync_next_action(&v) == TIME_SYNC_ACTION_NONE);
  v.since_mqtt_request_ms = TIME_SYNC_MQTT_RETRY_MS;
  CHECK(time_sync_next_action(&v) == TIME_SYNC_ACTION_MQTT_REQUEST);
}

static void test_http_retried_slowly_without_mqtt(void) {
  time_sync_view_t v = up_for(120000);
  v.http_attempts = 1;
  v.since_http_ms = TIME_SYNC_HTTP_RETRY_MS - 1;
  CHECK(time_sync_next_action(&v) == TIME_SYNC_ACTION_NONE);
  v.since_http_ms = TIME_SYNC_HTTP_RETRY_MS;
  CHECK(time_sync_next_action(&v) == TIME_SYNC_ACTION_HTTP);
}

static void test_parse_http_reply(void) {
  const char *body = "{\"epoch_ms\": 1790262894432, \"iso\": \"2026-09-24T15:14:54.432Z\"}";
  int64_t epoch = 0;
  CHECK(time_sync_parse_reply(body, strlen(body), NULL, &epoch));
  CHECK(epoch == 1790262894432LL);
}

static void test_parse_mqtt_reply_checks_req_id(void) {
  const char *body = "{\"epoch_ms\":1790262894432,\"iso\":\"x\",\"req_id\":\"boot-1\"}";
  int64_t epoch = 0;
  CHECK(time_sync_parse_reply(body, strlen(body), "boot-1", &epoch));
  CHECK(epoch == 1790262894432LL);
  epoch = 0;
  CHECK(!time_sync_parse_reply(body, strlen(body), "boot-2", &epoch));
  CHECK(epoch == 0);
  const char *null_id = "{\"epoch_ms\":1790262894432,\"req_id\":null}";
  CHECK(!time_sync_parse_reply(null_id, strlen(null_id), "boot-1", &epoch));
}

static void test_parse_rejects_bad_payloads(void) {
  int64_t epoch = 0;
  const char *old = "{\"epoch_ms\":1000}";
  CHECK(!time_sync_parse_reply(old, strlen(old), NULL, &epoch));
  const char *text = "{\"epoch_ms\":\"1790262894432\"}";
  CHECK(!time_sync_parse_reply(text, strlen(text), NULL, &epoch));
  const char *frac = "{\"epoch_ms\":1790262894432.5}";
  CHECK(!time_sync_parse_reply(frac, strlen(frac), NULL, &epoch));
  CHECK(!time_sync_parse_reply("not json", 8, NULL, &epoch));
  CHECK(!time_sync_parse_reply(NULL, 0, NULL, &epoch));
  /* not NUL-terminated buffer: only len bytes are read */
  const char buf[] = {'{', '}', 'x'};
  CHECK(!time_sync_parse_reply(buf, 2, NULL, &epoch));
  CHECK(epoch == 0);
}

static void test_build_request(void) {
  char *json = time_sync_build_request("boot-1");
  CHECK(json != NULL && strcmp(json, "{\"req_id\":\"boot-1\"}") == 0);
  free(json);
  json = time_sync_build_request(NULL);
  CHECK(json != NULL && strcmp(json, "{}") == 0);
  free(json);
}

static void test_compensation(void) {
  CHECK(time_sync_compensate(1000000, 0, 200000) == 1000100);
  CHECK(time_sync_compensate(1000000, 500, 500) == 1000000);
  CHECK(time_sync_compensate(1000000, 900, 100) == 1000000);
}

static void test_backend_urls(void) {
  char url[64];
  CHECK(time_sync_default_backend_url("192.168.1.100", url, sizeof(url)));
  CHECK(strcmp(url, "http://192.168.1.100:18000") == 0);
  CHECK(time_sync_default_backend_url("fd00::5", url, sizeof(url)));
  CHECK(strcmp(url, "http://[fd00::5]:18000") == 0);
  CHECK(!time_sync_default_backend_url("", url, sizeof(url)));
  CHECK(!time_sync_default_backend_url("a-very-long-host-name.example.com", url, 20));

  char time_url[96];
  CHECK(time_sync_time_url("http://192.168.1.100:18000/", time_url, sizeof(time_url)));
  CHECK(strcmp(time_url, "http://192.168.1.100:18000/api/public/time") == 0);
  CHECK(time_sync_time_url("http://h:18000", time_url, sizeof(time_url)));
  CHECK(strcmp(time_url, "http://h:18000/api/public/time") == 0);
  CHECK(!time_sync_time_url("///", time_url, sizeof(time_url)));
  CHECK(!time_sync_time_url(NULL, time_url, sizeof(time_url)));
}

static void test_source_names(void) {
  CHECK(strcmp(time_sync_source_name(TIME_SOURCE_NTP), "ntp") == 0);
  CHECK(strcmp(time_sync_source_name(TIME_SOURCE_HTTP), "http") == 0);
  CHECK(strcmp(time_sync_source_name(TIME_SOURCE_MQTT), "mqtt") == 0);
  CHECK(strcmp(time_sync_source_name(TIME_SOURCE_RTC), "rtc") == 0);
  CHECK(strcmp(time_sync_source_name(TIME_SOURCE_NONE), "none") == 0);
}

int main(void) {
  RUN(test_nothing_when_synced_or_offline);
  RUN(test_ntp_gets_the_first_window);
  RUN(test_http_after_ntp_timeout_then_mqtt_may_start);
  RUN(test_mqtt_request_once_connected_and_retried);
  RUN(test_http_retried_slowly_without_mqtt);
  RUN(test_parse_http_reply);
  RUN(test_parse_mqtt_reply_checks_req_id);
  RUN(test_parse_rejects_bad_payloads);
  RUN(test_build_request);
  RUN(test_compensation);
  RUN(test_backend_urls);
  RUN(test_source_names);
  TEST_MAIN_END();
}
