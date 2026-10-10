/* Host tests of the device-initiated update rules (main/ota/ota_remote.c).
 * Contract: backend/app/api/device/firmware/service.py (handle_check,
 * handle_request, _answer) and status.py (OtaCheckPayload, OtaRequestPayload).
 * Payload, ota/available and previous-image rules ported from DVEM-App
 * devices/esp-idf-guition-1r1p/tests (ota_remote); the check/request state
 * replaces the device-screen flow (ota_flow) with what the web UI needs. */
#include "ota_remote.h"
#include "test_util.h"

#include <stdio.h>
#include <string.h>

/* ---- payloads ---- */

static void test_build_check(void) {
  char buf[OTA_REMOTE_PAYLOAD_MAX];
  size_t n = ota_build_check(buf, sizeof(buf), "id-1", "0.2.0");
  CHECK(n == strlen(buf));
  CHECK(strcmp(buf, "{\"request_id\":\"id-1\",\"running_version\":\"0.2.0\"}") == 0);
  CHECK(ota_build_check(buf, 10, "id-1", "0.2.0") == 0);
}

static void test_build_request(void) {
  char buf[OTA_REMOTE_PAYLOAD_MAX];
  size_t n = ota_build_request(buf, sizeof(buf), "id-2", "0.3.0", "0.2.0");
  CHECK(n == strlen(buf));
  CHECK(strcmp(buf, "{\"request_id\":\"id-2\",\"version\":\"0.3.0\",\"running_version\":\"0.2.0\"}") == 0);
  CHECK(ota_build_request(buf, 16, "id-2", "0.3.0", "0.2.0") == 0);
}

static void test_make_request_id(void) {
  const uint32_t rnd[4] = {0x01234567u, 0x89abcdefu, 0xfedcba98u, 0x76543210u};
  char id[OTA_ID_MAX];
  CHECK(ota_make_request_id(id, sizeof(id), NULL, rnd));
  CHECK(strlen(id) == 36);
  CHECK(id[8] == '-' && id[13] == '-' && id[18] == '-' && id[23] == '-');
  CHECK(id[14] == '4');                                      /* uuid v4 */
  CHECK(id[19] == '8' || id[19] == '9' || id[19] == 'a' || id[19] == 'b'); /* RFC 4122 variant */
  CHECK(ota_make_request_id(id, sizeof(id), OTA_SWITCH_PREFIX, rnd));
  CHECK(strncmp(id, OTA_SWITCH_PREFIX, strlen(OTA_SWITCH_PREFIX)) == 0);
  CHECK(strlen(id) == strlen(OTA_SWITCH_PREFIX) + 36);
  CHECK(strlen(id) <= 64); /* backend request_id limit */
  char small[20];
  CHECK(!ota_make_request_id(small, sizeof(small), NULL, rnd));
}

/* ---- ota/available ---- */

static void test_parse_available_release(void) {
  ota_available_t a;
  CHECK(ota_parse_available("{\"request_id\":\"id-1\",\"version\":\"0.3.0\",\"size\":1114112}", &a));
  CHECK(strcmp(a.request_id, "id-1") == 0);
  CHECK(a.has_version);
  CHECK(strcmp(a.version, "0.3.0") == 0);
  CHECK(a.size == 1114112u);
  CHECK(!a.has_error);
}

static void test_parse_available_none(void) {
  ota_available_t a;
  CHECK(ota_parse_available("{\"request_id\":\"id-1\",\"version\":null}", &a));
  CHECK(!a.has_version);
  CHECK(!a.has_error);
  CHECK(ota_parse_available("{\"request_id\":\"id-1\"}", &a));
  CHECK(!a.has_version);
}

static void test_parse_available_error(void) {
  ota_available_t a;
  CHECK(ota_parse_available("{\"request_id\":\"id-2\",\"version\":null,"
                            "\"error\":{\"code\":\"in_progress\",\"message\":\"Hay una actualizaci\\u00f3n en curso\"}}",
                            &a));
  CHECK(a.has_error);
  CHECK(strcmp(a.error_code, "in_progress") == 0);
  CHECK(strncmp(a.error_message, "Hay una actualizaci", 19) == 0);
  /* error without a usable code is ignored, the answer stays readable */
  CHECK(ota_parse_available("{\"request_id\":\"id-2\",\"error\":{\"message\":\"x\"}}", &a));
  CHECK(!a.has_error);
}

static void test_parse_available_unreadable(void) {
  ota_available_t a;
  CHECK(!ota_parse_available(NULL, &a));
  CHECK(!ota_parse_available("", &a));
  CHECK(!ota_parse_available("nope", &a));
  CHECK(!ota_parse_available("[]", &a));
  CHECK(!ota_parse_available("{\"version\":\"0.3.0\"}", &a));
  CHECK(!ota_parse_available("{\"request_id\":\"\"}", &a));
  CHECK(!ota_parse_available("{\"request_id\":\"id\",\"version\":5}", &a));
  char json[200];
  snprintf(json, sizeof(json), "{\"request_id\":\"id\",\"version\":\"%033d\"}", 1); /* > 32 chars */
  CHECK(!ota_parse_available(json, &a));
}

/* ---- the other OTA slot ---- */

static ota_prev_candidate_t candidate(int slot, bool readable, const char *version, ota_img_state_t st) {
  ota_prev_candidate_t c;
  memset(&c, 0, sizeof(c));
  c.slot = slot;
  c.readable = readable;
  strcpy(c.version, version);
  c.state = st;
  return c;
}

static void test_prev_decide(void) {
  ota_prev_candidate_t c = candidate(1, true, "0.2.0", OTA_IMG_VALID);
  CHECK(ota_prev_decide(&c, "0.3.0") == OTA_PREV_OFFER);
  c = candidate(1, true, "0.4.0", OTA_IMG_UNDEFINED); /* newer is offered too */
  CHECK(ota_prev_decide(&c, "0.3.0") == OTA_PREV_OFFER);
  c = candidate(1, true, "0.3.0", OTA_IMG_VALID);
  CHECK(ota_prev_decide(&c, "0.3.0") == OTA_PREV_SAME_VERSION);
  c = candidate(1, false, "", OTA_IMG_UNDEFINED);
  CHECK(ota_prev_decide(&c, "0.3.0") == OTA_PREV_NO_IMAGE);
  c = candidate(-1, true, "0.2.0", OTA_IMG_VALID);
  CHECK(ota_prev_decide(&c, "0.3.0") == OTA_PREV_NO_IMAGE);
  c = candidate(0, true, "0.2.0", OTA_IMG_INVALID);
  CHECK(ota_prev_decide(&c, "0.3.0") == OTA_PREV_NOT_VALID);
  c = candidate(0, true, "0.2.0", OTA_IMG_PENDING_VERIFY);
  CHECK(ota_prev_decide(&c, "0.3.0") == OTA_PREV_NOT_VALID);
  c = candidate(0, true, "0.2.0", OTA_IMG_NEW);
  CHECK(ota_prev_decide(&c, "0.3.0") == OTA_PREV_NOT_VALID);
  CHECK(ota_prev_decide(NULL, "0.3.0") == OTA_PREV_NO_IMAGE);
}

static void test_switch_marker_follows_boot_rules(void) {
  ota_prev_candidate_t c = candidate(0, true, "0.2.0", OTA_IMG_VALID);
  ota_marker_t m;
  ota_switch_marker(&m, "local-switch:abc", &c, "0.3.0");
  CHECK(strcmp(m.request_id, "local-switch:abc") == 0);
  CHECK(strcmp(m.target_version, "0.2.0") == 0);
  CHECK(strcmp(m.previous_version, "0.3.0") == 0);
  CHECK(m.target_slot == 0);
  /* The marker round-trips and the existing boot rules validate / report it. */
  char buf[OTA_MARKER_SERIALIZED_MAX];
  CHECK(ota_marker_serialize(&m, buf, sizeof(buf)) > 0);
  ota_marker_t back;
  CHECK(ota_marker_parse(buf, &back));
  ota_boot_plan_t p = ota_boot_decide(&back, "0.2.0", 0, OTA_IMG_PENDING_VERIFY);
  CHECK(p.validate && p.report && p.state == OTA_ST_SUCCEEDED);
  p = ota_boot_decide(&back, "0.3.0", 1, OTA_IMG_VALID); /* the bootloader went back */
  CHECK(p.report && p.state == OTA_ST_ROLLED_BACK);
}

/* ---- check / request state ---- */

static ota_available_t answer(const char *id, const char *version, const char *code) {
  ota_available_t a;
  memset(&a, 0, sizeof(a));
  strcpy(a.request_id, id);
  if (version != NULL) {
    a.has_version = true;
    strcpy(a.version, version);
    a.size = 1000;
  }
  if (code != NULL) {
    a.has_error = true;
    strcpy(a.error_code, code);
    strcpy(a.error_message, "mensaje");
  }
  return a;
}

static void test_check_available(void) {
  ota_remote_t r;
  ota_remote_init(&r);
  CHECK(r.phase == OTA_REMOTE_IDLE);
  CHECK(!r.has_answer);
  CHECK(ota_remote_begin_check(&r, "c-1", 1000));
  CHECK(r.phase == OTA_REMOTE_CHECKING);
  CHECK(!ota_remote_begin_check(&r, "c-2", 1100)); /* one question at a time */
  ota_available_t a = answer("other", "0.3.0", NULL);
  CHECK(!ota_remote_on_available(&r, &a, 1200)); /* not the awaited answer */
  CHECK(r.phase == OTA_REMOTE_CHECKING);
  a = answer("c-1", "0.3.0", NULL);
  CHECK(ota_remote_on_available(&r, &a, 1500));
  CHECK(r.phase == OTA_REMOTE_AVAILABLE);
  CHECK(strcmp(r.version, "0.3.0") == 0);
  CHECK(r.size == 1000u);
  CHECK(r.has_answer && r.answered_ms == 1500);
  /* a late duplicate changes nothing */
  CHECK(!ota_remote_on_available(&r, &a, 1600));
  CHECK(r.answered_ms == 1500);
}

static void test_check_up_to_date_and_refused(void) {
  ota_remote_t r;
  ota_remote_init(&r);
  CHECK(ota_remote_begin_check(&r, "c-1", 0));
  ota_available_t a = answer("c-1", NULL, NULL);
  CHECK(ota_remote_on_available(&r, &a, 10));
  CHECK(r.phase == OTA_REMOTE_UP_TO_DATE);
  CHECK(r.version[0] == '\0');
  CHECK(ota_remote_begin_check(&r, "c-2", 20)); /* again from a result */
  a = answer("c-2", NULL, "internal");
  CHECK(ota_remote_on_available(&r, &a, 30));
  CHECK(r.phase == OTA_REMOTE_ERROR);
  CHECK(strcmp(r.error_code, "internal") == 0);
  CHECK(strcmp(r.error_message, "mensaje") == 0);
  CHECK(r.answered_ms == 30);
  CHECK(ota_remote_begin_check(&r, "c-3", 40)); /* and from an error */
  CHECK(r.error_code[0] == '\0');
}

static void test_timeout(void) {
  ota_remote_t r;
  ota_remote_init(&r);
  CHECK(ota_remote_begin_check(&r, "c-1", 1000));
  ota_remote_step(&r, 1000 + OTA_REMOTE_ANSWER_TIMEOUT_MS - 1);
  CHECK(r.phase == OTA_REMOTE_CHECKING);
  ota_remote_step(&r, 1000 + OTA_REMOTE_ANSWER_TIMEOUT_MS);
  CHECK(r.phase == OTA_REMOTE_ERROR);
  CHECK(strcmp(r.error_code, "timeout") == 0);
  CHECK(r.error_message[0] != '\0');
  /* the late answer is ignored */
  ota_available_t a = answer("c-1", "0.3.0", NULL);
  CHECK(!ota_remote_on_available(&r, &a, 30000));
  CHECK(r.phase == OTA_REMOTE_ERROR);
}

static ota_remote_t available_state(void) {
  ota_remote_t r;
  ota_remote_init(&r);
  ota_remote_begin_check(&r, "c-1", 0);
  ota_available_t a = answer("c-1", "0.3.0", NULL);
  ota_remote_on_available(&r, &a, 100);
  return r;
}

static ota_status_t status(const char *id, ota_state_t st, ota_error_t err, int progress) {
  ota_status_t s;
  memset(&s, 0, sizeof(s));
  strcpy(s.request_id, id);
  strcpy(s.target_version, "0.3.0");
  s.state = st;
  s.error = err;
  s.progress = progress;
  return s;
}

static void test_request_only_when_available(void) {
  ota_remote_t r;
  ota_remote_init(&r);
  CHECK(!ota_remote_begin_request(&r, "q-1", 0));
  CHECK(ota_remote_begin_check(&r, "c-1", 0));
  CHECK(!ota_remote_begin_request(&r, "q-1", 0)); /* still checking */
  r = available_state();
  CHECK(ota_remote_begin_request(&r, "q-1", 200));
  CHECK(r.phase == OTA_REMOTE_REQUESTING);
  CHECK(strcmp(r.request_id, "q-1") == 0);
  CHECK(strcmp(r.version, "0.3.0") == 0); /* the offered release is what is asked */
  CHECK(!ota_remote_begin_check(&r, "c-2", 300));
  CHECK(!ota_remote_begin_request(&r, "q-2", 300));
}

static void test_request_follows_the_update(void) {
  ota_remote_t r = available_state();
  CHECK(ota_remote_begin_request(&r, "q-1", 200));
  ota_status_t s = status("other", OTA_ST_ACCEPTED, OTA_ERR_NONE, -1);
  ota_remote_on_status(&r, &s, 300);
  CHECK(r.phase == OTA_REMOTE_REQUESTING); /* another request id */
  s = status("q-1", OTA_ST_ACCEPTED, OTA_ERR_NONE, -1);
  ota_remote_on_status(&r, &s, 400);
  CHECK(r.phase == OTA_REMOTE_UPDATING);
  /* no timeout once the backend's command arrived */
  ota_remote_step(&r, 400 + 10 * OTA_REMOTE_ANSWER_TIMEOUT_MS);
  CHECK(r.phase == OTA_REMOTE_UPDATING);
  s = status("q-1", OTA_ST_DOWNLOADING, OTA_ERR_NONE, 40);
  ota_remote_on_status(&r, &s, 500);
  CHECK(r.phase == OTA_REMOTE_UPDATING);
  CHECK(!ota_remote_begin_check(&r, "c-9", 600));
  s = status("q-1", OTA_ST_FAILED, OTA_ERR_SHA256_MISMATCH, -1);
  ota_remote_on_status(&r, &s, 700);
  CHECK(r.phase == OTA_REMOTE_ERROR);
  CHECK(strcmp(r.error_code, "sha256_mismatch") == 0);
  CHECK(r.error_message[0] != '\0');
}

static void test_request_rejected_by_device(void) {
  ota_remote_t r = available_state();
  CHECK(ota_remote_begin_request(&r, "q-1", 200));
  ota_status_t s = status("q-1", OTA_ST_REJECTED, OTA_ERR_BUSY, -1);
  ota_remote_on_status(&r, &s, 300);
  CHECK(r.phase == OTA_REMOTE_ERROR);
  CHECK(strcmp(r.error_code, "busy") == 0);
}

static void test_request_refused_by_backend(void) {
  ota_remote_t r = available_state();
  CHECK(ota_remote_begin_request(&r, "q-1", 200));
  ota_available_t a = answer("q-1", NULL, "same_version");
  CHECK(ota_remote_on_available(&r, &a, 300));
  CHECK(r.phase == OTA_REMOTE_ERROR);
  CHECK(strcmp(r.error_code, "same_version") == 0);
  /* a refusal without an error object is still a refusal */
  r = available_state();
  CHECK(ota_remote_begin_request(&r, "q-2", 200));
  a = answer("q-2", NULL, NULL);
  CHECK(ota_remote_on_available(&r, &a, 300));
  CHECK(r.phase == OTA_REMOTE_ERROR);
  CHECK(strcmp(r.error_code, "refused") == 0);
}

static void test_request_timeout(void) {
  ota_remote_t r = available_state();
  CHECK(ota_remote_begin_request(&r, "q-1", 1000));
  ota_remote_step(&r, 1000 + OTA_REMOTE_ANSWER_TIMEOUT_MS);
  CHECK(r.phase == OTA_REMOTE_ERROR);
  CHECK(strcmp(r.error_code, "timeout") == 0);
}

static void test_fail(void) {
  ota_remote_t r;
  ota_remote_init(&r);
  CHECK(ota_remote_begin_check(&r, "c-1", 0));
  ota_remote_fail(&r, "publish_failed", "No se pudo enviar");
  CHECK(r.phase == OTA_REMOTE_ERROR);
  CHECK(strcmp(r.error_code, "publish_failed") == 0);
  /* fail outside a question does nothing */
  ota_remote_init(&r);
  ota_remote_fail(&r, "x", "y");
  CHECK(r.phase == OTA_REMOTE_IDLE);
}

static void test_phase_names(void) {
  CHECK(strcmp(ota_remote_phase_name(OTA_REMOTE_IDLE), "idle") == 0);
  CHECK(strcmp(ota_remote_phase_name(OTA_REMOTE_CHECKING), "checking") == 0);
  CHECK(strcmp(ota_remote_phase_name(OTA_REMOTE_UP_TO_DATE), "up_to_date") == 0);
  CHECK(strcmp(ota_remote_phase_name(OTA_REMOTE_AVAILABLE), "available") == 0);
  CHECK(strcmp(ota_remote_phase_name(OTA_REMOTE_REQUESTING), "requesting") == 0);
  CHECK(strcmp(ota_remote_phase_name(OTA_REMOTE_UPDATING), "updating") == 0);
  CHECK(strcmp(ota_remote_phase_name(OTA_REMOTE_ERROR), "error") == 0);
}

int main(void) {
  RUN(test_build_check);
  RUN(test_build_request);
  RUN(test_make_request_id);
  RUN(test_parse_available_release);
  RUN(test_parse_available_none);
  RUN(test_parse_available_error);
  RUN(test_parse_available_unreadable);
  RUN(test_prev_decide);
  RUN(test_switch_marker_follows_boot_rules);
  RUN(test_check_available);
  RUN(test_check_up_to_date_and_refused);
  RUN(test_timeout);
  RUN(test_request_only_when_available);
  RUN(test_request_follows_the_update);
  RUN(test_request_rejected_by_device);
  RUN(test_request_refused_by_backend);
  RUN(test_request_timeout);
  RUN(test_fail);
  RUN(test_phase_names);
  TEST_MAIN_END();
}
