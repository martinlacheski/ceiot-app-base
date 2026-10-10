/* Host tests of the OTA client rules (main/ota/ota_logic.c). Contract:
 * tools/emulador-dispositivo.py and backend/app/api/device/firmware/. Ported from
 * DVEM-App devices/esp-idf-guition-1r1p/tests/test_ota_logic.c, adapted: plain
 * http allowed, `image_too_large` / `no_memory` codes, no device-screen texts. */
#include "ota_logic.h"
#include "test_util.h"

#include <stdio.h>
#include <string.h>

#define SLOT_SIZE 0x1E0000u /* ota_0 / ota_1 in esp32/partitions.csv */
#define SHA_A "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"

static const char *VALID_CMD =
    "{\"request_id\":\"r-1\",\"version\":\"0.2.0\","
    "\"url\":\"http://192.168.1.50:18000/api/firmware/download/tok\","
    "\"sha256\":\"" SHA_A "\",\"size\":1000000}";

static ota_command_t good_command(void) {
  ota_command_t c;
  memset(&c, 0, sizeof(c));
  CHECK(ota_parse_command(VALID_CMD, &c) == OTA_PARSE_OK);
  return c;
}

/* ---- names ---- */

static void test_names_and_codes(void) {
  CHECK(strcmp(ota_state_name(OTA_ST_ACCEPTED), "accepted") == 0);
  CHECK(strcmp(ota_state_name(OTA_ST_REJECTED), "rejected") == 0);
  CHECK(strcmp(ota_state_name(OTA_ST_DOWNLOADING), "downloading") == 0);
  CHECK(strcmp(ota_state_name(OTA_ST_VERIFYING), "verifying") == 0);
  CHECK(strcmp(ota_state_name(OTA_ST_INSTALLING), "installing") == 0);
  CHECK(strcmp(ota_state_name(OTA_ST_REBOOTING), "rebooting") == 0);
  CHECK(strcmp(ota_state_name(OTA_ST_SUCCEEDED), "succeeded") == 0);
  CHECK(strcmp(ota_state_name(OTA_ST_FAILED), "failed") == 0);
  CHECK(strcmp(ota_state_name(OTA_ST_ROLLED_BACK), "rolled_back") == 0);

  CHECK(strcmp(ota_error_code(OTA_ERR_BUSY), "busy") == 0);
  CHECK(strcmp(ota_error_code(OTA_ERR_SAME_VERSION), "same_version") == 0);
  CHECK(strcmp(ota_error_code(OTA_ERR_INVALID_COMMAND), "invalid_command") == 0);
  CHECK(strcmp(ota_error_code(OTA_ERR_IMAGE_TOO_LARGE), "image_too_large") == 0);
  CHECK(strcmp(ota_error_code(OTA_ERR_DOWNLOAD_FAILED), "download_failed") == 0);
  CHECK(strcmp(ota_error_code(OTA_ERR_TLS_ERROR), "tls_error") == 0);
  CHECK(strcmp(ota_error_code(OTA_ERR_SIZE_MISMATCH), "size_mismatch") == 0);
  CHECK(strcmp(ota_error_code(OTA_ERR_SHA256_MISMATCH), "sha256_mismatch") == 0);
  CHECK(strcmp(ota_error_code(OTA_ERR_NO_OTA_PARTITION), "no_ota_partition") == 0);
  CHECK(strcmp(ota_error_code(OTA_ERR_FLASH_ERROR), "flash_error") == 0);
  CHECK(strcmp(ota_error_code(OTA_ERR_NO_MEMORY), "no_memory") == 0);
  CHECK(strcmp(ota_error_code(OTA_ERR_ROLLBACK), "rollback") == 0);
  CHECK(strcmp(ota_error_code(OTA_ERR_INTERNAL), "internal") == 0);
  CHECK(ota_error_code(OTA_ERR_NONE)[0] == '\0');
  CHECK(ota_error_message(OTA_ERR_BUSY)[0] != '\0');
  CHECK(ota_error_message(OTA_ERR_IMAGE_TOO_LARGE)[0] != '\0');
  CHECK(ota_error_message(OTA_ERR_NONE)[0] == '\0');
}

static void test_state_classes(void) {
  CHECK(ota_state_is_active(OTA_ST_ACCEPTED));
  CHECK(ota_state_is_active(OTA_ST_DOWNLOADING));
  CHECK(ota_state_is_active(OTA_ST_VERIFYING));
  CHECK(ota_state_is_active(OTA_ST_INSTALLING));
  CHECK(ota_state_is_active(OTA_ST_REBOOTING));
  CHECK(!ota_state_is_active(OTA_ST_REJECTED));
  CHECK(!ota_state_is_active(OTA_ST_SUCCEEDED));
  CHECK(!ota_state_is_active(OTA_ST_FAILED));
  CHECK(!ota_state_is_active(OTA_ST_ROLLED_BACK));
}

/* ---- command parsing ---- */

static void test_parse_valid(void) {
  ota_command_t c = good_command();
  CHECK(strcmp(c.request_id, "r-1") == 0);
  CHECK(strcmp(c.version, "0.2.0") == 0);
  CHECK(strcmp(c.url, "http://192.168.1.50:18000/api/firmware/download/tok") == 0);
  CHECK(strcmp(c.sha256, SHA_A) == 0);
  CHECK(c.size == 1000000u);
  CHECK(!c.force);
}

static void test_parse_force(void) {
  ota_command_t c;
  const char *json = "{\"request_id\":\"r\",\"version\":\"v\",\"url\":\"https://h/x\",\"sha256\":\"" SHA_A
                     "\",\"size\":10,\"force\":true}";
  CHECK(ota_parse_command(json, &c) == OTA_PARSE_OK);
  CHECK(c.force);
  json = "{\"request_id\":\"r\",\"version\":\"v\",\"url\":\"https://h/x\",\"sha256\":\"" SHA_A
         "\",\"size\":10,\"force\":false}";
  CHECK(ota_parse_command(json, &c) == OTA_PARSE_OK);
  CHECK(!c.force);
  json = "{\"request_id\":\"r\",\"version\":\"v\",\"url\":\"https://h/x\",\"sha256\":\"" SHA_A
         "\",\"size\":10,\"force\":null}";
  CHECK(ota_parse_command(json, &c) == OTA_PARSE_OK);
  CHECK(!c.force);
  json = "{\"request_id\":\"r\",\"version\":\"v\",\"url\":\"https://h/x\",\"sha256\":\"" SHA_A
         "\",\"size\":10,\"force\":\"yes\"}";
  CHECK(ota_parse_command(json, &c) == OTA_PARSE_INVALID);
}

static void test_parse_unreadable(void) {
  ota_command_t c;
  CHECK(ota_parse_command(NULL, &c) == OTA_PARSE_UNREADABLE);
  CHECK(ota_parse_command("", &c) == OTA_PARSE_UNREADABLE);
  CHECK(ota_parse_command("not json", &c) == OTA_PARSE_UNREADABLE);
  CHECK(ota_parse_command("[1,2]", &c) == OTA_PARSE_UNREADABLE);
  CHECK(ota_parse_command("{}", &c) == OTA_PARSE_UNREADABLE);
  CHECK(ota_parse_command("{\"request_id\":\"\"}", &c) == OTA_PARSE_UNREADABLE);
  CHECK(ota_parse_command("{\"request_id\":7}", &c) == OTA_PARSE_UNREADABLE);
  /* request_id: 64 characters is the contract limit (backend and emulator) */
  char json[200];
  snprintf(json, sizeof(json), "{\"request_id\":\"%064d\"}", 1);
  CHECK(ota_parse_command(json, &c) == OTA_PARSE_INVALID);
  CHECK(strlen(c.request_id) == 64);
  snprintf(json, sizeof(json), "{\"request_id\":\"%065d\"}", 1);
  CHECK(ota_parse_command(json, &c) == OTA_PARSE_UNREADABLE);
}

/* Replaces the first occurrence of `from` in VALID_CMD with `to`. */
static ota_parse_t parse_variant(const char *from, const char *to, ota_command_t *c) {
  char json[1600];
  const char *at = strstr(VALID_CMD, from);
  CHECK(at != NULL);
  if (at == NULL) return OTA_PARSE_UNREADABLE;
  snprintf(json, sizeof(json), "%.*s%s%s", (int)(at - VALID_CMD), VALID_CMD, to, at + strlen(from));
  return ota_parse_command(json, c);
}

static void test_parse_urls(void) {
  ota_command_t c;
  /* plain http (LAN, integrity from the sha256) and https are both accepted */
  CHECK(parse_variant("http://192", "https://192", &c) == OTA_PARSE_OK);
  CHECK(parse_variant("http://192", "http://192", &c) == OTA_PARSE_OK);
  /* other schemes, no scheme, uppercase scheme, no host, spaces */
  CHECK(parse_variant("http://192", "ftp://192", &c) == OTA_PARSE_INVALID);
  CHECK(strcmp(c.request_id, "r-1") == 0); /* echoed so the rejection names the request */
  CHECK(strcmp(c.version, "0.2.0") == 0);
  CHECK(parse_variant("http://192", "192", &c) == OTA_PARSE_INVALID);
  CHECK(parse_variant("http://192", "HTTP://192", &c) == OTA_PARSE_INVALID);
  CHECK(parse_variant("http://192.168.1.50:18000/api/firmware/download/tok", "http://", &c) ==
        OTA_PARSE_INVALID);
  CHECK(parse_variant("http://192.168.1.50:18000/api/firmware/download/tok", "https://", &c) ==
        OTA_PARSE_INVALID);
  CHECK(parse_variant("/download/tok", "/download/t ok", &c) == OTA_PARSE_INVALID);
  CHECK(parse_variant("\"url\"", "\"link\"", &c) == OTA_PARSE_INVALID);

  CHECK(ota_url_is_https("https://h/x"));
  CHECK(!ota_url_is_https("http://h/x"));
  CHECK(!ota_url_is_https(NULL));
}

static void test_parse_invalid_fields(void) {
  ota_command_t c;
  /* sha256: wrong length, uppercase, non hex */
  CHECK(parse_variant(SHA_A, "abcd", &c) == OTA_PARSE_INVALID);
  CHECK(parse_variant(SHA_A, "0123456789ABCDEF0123456789abcdef0123456789abcdef0123456789abcdef", &c) ==
        OTA_PARSE_INVALID);
  CHECK(parse_variant(SHA_A, "g123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef", &c) ==
        OTA_PARSE_INVALID);
  CHECK(parse_variant(SHA_A, SHA_A "0", &c) == OTA_PARSE_INVALID);
  /* size: 0, negative, fractional, not a number, beyond 32 bits */
  CHECK(parse_variant("1000000", "0", &c) == OTA_PARSE_INVALID);
  CHECK(parse_variant("1000000", "-5", &c) == OTA_PARSE_INVALID);
  CHECK(parse_variant("1000000", "10.5", &c) == OTA_PARSE_INVALID);
  CHECK(parse_variant("1000000", "\"1000000\"", &c) == OTA_PARSE_INVALID);
  CHECK(parse_variant("1000000", "true", &c) == OTA_PARSE_INVALID);
  CHECK(parse_variant("1000000", "4294967296", &c) == OTA_PARSE_INVALID);
  CHECK(parse_variant("1000000", "1", &c) == OTA_PARSE_OK);
  /* larger than the slot still parses: ota_decide answers image_too_large */
  CHECK(parse_variant("1000000", "1966081", &c) == OTA_PARSE_OK);
  CHECK(c.size == 1966081u);
  /* version: empty, missing, not a string, longer than esp_app_desc_t.version (32) */
  CHECK(parse_variant("\"0.2.0\"", "\"\"", &c) == OTA_PARSE_INVALID);
  CHECK(c.version[0] == '\0');
  CHECK(parse_variant("\"version\":\"0.2.0\"", "\"vers\":\"x\"", &c) == OTA_PARSE_INVALID);
  CHECK(parse_variant("\"0.2.0\"", "12", &c) == OTA_PARSE_INVALID);
  CHECK(parse_variant("\"0.2.0\"", "\"12345678901234567890123456789012\"", &c) == OTA_PARSE_OK);
  CHECK(parse_variant("\"0.2.0\"", "\"123456789012345678901234567890123\"", &c) == OTA_PARSE_INVALID);
}

static void test_parse_url_length(void) {
  char json[2400];
  char url[1100];
  ota_command_t c;
  /* "https://" + path = exactly 1024 chars is accepted, 1025 is not. */
  memset(url, 'a', sizeof(url));
  memcpy(url, "https://", 8);
  url[1024] = '\0';
  snprintf(json, sizeof(json),
           "{\"request_id\":\"r\",\"version\":\"v\",\"url\":\"%s\",\"sha256\":\"" SHA_A "\",\"size\":10}", url);
  CHECK(ota_parse_command(json, &c) == OTA_PARSE_OK);
  CHECK(strlen(c.url) == 1024);
  url[1024] = 'a';
  url[1025] = '\0';
  snprintf(json, sizeof(json),
           "{\"request_id\":\"r\",\"version\":\"v\",\"url\":\"%s\",\"sha256\":\"" SHA_A "\",\"size\":10}", url);
  CHECK(ota_parse_command(json, &c) == OTA_PARSE_INVALID);
}

/* ---- tracker ---- */

static void test_tracker_basics(void) {
  ota_tracker_t t;
  ota_tracker_init(&t);
  CHECK(t.count == 0);
  CHECK(ota_tracker_find(&t, "a") == NULL);
  CHECK(ota_tracker_active(&t) == NULL);

  ota_tracker_update(&t, "a", "v2", OTA_ST_ACCEPTED, OTA_ERR_NONE, -1);
  CHECK(t.count == 1);
  CHECK(ota_tracker_active(&t) != NULL);
  CHECK(strcmp(ota_tracker_active(&t)->request_id, "a") == 0);
  ota_tracker_update(&t, "a", "v2", OTA_ST_DOWNLOADING, OTA_ERR_NONE, 40);
  CHECK(t.count == 1); /* updated in place */
  const ota_status_t *s = ota_tracker_find(&t, "a");
  CHECK(s != NULL && s->state == OTA_ST_DOWNLOADING && s->progress == 40);
  ota_tracker_update(&t, "a", "v2", OTA_ST_FAILED, OTA_ERR_SHA256_MISMATCH, -1);
  CHECK(ota_tracker_active(&t) == NULL);
  s = ota_tracker_find(&t, "a");
  CHECK(s->state == OTA_ST_FAILED && s->error == OTA_ERR_SHA256_MISMATCH);
}

static void test_tracker_is_bounded(void) {
  ota_tracker_t t;
  ota_tracker_init(&t);
  char id[8];
  for (int i = 0; i < OTA_TRACKER_SIZE + 3; i++) {
    snprintf(id, sizeof(id), "r%d", i);
    ota_tracker_update(&t, id, "v", OTA_ST_REJECTED, OTA_ERR_BUSY, -1);
  }
  CHECK(t.count == OTA_TRACKER_SIZE);
  CHECK(ota_tracker_find(&t, "r0") == NULL); /* oldest gone */
  CHECK(ota_tracker_find(&t, "r2") == NULL);
  CHECK(ota_tracker_find(&t, "r3") != NULL);
  CHECK(ota_tracker_find(&t, "r6") != NULL);
}

static void test_tracker_never_evicts_the_active_request(void) {
  ota_tracker_t t;
  ota_tracker_init(&t);
  ota_tracker_update(&t, "run", "v", OTA_ST_DOWNLOADING, OTA_ERR_NONE, 5);
  char id[8];
  for (int i = 0; i < 10; i++) {
    snprintf(id, sizeof(id), "x%d", i);
    ota_tracker_update(&t, id, "v", OTA_ST_REJECTED, OTA_ERR_BUSY, -1);
  }
  CHECK(t.count == OTA_TRACKER_SIZE);
  CHECK(ota_tracker_find(&t, "run") != NULL);
  CHECK(ota_tracker_active(&t) != NULL);
}

/* ---- decision ---- */

static ota_env_t env(const char *running, bool busy) {
  ota_env_t e = {.running_version = running, .device_busy = busy, .slot_size = SLOT_SIZE};
  return e;
}

static void test_decide_accept(void) {
  ota_tracker_t t;
  ota_tracker_init(&t);
  ota_command_t c = good_command();
  ota_decision_t d = ota_decide(&t, &c, true, env("0.1.0", false));
  CHECK(d.action == OTA_ACT_ACCEPT);
}

static void test_decide_same_version_unless_force(void) {
  ota_tracker_t t;
  ota_tracker_init(&t);
  ota_command_t c = good_command();
  ota_decision_t d = ota_decide(&t, &c, true, env("0.2.0", false));
  CHECK(d.action == OTA_ACT_REJECT && d.error == OTA_ERR_SAME_VERSION);
  c.force = true;
  d = ota_decide(&t, &c, true, env("0.2.0", false));
  CHECK(d.action == OTA_ACT_ACCEPT);
  /* equality only, never ordering: an older version is accepted */
  c.force = false;
  d = ota_decide(&t, &c, true, env("0.3.0", false));
  CHECK(d.action == OTA_ACT_ACCEPT);
}

static void test_decide_invalid(void) {
  ota_tracker_t t;
  ota_tracker_init(&t);
  ota_command_t c = good_command();
  ota_decision_t d = ota_decide(&t, &c, false, env("0.1.0", false));
  CHECK(d.action == OTA_ACT_REJECT && d.error == OTA_ERR_INVALID_COMMAND);
}

static void test_decide_image_larger_than_the_slot(void) {
  ota_tracker_t t;
  ota_tracker_init(&t);
  ota_command_t c = good_command();
  c.size = SLOT_SIZE;
  CHECK(ota_decide(&t, &c, true, env("0.1.0", false)).action == OTA_ACT_ACCEPT); /* exactly fits */
  c.size = SLOT_SIZE + 1;
  ota_decision_t d = ota_decide(&t, &c, true, env("0.1.0", false));
  CHECK(d.action == OTA_ACT_REJECT && d.error == OTA_ERR_IMAGE_TOO_LARGE);
  /* even when forced or the same version: it can never be written */
  c.force = true;
  d = ota_decide(&t, &c, true, env("0.2.0", false));
  CHECK(d.action == OTA_ACT_REJECT && d.error == OTA_ERR_IMAGE_TOO_LARGE);
  /* no slot known (0): left to the download task, which fails no_ota_partition */
  ota_env_t e = env("0.1.0", false);
  e.slot_size = 0;
  CHECK(ota_decide(&t, &c, true, e).action == OTA_ACT_ACCEPT);
}

static void test_decide_device_busy(void) {
  ota_tracker_t t;
  ota_tracker_init(&t);
  ota_command_t c = good_command();
  ota_decision_t d = ota_decide(&t, &c, true, env("0.1.0", true));
  CHECK(d.action == OTA_ACT_REJECT && d.error == OTA_ERR_BUSY);
  /* busy wins over same_version: the device cannot update now whatever the version */
  d = ota_decide(&t, &c, true, env("0.2.0", true));
  CHECK(d.action == OTA_ACT_REJECT && d.error == OTA_ERR_BUSY);
}

static void test_decide_one_at_a_time(void) {
  ota_tracker_t t;
  ota_tracker_init(&t);
  ota_tracker_update(&t, "first", "0.2.0", OTA_ST_DOWNLOADING, OTA_ERR_NONE, 20);
  ota_command_t c = good_command(); /* request_id r-1 */
  ota_decision_t d = ota_decide(&t, &c, true, env("0.1.0", false));
  CHECK(d.action == OTA_ACT_REJECT && d.error == OTA_ERR_BUSY);
  /* an invalid command while updating is busy too (as the emulator answers) */
  d = ota_decide(&t, &c, false, env("0.1.0", false));
  CHECK(d.action == OTA_ACT_REJECT && d.error == OTA_ERR_BUSY);
}

static void test_decide_redelivery_replays_without_running_again(void) {
  ota_tracker_t t;
  ota_tracker_init(&t);
  ota_command_t c = good_command();
  ota_tracker_update(&t, c.request_id, c.version, OTA_ST_DOWNLOADING, OTA_ERR_NONE, 30);
  ota_decision_t d = ota_decide(&t, &c, true, env("0.1.0", false));
  CHECK(d.action == OTA_ACT_REPLAY);
  ota_tracker_init(&t);
  ota_tracker_update(&t, c.request_id, c.version, OTA_ST_REJECTED, OTA_ERR_BUSY, -1);
  d = ota_decide(&t, &c, true, env("0.1.0", false));
  CHECK(d.action == OTA_ACT_REPLAY);
  ota_tracker_init(&t);
  ota_tracker_update(&t, c.request_id, c.version, OTA_ST_FAILED, OTA_ERR_DOWNLOAD_FAILED, -1);
  d = ota_decide(&t, &c, true, env("0.1.0", false));
  CHECK(d.action == OTA_ACT_REPLAY);
  d = ota_decide(&t, &c, false, env("0.1.0", false));
  CHECK(d.action == OTA_ACT_REPLAY);
}

/* ---- memory budget ---- */

static void test_memory_budget(void) {
  CHECK(ota_memory_ok(false, OTA_HTTP_MIN_FREE_HEAP, OTA_HTTP_MIN_LARGEST_BLOCK));
  CHECK(!ota_memory_ok(false, OTA_HTTP_MIN_FREE_HEAP - 1, OTA_HTTP_MIN_LARGEST_BLOCK));
  CHECK(!ota_memory_ok(false, OTA_HTTP_MIN_FREE_HEAP, OTA_HTTP_MIN_LARGEST_BLOCK - 1));
  CHECK(ota_memory_ok(true, OTA_HTTPS_MIN_FREE_HEAP, OTA_HTTPS_MIN_LARGEST_BLOCK));
  CHECK(!ota_memory_ok(true, OTA_HTTPS_MIN_FREE_HEAP - 1, OTA_HTTPS_MIN_LARGEST_BLOCK));
  CHECK(!ota_memory_ok(true, OTA_HTTPS_MIN_FREE_HEAP, OTA_HTTPS_MIN_LARGEST_BLOCK - 1));
  /* https needs a second TLS session: never cheaper than plain http */
  CHECK(OTA_HTTPS_MIN_FREE_HEAP > OTA_HTTP_MIN_FREE_HEAP);
  CHECK(!ota_memory_ok(true, OTA_HTTP_MIN_FREE_HEAP, OTA_HTTP_MIN_LARGEST_BLOCK));
}

/* ---- progress ---- */

static void test_percent(void) {
  CHECK(ota_percent(0, 1000) == 0);
  CHECK(ota_percent(500, 1000) == 50);
  CHECK(ota_percent(999, 1000) == 99);
  CHECK(ota_percent(1000, 1000) == 100);
  CHECK(ota_percent(5000, 1000) == 100); /* clamped */
  CHECK(ota_percent(10, 0) == 0);
  CHECK(ota_percent(3000000000ull, 4000000000u) == 75); /* no 32-bit overflow */
}

static void test_progress_every_ten_percent(void) {
  ota_progress_t p;
  ota_progress_start(&p, 0);
  CHECK(!ota_progress_should_publish(&p, 3, 100));
  CHECK(!ota_progress_should_publish(&p, 9, 200));
  CHECK(ota_progress_should_publish(&p, 10, 300));
  CHECK(!ota_progress_should_publish(&p, 15, 400));
  CHECK(!ota_progress_should_publish(&p, 19, 500));
  CHECK(ota_progress_should_publish(&p, 20, 600));
  CHECK(ota_progress_should_publish(&p, 35, 700)); /* a jump of 15 counts */
  CHECK(ota_progress_should_publish(&p, 100, 800));
}

static void test_progress_every_five_seconds(void) {
  ota_progress_t p;
  ota_progress_start(&p, 1000);
  CHECK(!ota_progress_should_publish(&p, 1, 4000)); /* 3 s */
  CHECK(ota_progress_should_publish(&p, 1, 6000));  /* 5 s since the start, advanced 1 */
  CHECK(!ota_progress_should_publish(&p, 2, 10999));
  CHECK(ota_progress_should_publish(&p, 2, 11000));
}

static void test_progress_never_repeats_the_same_percent(void) {
  ota_progress_t p;
  ota_progress_start(&p, 0);
  CHECK(ota_progress_should_publish(&p, 10, 100));
  CHECK(!ota_progress_should_publish(&p, 10, 20000)); /* 5 s passed but nothing advanced */
  CHECK(!ota_progress_should_publish(&p, 9, 40000));  /* never goes backwards */
}

/* ---- status payload ---- */

static void test_status_accepted(void) {
  char buf[OTA_STATUS_MAX];
  ota_status_t s;
  memset(&s, 0, sizeof(s));
  strcpy(s.request_id, "r-1");
  strcpy(s.target_version, "0.2.0");
  s.state = OTA_ST_ACCEPTED;
  s.progress = -1;
  size_t n = ota_build_status(buf, sizeof(buf), &s, "0.1.0");
  CHECK(n > 0 && n == strlen(buf));
  CHECK(strcmp(buf, "{\"request_id\":\"r-1\",\"state\":\"accepted\","
                    "\"running_version\":\"0.1.0\",\"target_version\":\"0.2.0\"}") == 0);
}

static void test_status_downloading_has_progress_only_then(void) {
  char buf[OTA_STATUS_MAX];
  ota_status_t s;
  memset(&s, 0, sizeof(s));
  strcpy(s.request_id, "r");
  strcpy(s.target_version, "v2");
  s.state = OTA_ST_DOWNLOADING;
  s.progress = 40;
  CHECK(ota_build_status(buf, sizeof(buf), &s, "v1") > 0);
  CHECK(strstr(buf, "\"progress\":40") != NULL);
  CHECK(strstr(buf, "\"error\"") == NULL);
  s.state = OTA_ST_VERIFYING;
  CHECK(ota_build_status(buf, sizeof(buf), &s, "v1") > 0);
  CHECK(strstr(buf, "\"progress\"") == NULL);
  s.state = OTA_ST_DOWNLOADING;
  s.progress = -1;
  CHECK(ota_build_status(buf, sizeof(buf), &s, "v1") > 0);
  CHECK(strstr(buf, "\"progress\"") == NULL);
}

static void test_status_error_only_with_rejected_failed_rolled_back(void) {
  char buf[OTA_STATUS_MAX];
  ota_status_t s;
  memset(&s, 0, sizeof(s));
  strcpy(s.request_id, "r");
  strcpy(s.target_version, "v2");
  s.progress = -1;
  s.error = OTA_ERR_BUSY;

  s.state = OTA_ST_REJECTED;
  CHECK(ota_build_status(buf, sizeof(buf), &s, "v1") > 0);
  CHECK(strstr(buf, "\"error\":{\"code\":\"busy\",\"message\":\"") != NULL);
  s.state = OTA_ST_FAILED;
  s.error = OTA_ERR_SIZE_MISMATCH;
  CHECK(ota_build_status(buf, sizeof(buf), &s, "v1") > 0);
  CHECK(strstr(buf, "\"code\":\"size_mismatch\"") != NULL);
  s.state = OTA_ST_ROLLED_BACK;
  s.error = OTA_ERR_ROLLBACK;
  CHECK(ota_build_status(buf, sizeof(buf), &s, "v1") > 0);
  CHECK(strstr(buf, "\"code\":\"rollback\"") != NULL);
  s.state = OTA_ST_INSTALLING;
  CHECK(ota_build_status(buf, sizeof(buf), &s, "v1") > 0);
  CHECK(strstr(buf, "\"error\"") == NULL);
  s.state = OTA_ST_FAILED;
  s.error = OTA_ERR_NONE;
  CHECK(ota_build_status(buf, sizeof(buf), &s, "v1") > 0);
  CHECK(strstr(buf, "\"error\"") == NULL);
}

static void test_status_escapes_and_bounds(void) {
  char buf[OTA_STATUS_MAX];
  ota_status_t s;
  memset(&s, 0, sizeof(s));
  strcpy(s.request_id, "a\"b\\c");
  strcpy(s.target_version, "v\n2");
  s.state = OTA_ST_SUCCEEDED;
  s.progress = -1;
  CHECK(ota_build_status(buf, sizeof(buf), &s, "v1") > 0);
  CHECK(strstr(buf, "\"request_id\":\"a\\\"b\\\\c\"") != NULL);
  CHECK(strstr(buf, "\"target_version\":\"v\\n2\"") != NULL);
  char tiny[20];
  CHECK(ota_build_status(tiny, sizeof(tiny), &s, "v1") == 0);
  CHECK(ota_build_status(NULL, 0, &s, "v1") == 0);
  /* the largest legal fields and the longest message still fit the payload buffer */
  memset(s.request_id, 'r', OTA_ID_MAX - 1);
  s.request_id[OTA_ID_MAX - 1] = '\0';
  memset(s.target_version, 't', OTA_VERSION_MAX - 1);
  s.target_version[OTA_VERSION_MAX - 1] = '\0';
  char running[OTA_VERSION_MAX];
  memset(running, 'v', sizeof(running) - 1);
  running[sizeof(running) - 1] = '\0';
  s.state = OTA_ST_REJECTED;
  for (int e = OTA_ERR_BUSY; e <= OTA_ERR_INTERNAL; e++) {
    s.error = (ota_error_t)e;
    CHECK(ota_build_status(buf, sizeof(buf), &s, running) > 0);
  }
}

/* ---- image verification ---- */

static void test_hex_from_digest(void) {
  uint8_t d[32];
  for (int i = 0; i < 32; i++) d[i] = (uint8_t)(i * 8 + 1);
  char hex[OTA_SHA256_HEX_LEN + 1];
  ota_hex_from_digest(d, hex);
  CHECK(strlen(hex) == 64);
  CHECK(strncmp(hex, "01091119", 8) == 0);
  memset(d, 0xff, sizeof(d));
  ota_hex_from_digest(d, hex);
  CHECK(strspn(hex, "f") == 64);
}

static void test_verify_image(void) {
  CHECK(ota_verify_image(1000, 1000, SHA_A, SHA_A) == OTA_ERR_NONE);
  CHECK(ota_verify_image(999, 1000, SHA_A, SHA_A) == OTA_ERR_SIZE_MISMATCH);
  CHECK(ota_verify_image(1001, 1000, SHA_A, SHA_A) == OTA_ERR_SIZE_MISMATCH);
  CHECK(ota_verify_image(1000, 1000, "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff", SHA_A) ==
        OTA_ERR_SHA256_MISMATCH);
  /* the size is checked first: a short download is a size error, not a hash error */
  CHECK(ota_verify_image(10, 1000, "ff", SHA_A) == OTA_ERR_SIZE_MISMATCH);
  CHECK(ota_verify_image(1000, 1000, "", SHA_A) == OTA_ERR_SHA256_MISMATCH);
  CHECK(ota_verify_image(1000, 1000, NULL, SHA_A) == OTA_ERR_SHA256_MISMATCH);
}

/* ---- marker ---- */

static ota_marker_t sample_marker(void) {
  ota_marker_t m;
  memset(&m, 0, sizeof(m));
  strcpy(m.request_id, "req-9");
  strcpy(m.target_version, "0.2.0");
  strcpy(m.previous_version, "0.1.0");
  m.target_slot = 1;
  return m;
}

static void test_marker_round_trip(void) {
  ota_marker_t m = sample_marker();
  char buf[OTA_MARKER_SERIALIZED_MAX];
  size_t n = ota_marker_serialize(&m, buf, sizeof(buf));
  CHECK(n > 0 && n == strlen(buf));
  ota_marker_t out;
  memset(&out, 0, sizeof(out));
  CHECK(ota_marker_parse(buf, &out));
  CHECK(strcmp(out.request_id, "req-9") == 0);
  CHECK(strcmp(out.target_version, "0.2.0") == 0);
  CHECK(strcmp(out.previous_version, "0.1.0") == 0);
  CHECK(out.target_slot == 1);
}

static void test_marker_round_trip_with_awkward_text_and_limits(void) {
  ota_marker_t m = sample_marker();
  strcpy(m.request_id, "a\"b|c\\d");
  memset(m.target_version, 't', OTA_VERSION_MAX - 1);
  m.target_version[OTA_VERSION_MAX - 1] = '\0';
  m.target_slot = 0;
  char buf[OTA_MARKER_SERIALIZED_MAX];
  CHECK(ota_marker_serialize(&m, buf, sizeof(buf)) > 0);
  ota_marker_t out;
  CHECK(ota_marker_parse(buf, &out));
  CHECK(strcmp(out.request_id, m.request_id) == 0);
  CHECK(strcmp(out.target_version, m.target_version) == 0);
  CHECK(out.target_slot == 0);
  char tiny[10];
  CHECK(ota_marker_serialize(&m, tiny, sizeof(tiny)) == 0);
}

static void test_marker_parse_rejects_garbage(void) {
  ota_marker_t out;
  CHECK(!ota_marker_parse(NULL, &out));
  CHECK(!ota_marker_parse("", &out));
  CHECK(!ota_marker_parse("garbage", &out));
  CHECK(!ota_marker_parse("{}", &out));
  CHECK(!ota_marker_parse("{\"request_id\":\"r\",\"target_version\":\"t\"}", &out));
  CHECK(!ota_marker_parse("{\"request_id\":\"\",\"target_version\":\"t\","
                          "\"previous_version\":\"p\",\"target_slot\":1}",
                          &out));
  CHECK(!ota_marker_parse("{\"request_id\":\"r\",\"target_version\":\"t\","
                          "\"previous_version\":\"p\",\"target_slot\":5}",
                          &out));
  CHECK(!ota_marker_parse("{\"request_id\":\"r\",\"target_version\":\"t\","
                          "\"previous_version\":\"p\",\"target_slot\":-1}",
                          &out));
}

/* ---- boot after an update ---- */

static void test_boot_no_marker(void) {
  ota_boot_plan_t p = ota_boot_decide(NULL, "0.1.0", 0, OTA_IMG_VALID);
  CHECK(!p.validate && !p.report && !p.clear_marker);
  /* a pending image without any request is still validated (it never reports) */
  p = ota_boot_decide(NULL, "0.1.0", 1, OTA_IMG_PENDING_VERIFY);
  CHECK(p.validate && !p.report && !p.clear_marker);
  /* flashed by cable: otadata erased, state undefined */
  p = ota_boot_decide(NULL, "0.1.0", 0, OTA_IMG_UNDEFINED);
  CHECK(!p.validate && !p.report);
}

static void test_boot_new_image_pending_verify(void) {
  ota_marker_t m = sample_marker(); /* slot 1, target 0.2.0, previous 0.1.0 */
  ota_boot_plan_t p = ota_boot_decide(&m, "0.2.0", 1, OTA_IMG_PENDING_VERIFY);
  CHECK(p.validate);
  CHECK(p.report && p.state == OTA_ST_SUCCEEDED && p.error == OTA_ERR_NONE);
  CHECK(!p.clear_marker); /* cleared only after the report went out */
}

static void test_boot_new_image_already_valid_reports_again(void) {
  ota_marker_t m = sample_marker();
  ota_boot_plan_t p = ota_boot_decide(&m, "0.2.0", 1, OTA_IMG_VALID);
  CHECK(!p.validate);
  CHECK(p.report && p.state == OTA_ST_SUCCEEDED);
}

static void test_boot_new_image_with_other_version(void) {
  ota_marker_t m = sample_marker();
  ota_boot_plan_t p = ota_boot_decide(&m, "9.9.9", 1, OTA_IMG_PENDING_VERIFY);
  CHECK(p.validate);
  CHECK(p.report && p.state == OTA_ST_FAILED && p.error == OTA_ERR_INTERNAL);
}

static void test_boot_rolled_back(void) {
  ota_marker_t m = sample_marker();
  ota_boot_plan_t p = ota_boot_decide(&m, "0.1.0", 0, OTA_IMG_VALID);
  CHECK(!p.validate);
  CHECK(p.report && p.state == OTA_ST_ROLLED_BACK && p.error == OTA_ERR_ROLLBACK);
  CHECK(!p.clear_marker);
}

static void test_boot_rolled_back_with_the_same_version(void) {
  /* force of the same version: only the slot tells a rollback from a success */
  ota_marker_t m = sample_marker();
  strcpy(m.target_version, "0.1.0");
  ota_boot_plan_t p = ota_boot_decide(&m, "0.1.0", 0, OTA_IMG_VALID);
  CHECK(p.report && p.state == OTA_ST_ROLLED_BACK);
  p = ota_boot_decide(&m, "0.1.0", 1, OTA_IMG_PENDING_VERIFY);
  CHECK(p.validate && p.report && p.state == OTA_ST_SUCCEEDED);
}

static void test_boot_stale_marker_is_dropped(void) {
  ota_marker_t m = sample_marker();
  /* slot 0 runs a version that is neither the previous one nor the target: reflashed by cable */
  ota_boot_plan_t p = ota_boot_decide(&m, "0.5.0", 0, OTA_IMG_VALID);
  CHECK(!p.report && p.clear_marker && !p.validate);
}

static void test_boot_rolled_back_pending_image_is_validated(void) {
  ota_marker_t m = sample_marker();
  ota_boot_plan_t p = ota_boot_decide(&m, "0.1.0", 0, OTA_IMG_PENDING_VERIFY);
  CHECK(p.validate);
  CHECK(p.report && p.state == OTA_ST_ROLLED_BACK);
}

/* ---- validation window ---- */

static void test_validation_step(void) {
  CHECK(ota_validation_step(true, true, 0) == OTA_VALIDATION_OK);
  CHECK(ota_validation_step(true, true, OTA_VALIDATE_TIMEOUT_S - 1) == OTA_VALIDATION_OK);
  CHECK(ota_validation_step(false, true, 10) == OTA_VALIDATION_WAIT);
  CHECK(ota_validation_step(true, false, 10) == OTA_VALIDATION_WAIT);
  CHECK(ota_validation_step(false, false, 0) == OTA_VALIDATION_WAIT);
  CHECK(ota_validation_step(true, false, OTA_VALIDATE_TIMEOUT_S - 1) == OTA_VALIDATION_WAIT);
  CHECK(ota_validation_step(true, false, OTA_VALIDATE_TIMEOUT_S) == OTA_VALIDATION_ROLLBACK);
  CHECK(ota_validation_step(false, false, 1000) == OTA_VALIDATION_ROLLBACK);
  /* too late is too late, even when everything is there now */
  CHECK(ota_validation_step(true, true, OTA_VALIDATE_TIMEOUT_S) == OTA_VALIDATION_ROLLBACK);
}

int main(void) {
  RUN(test_names_and_codes);
  RUN(test_state_classes);
  RUN(test_parse_valid);
  RUN(test_parse_force);
  RUN(test_parse_unreadable);
  RUN(test_parse_urls);
  RUN(test_parse_invalid_fields);
  RUN(test_parse_url_length);
  RUN(test_tracker_basics);
  RUN(test_tracker_is_bounded);
  RUN(test_tracker_never_evicts_the_active_request);
  RUN(test_decide_accept);
  RUN(test_decide_same_version_unless_force);
  RUN(test_decide_invalid);
  RUN(test_decide_image_larger_than_the_slot);
  RUN(test_decide_device_busy);
  RUN(test_decide_one_at_a_time);
  RUN(test_decide_redelivery_replays_without_running_again);
  RUN(test_memory_budget);
  RUN(test_percent);
  RUN(test_progress_every_ten_percent);
  RUN(test_progress_every_five_seconds);
  RUN(test_progress_never_repeats_the_same_percent);
  RUN(test_status_accepted);
  RUN(test_status_downloading_has_progress_only_then);
  RUN(test_status_error_only_with_rejected_failed_rolled_back);
  RUN(test_status_escapes_and_bounds);
  RUN(test_hex_from_digest);
  RUN(test_verify_image);
  RUN(test_marker_round_trip);
  RUN(test_marker_round_trip_with_awkward_text_and_limits);
  RUN(test_marker_parse_rejects_garbage);
  RUN(test_boot_no_marker);
  RUN(test_boot_new_image_pending_verify);
  RUN(test_boot_new_image_already_valid_reports_again);
  RUN(test_boot_new_image_with_other_version);
  RUN(test_boot_rolled_back);
  RUN(test_boot_rolled_back_with_the_same_version);
  RUN(test_boot_stale_marker_is_dropped);
  RUN(test_boot_rolled_back_pending_image_is_validated);
  RUN(test_validation_step);
  TEST_MAIN_END();
}
