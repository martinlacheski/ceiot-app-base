/*
 * time_sync_logic.h
 *
 * Time fallback rules (backend/docs/mqtt-time-sync.md): NTP first, then the
 * plain-HTTP bootstrap GET {backend}/api/public/time, then MQTT
 * iot/devices/{serial}/time/request. Pure C + cJSON, host-tested.
 *
 * MQTT is gated on time only until NTP and one HTTP attempt have had their
 * chance: the firmware keeps CONFIG_MBEDTLS_HAVE_TIME_DATE disabled, so the
 * TLS handshake verifies the broker chain without comparing certificate
 * dates, and an unsynchronized device can still connect and ask for the
 * time over MQTT instead of waiting forever.
 */

#ifndef TIME_SYNC_LOGIC_H
#define TIME_SYNC_LOGIC_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

// How long SNTP gets after the link comes up before the fallbacks start.
#define TIME_SYNC_NTP_TIMEOUT_MS 15000U
// Retry periods while the clock is still not set.
#define TIME_SYNC_HTTP_RETRY_MS 60000U
#define TIME_SYNC_MQTT_RETRY_MS 30000U
// 2024-01-01T00:00:00Z: anything earlier is an unset / bogus clock.
#define TIME_SYNC_MIN_VALID_EPOCH_MS 1704067200000LL
// Default backend port (BACKEND_PORT in the standard configuration).
#define TIME_SYNC_DEFAULT_BACKEND_PORT 8000

typedef enum {
  TIME_SOURCE_NONE = 0,
  TIME_SOURCE_NTP,
  TIME_SOURCE_HTTP,
  TIME_SOURCE_MQTT,
  TIME_SOURCE_RTC, // valid clock kept across a software restart
} time_source_t;

typedef enum {
  TIME_SYNC_ACTION_NONE = 0,          // nothing to do now (waiting / synced)
  TIME_SYNC_ACTION_HTTP,              // GET {backend}/api/public/time
  TIME_SYNC_ACTION_MQTT_REQUEST,      // publish .../time/request
} time_sync_action_t;

typedef struct {
  bool time_valid;               // clock already holds a plausible time
  bool link_up;                  // station has an IP address
  uint32_t link_up_ms;           // time since the link came up
  uint32_t http_attempts;        // HTTP attempts since the link came up
  uint32_t since_http_ms;        // since the last HTTP attempt
  bool mqtt_connected;
  uint32_t mqtt_requests;        // MQTT requests since the link came up
  uint32_t since_mqtt_request_ms;
} time_sync_view_t;

// Next fallback step for the current situation.
time_sync_action_t time_sync_next_action(const time_sync_view_t *view);

// Whether the MQTT client may start connecting: the clock is valid, or NTP
// timed out and the HTTP bootstrap was tried at least once.
bool time_sync_mqtt_may_start(const time_sync_view_t *view);

// True for an epoch (ms) at or after TIME_SYNC_MIN_VALID_EPOCH_MS.
bool time_sync_epoch_is_valid(int64_t epoch_ms);

// Parses {"epoch_ms":<int>,"iso":"...","req_id":"..."} (HTTP or MQTT reply).
// When expected_req_id is not NULL, the reply must echo it. Returns false on
// malformed JSON, a missing/implausible epoch_ms or a req_id mismatch.
bool time_sync_parse_reply(const char *json, size_t len,
                           const char *expected_req_id, int64_t *epoch_ms);

// {"req_id":"<req_id>"}; malloc'd string (caller frees) or NULL.
char *time_sync_build_request(const char *req_id);

// Half round-trip compensation: epoch_ms + (t_response - t_request) / 2,
// with monotonic timestamps in microseconds (ignored if not increasing).
int64_t time_sync_compensate(int64_t epoch_ms, int64_t t_request_us,
                             int64_t t_response_us);

// Default backend base URL from the MQTT broker host:
// "http://<host>:8000". Returns false if host is empty or out does not fit.
bool time_sync_default_backend_url(const char *mqtt_host, char *out,
                                   size_t out_size);

// "<base>/api/public/time" with a single slash between both parts.
bool time_sync_time_url(const char *backend_base, char *out, size_t out_size);

const char *time_sync_source_name(time_source_t source);

#endif // TIME_SYNC_LOGIC_H
