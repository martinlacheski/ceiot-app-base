/*
 * ota_remote.c - see ota_remote.h. Pure C99, no ESP-IDF.
 */

#include "ota_remote.h"

#include "cJSON.h"
#include <stdio.h>
#include <string.h>

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

/* Copies at most size-1 bytes and always terminates. */
static void copy_trunc(char *dst, size_t size, const char *src) {
  if (size == 0) return;
  size_t n = src != NULL ? strlen(src) : 0;
  if (n >= size) n = size - 1;
  if (n > 0) memcpy(dst, src, n);
  dst[n] = '\0';
}

/* The string value of `key`, or NULL when absent, not a string or not in 1..max-1 bytes. */
static const char *string_field(const cJSON *root, const char *key, size_t max) {
  const cJSON *item = cJSON_GetObjectItemCaseSensitive(root, key);
  if (!cJSON_IsString(item) || item->valuestring == NULL) return NULL;
  size_t n = strlen(item->valuestring);
  return (n >= 1 && n < max) ? item->valuestring : NULL;
}

/* Serializes `root` (consumed) into buf. Returns the length, 0 when it does not fit. */
static size_t print_into(cJSON *root, char *buf, size_t size) {
  if (root == NULL) return 0;
  char *text = cJSON_PrintUnformatted(root);
  cJSON_Delete(root);
  if (text == NULL) return 0;
  size_t n = strlen(text);
  size_t result = 0;
  if (n < size) {
    memcpy(buf, text, n + 1);
    result = n;
  }
  cJSON_free(text);
  return result;
}

/* ------------------------------------------------------------------ */
/* payloads                                                            */
/* ------------------------------------------------------------------ */

size_t ota_build_check(char *buf, size_t size, const char *request_id, const char *running_version) {
  cJSON *root = cJSON_CreateObject();
  if (root == NULL) return 0;
  cJSON_AddStringToObject(root, "request_id", request_id != NULL ? request_id : "");
  cJSON_AddStringToObject(root, "running_version", running_version != NULL ? running_version : "");
  return print_into(root, buf, size);
}

size_t ota_build_request(char *buf, size_t size, const char *request_id, const char *version,
                         const char *running_version) {
  cJSON *root = cJSON_CreateObject();
  if (root == NULL) return 0;
  cJSON_AddStringToObject(root, "request_id", request_id != NULL ? request_id : "");
  cJSON_AddStringToObject(root, "version", version != NULL ? version : "");
  cJSON_AddStringToObject(root, "running_version", running_version != NULL ? running_version : "");
  return print_into(root, buf, size);
}

bool ota_make_request_id(char *out, size_t size, const char *prefix, const uint32_t rnd[4]) {
  size_t plen = prefix != NULL ? strlen(prefix) : 0;
  if (out == NULL || rnd == NULL || size < plen + 36 + 1) return false;
  uint8_t b[16];
  for (int i = 0; i < 16; i++) b[i] = (uint8_t)(rnd[i / 4] >> (24 - 8 * (i % 4)));
  b[6] = (uint8_t)((b[6] & 0x0f) | 0x40); /* version 4 */
  b[8] = (uint8_t)((b[8] & 0x3f) | 0x80); /* RFC 4122 variant */
  if (plen > 0) memcpy(out, prefix, plen);
  snprintf(out + plen, size - plen,
           "%02x%02x%02x%02x-%02x%02x-%02x%02x-%02x%02x-%02x%02x%02x%02x%02x%02x", b[0], b[1], b[2],
           b[3], b[4], b[5], b[6], b[7], b[8], b[9], b[10], b[11], b[12], b[13], b[14], b[15]);
  return true;
}

/* ------------------------------------------------------------------ */
/* ota/available                                                       */
/* ------------------------------------------------------------------ */

bool ota_parse_available(const char *json, ota_available_t *out) {
  if (json == NULL || json[0] == '\0' || out == NULL) return false;
  cJSON *root = cJSON_Parse(json);
  if (root == NULL) return false;
  bool ok = false;
  const char *id = string_field(root, "request_id", OTA_ID_MAX);
  const cJSON *version = cJSON_GetObjectItemCaseSensitive(root, "version");
  bool version_ok = version == NULL || cJSON_IsNull(version) ||
                    (cJSON_IsString(version) && version->valuestring != NULL &&
                     strlen(version->valuestring) < OTA_VERSION_MAX);
  if (cJSON_IsObject(root) && id != NULL && version_ok) {
    memset(out, 0, sizeof(*out));
    copy_trunc(out->request_id, sizeof(out->request_id), id);
    if (cJSON_IsString(version) && version->valuestring[0] != '\0') {
      out->has_version = true;
      copy_trunc(out->version, sizeof(out->version), version->valuestring);
    }
    const cJSON *size = cJSON_GetObjectItemCaseSensitive(root, "size");
    if (cJSON_IsNumber(size) && size->valuedouble >= 0.0 && size->valuedouble <= 4294967295.0) {
      out->size = (uint32_t)size->valuedouble;
    }
    const cJSON *error = cJSON_GetObjectItemCaseSensitive(root, "error");
    if (cJSON_IsObject(error)) {
      const char *code = string_field(error, "code", OTA_REMOTE_CODE_MAX);
      if (code != NULL) {
        out->has_error = true;
        copy_trunc(out->error_code, sizeof(out->error_code), code);
        const cJSON *msg = cJSON_GetObjectItemCaseSensitive(error, "message");
        if (cJSON_IsString(msg)) copy_trunc(out->error_message, sizeof(out->error_message), msg->valuestring);
      }
    }
    ok = true;
  }
  cJSON_Delete(root);
  return ok;
}

/* ------------------------------------------------------------------ */
/* the other OTA slot                                                  */
/* ------------------------------------------------------------------ */

ota_prev_reason_t ota_prev_decide(const ota_prev_candidate_t *c, const char *running_version) {
  if (c == NULL || (c->slot != 0 && c->slot != 1) || !c->readable || c->version[0] == '\0') {
    return OTA_PREV_NO_IMAGE;
  }
  if (c->state == OTA_IMG_INVALID || c->state == OTA_IMG_NEW || c->state == OTA_IMG_PENDING_VERIFY) {
    return OTA_PREV_NOT_VALID;
  }
  if (running_version != NULL && strcmp(c->version, running_version) == 0) {
    return OTA_PREV_SAME_VERSION;
  }
  return OTA_PREV_OFFER;
}

void ota_switch_marker(ota_marker_t *m, const char *request_id, const ota_prev_candidate_t *prev,
                       const char *running_version) {
  memset(m, 0, sizeof(*m));
  copy_trunc(m->request_id, sizeof(m->request_id), request_id);
  copy_trunc(m->target_version, sizeof(m->target_version), prev->version);
  copy_trunc(m->previous_version, sizeof(m->previous_version), running_version);
  m->target_slot = prev->slot;
}

/* ------------------------------------------------------------------ */
/* the open question                                                   */
/* ------------------------------------------------------------------ */

void ota_remote_init(ota_remote_t *r) {
  memset(r, 0, sizeof(*r));
  r->phase = OTA_REMOTE_IDLE;
}

const char *ota_remote_phase_name(ota_remote_phase_t phase) {
  switch (phase) {
  case OTA_REMOTE_CHECKING: return "checking";
  case OTA_REMOTE_UP_TO_DATE: return "up_to_date";
  case OTA_REMOTE_AVAILABLE: return "available";
  case OTA_REMOTE_REQUESTING: return "requesting";
  case OTA_REMOTE_UPDATING: return "updating";
  case OTA_REMOTE_ERROR: return "error";
  case OTA_REMOTE_IDLE:
  default: return "idle";
  }
}

bool ota_remote_is_busy(const ota_remote_t *r) {
  return r->phase == OTA_REMOTE_CHECKING || r->phase == OTA_REMOTE_REQUESTING ||
         r->phase == OTA_REMOTE_UPDATING;
}

static void clear_error(ota_remote_t *r) {
  r->error_code[0] = '\0';
  r->error_message[0] = '\0';
}

static void set_error(ota_remote_t *r, const char *code, const char *message, int64_t now_ms) {
  r->phase = OTA_REMOTE_ERROR;
  copy_trunc(r->error_code, sizeof(r->error_code), code);
  copy_trunc(r->error_message, sizeof(r->error_message), message);
  r->has_answer = true;
  r->answered_ms = now_ms;
}

bool ota_remote_begin_check(ota_remote_t *r, const char *request_id, int64_t now_ms) {
  if (ota_remote_is_busy(r) || request_id == NULL || request_id[0] == '\0') return false;
  r->phase = OTA_REMOTE_CHECKING;
  copy_trunc(r->request_id, sizeof(r->request_id), request_id);
  r->since_ms = now_ms;
  r->version[0] = '\0';
  r->size = 0;
  clear_error(r);
  return true;
}

bool ota_remote_begin_request(ota_remote_t *r, const char *request_id, int64_t now_ms) {
  if (r->phase != OTA_REMOTE_AVAILABLE || r->version[0] == '\0' || request_id == NULL ||
      request_id[0] == '\0') {
    return false;
  }
  r->phase = OTA_REMOTE_REQUESTING;
  copy_trunc(r->request_id, sizeof(r->request_id), request_id);
  r->since_ms = now_ms;
  clear_error(r);
  return true;
}

bool ota_remote_on_available(ota_remote_t *r, const ota_available_t *a, int64_t now_ms) {
  if (a == NULL || strcmp(a->request_id, r->request_id) != 0) return false;
  if (r->phase == OTA_REMOTE_CHECKING) {
    if (a->has_error) {
      set_error(r, a->error_code, a->error_message, now_ms);
      return true;
    }
    r->has_answer = true;
    r->answered_ms = now_ms;
    if (a->has_version) {
      r->phase = OTA_REMOTE_AVAILABLE;
      copy_trunc(r->version, sizeof(r->version), a->version);
      r->size = a->size;
    } else {
      r->phase = OTA_REMOTE_UP_TO_DATE;
    }
    return true;
  }
  if (r->phase == OTA_REMOTE_REQUESTING) {
    if (a->has_error) {
      set_error(r, a->error_code, a->error_message, now_ms);
    } else {
      set_error(r, "refused", "La plataforma rechazó el pedido", now_ms);
    }
    return true;
  }
  return false;
}

void ota_remote_on_status(ota_remote_t *r, const ota_status_t *st, int64_t now_ms) {
  if (st == NULL || strcmp(st->request_id, r->request_id) != 0) return;
  if (r->phase != OTA_REMOTE_REQUESTING && r->phase != OTA_REMOTE_UPDATING) return;
  if (ota_state_is_active(st->state)) {
    r->phase = OTA_REMOTE_UPDATING;
    return;
  }
  if (st->state == OTA_ST_REJECTED || st->state == OTA_ST_FAILED || st->state == OTA_ST_ROLLED_BACK) {
    ota_error_t err = st->error != OTA_ERR_NONE ? st->error : OTA_ERR_INTERNAL;
    set_error(r, ota_error_code(err), ota_error_message(err), now_ms);
  }
}

void ota_remote_step(ota_remote_t *r, int64_t now_ms) {
  if (r->phase != OTA_REMOTE_CHECKING && r->phase != OTA_REMOTE_REQUESTING) return;
  if (now_ms - r->since_ms >= OTA_REMOTE_ANSWER_TIMEOUT_MS) {
    set_error(r, "timeout", "La plataforma no respondió a tiempo", now_ms);
  }
}

void ota_remote_fail(ota_remote_t *r, const char *code, const char *message) {
  if (r->phase != OTA_REMOTE_CHECKING && r->phase != OTA_REMOTE_REQUESTING) return;
  set_error(r, code, message, r->since_ms);
}
