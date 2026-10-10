/*
 * ota_logic.c - see ota_logic.h. Pure C99, no ESP-IDF.
 */

#include "ota_logic.h"

#include "cJSON.h"
#include <stdio.h>
#include <string.h>

/* ------------------------------------------------------------------ */
/* names                                                               */
/* ------------------------------------------------------------------ */

const char *ota_state_name(ota_state_t state) {
  switch (state) {
  case OTA_ST_ACCEPTED: return "accepted";
  case OTA_ST_REJECTED: return "rejected";
  case OTA_ST_DOWNLOADING: return "downloading";
  case OTA_ST_VERIFYING: return "verifying";
  case OTA_ST_INSTALLING: return "installing";
  case OTA_ST_REBOOTING: return "rebooting";
  case OTA_ST_SUCCEEDED: return "succeeded";
  case OTA_ST_FAILED: return "failed";
  case OTA_ST_ROLLED_BACK: return "rolled_back";
  }
  return "failed";
}

const char *ota_error_code(ota_error_t error) {
  switch (error) {
  case OTA_ERR_NONE: return "";
  case OTA_ERR_BUSY: return "busy";
  case OTA_ERR_SAME_VERSION: return "same_version";
  case OTA_ERR_INVALID_COMMAND: return "invalid_command";
  case OTA_ERR_IMAGE_TOO_LARGE: return "image_too_large";
  case OTA_ERR_DOWNLOAD_FAILED: return "download_failed";
  case OTA_ERR_TLS_ERROR: return "tls_error";
  case OTA_ERR_SIZE_MISMATCH: return "size_mismatch";
  case OTA_ERR_SHA256_MISMATCH: return "sha256_mismatch";
  case OTA_ERR_NO_OTA_PARTITION: return "no_ota_partition";
  case OTA_ERR_FLASH_ERROR: return "flash_error";
  case OTA_ERR_NO_MEMORY: return "no_memory";
  case OTA_ERR_ROLLBACK: return "rollback";
  case OTA_ERR_INTERNAL: return "internal";
  }
  return "internal";
}

/* Same texts as tools/emulador-dispositivo.py where the code is shared. */
const char *ota_error_message(ota_error_t error) {
  switch (error) {
  case OTA_ERR_NONE: return "";
  case OTA_ERR_BUSY: return "El equipo ya está instalando otra actualización.";
  case OTA_ERR_SAME_VERSION: return "El equipo ya tiene esta versión.";
  case OTA_ERR_INVALID_COMMAND: return "La orden de actualización es inválida.";
  case OTA_ERR_IMAGE_TOO_LARGE: return "La imagen es más grande que la partición OTA del equipo.";
  case OTA_ERR_DOWNLOAD_FAILED: return "No se pudo descargar la imagen.";
  case OTA_ERR_TLS_ERROR: return "No se pudo establecer la conexión segura para la descarga.";
  case OTA_ERR_SIZE_MISMATCH: return "El tamaño de la imagen descargada no coincide.";
  case OTA_ERR_SHA256_MISMATCH: return "El SHA-256 de la imagen descargada no coincide.";
  case OTA_ERR_NO_OTA_PARTITION: return "El equipo no tiene una partición OTA disponible.";
  case OTA_ERR_FLASH_ERROR: return "No se pudo escribir la imagen en la memoria flash.";
  case OTA_ERR_NO_MEMORY: return "El equipo no tiene memoria libre suficiente para la descarga.";
  case OTA_ERR_ROLLBACK: return "La imagen nueva no se validó y el equipo volvió a la anterior.";
  case OTA_ERR_INTERNAL: return "Error interno del equipo.";
  }
  return "Error interno del equipo.";
}

bool ota_state_is_active(ota_state_t state) {
  switch (state) {
  case OTA_ST_ACCEPTED:
  case OTA_ST_DOWNLOADING:
  case OTA_ST_VERIFYING:
  case OTA_ST_INSTALLING:
  case OTA_ST_REBOOTING: return true;
  default: return false;
  }
}

/* ------------------------------------------------------------------ */
/* small JSON writer                                                   */
/* ------------------------------------------------------------------ */

typedef struct {
  char *buf;
  size_t size;
  size_t pos;
  bool ok;
} writer_t;

static void w_init(writer_t *w, char *buf, size_t size) {
  w->buf = buf;
  w->size = size;
  w->pos = 0;
  w->ok = buf != NULL && size > 0;
}

static void w_char(writer_t *w, char c) {
  if (!w->ok) return;
  if (w->pos + 1 >= w->size) { /* keep room for the NUL */
    w->ok = false;
    return;
  }
  w->buf[w->pos++] = c;
}

static void w_raw(writer_t *w, const char *s) {
  for (; *s != '\0' && w->ok; s++) w_char(w, *s);
}

static void w_string(writer_t *w, const char *s) {
  static const char hex[] = "0123456789abcdef";
  w_char(w, '"');
  for (; *s != '\0' && w->ok; s++) {
    unsigned char c = (unsigned char)*s;
    if (c == '"' || c == '\\') {
      w_char(w, '\\');
      w_char(w, (char)c);
    } else if (c == '\n') {
      w_raw(w, "\\n");
    } else if (c == '\r') {
      w_raw(w, "\\r");
    } else if (c == '\t') {
      w_raw(w, "\\t");
    } else if (c < 0x20) {
      w_raw(w, "\\u00");
      w_char(w, hex[c >> 4]);
      w_char(w, hex[c & 15]);
    } else {
      w_char(w, (char)c);
    }
  }
  w_char(w, '"');
}

static void w_int(writer_t *w, int v) {
  char tmp[16];
  snprintf(tmp, sizeof(tmp), "%d", v);
  w_raw(w, tmp);
}

/* Terminates the buffer; returns the length, 0 on overflow. */
static size_t w_finish(writer_t *w) {
  if (!w->ok) {
    if (w->buf != NULL && w->size > 0) w->buf[0] = '\0';
    return 0;
  }
  w->buf[w->pos] = '\0';
  return w->pos;
}

/* ------------------------------------------------------------------ */
/* command                                                             */
/* ------------------------------------------------------------------ */

/* A non-empty string item shorter than `cap` (the NUL included); NULL otherwise. */
static const char *string_field(const cJSON *obj, const char *name, size_t cap) {
  const cJSON *item = cJSON_GetObjectItemCaseSensitive(obj, name);
  if (!cJSON_IsString(item) || item->valuestring == NULL) return NULL;
  size_t len = strlen(item->valuestring);
  if (len == 0 || len >= cap) return NULL;
  return item->valuestring;
}

static size_t scheme_length(const char *url) {
  static const char http[] = "http://";
  static const char https[] = "https://";
  if (strncmp(url, https, sizeof(https) - 1) == 0) return sizeof(https) - 1;
  if (strncmp(url, http, sizeof(http) - 1) == 0) return sizeof(http) - 1;
  return 0;
}

static bool url_is_valid(const char *url) {
  size_t len = strlen(url);
  size_t scheme = scheme_length(url);
  if (scheme == 0 || len <= scheme || len > OTA_URL_MAX) return false;
  if (url[scheme] == '/') return false; /* no host */
  for (size_t i = 0; i < len; i++) {
    unsigned char c = (unsigned char)url[i];
    if (c <= 0x20 || c == 0x7f) return false;
  }
  return true;
}

bool ota_url_is_https(const char *url) {
  return url != NULL && strncmp(url, "https://", 8) == 0;
}

static bool sha256_hex_is_valid(const char *s) {
  if (strlen(s) != OTA_SHA256_HEX_LEN) return false;
  for (size_t i = 0; i < OTA_SHA256_HEX_LEN; i++) {
    char c = s[i];
    if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f'))) return false;
  }
  return true;
}

ota_parse_t ota_parse_command(const char *json, ota_command_t *out) {
  if (out == NULL) return OTA_PARSE_UNREADABLE;
  memset(out, 0, sizeof(*out));
  if (json == NULL || json[0] == '\0') return OTA_PARSE_UNREADABLE;

  cJSON *root = cJSON_Parse(json);
  if (root == NULL) return OTA_PARSE_UNREADABLE;
  if (!cJSON_IsObject(root)) {
    cJSON_Delete(root);
    return OTA_PARSE_UNREADABLE;
  }

  const char *id = string_field(root, "request_id", OTA_ID_MAX);
  if (id == NULL) {
    cJSON_Delete(root);
    return OTA_PARSE_UNREADABLE;
  }
  strcpy(out->request_id, id);

  bool valid = true;

  const char *version = string_field(root, "version", OTA_VERSION_MAX);
  if (version != NULL) strcpy(out->version, version);
  else valid = false;

  const char *url = string_field(root, "url", OTA_URL_MAX + 1);
  if (url != NULL && url_is_valid(url)) strcpy(out->url, url);
  else valid = false;

  const char *sha = string_field(root, "sha256", OTA_SHA256_HEX_LEN + 2);
  if (sha != NULL && sha256_hex_is_valid(sha)) strcpy(out->sha256, sha);
  else valid = false;

  const cJSON *size = cJSON_GetObjectItemCaseSensitive(root, "size");
  if (cJSON_IsNumber(size) && size->valuedouble >= 1.0 && size->valuedouble <= (double)UINT32_MAX &&
      (double)(uint32_t)size->valuedouble == size->valuedouble) {
    out->size = (uint32_t)size->valuedouble;
  } else {
    valid = false;
  }

  const cJSON *force = cJSON_GetObjectItemCaseSensitive(root, "force");
  if (force != NULL && !cJSON_IsNull(force)) {
    if (cJSON_IsBool(force)) out->force = cJSON_IsTrue(force);
    else valid = false;
  }

  cJSON_Delete(root);
  return valid ? OTA_PARSE_OK : OTA_PARSE_INVALID;
}

/* ------------------------------------------------------------------ */
/* handled requests and the decision                                   */
/* ------------------------------------------------------------------ */

void ota_tracker_init(ota_tracker_t *t) { memset(t, 0, sizeof(*t)); }

const ota_status_t *ota_tracker_find(const ota_tracker_t *t, const char *request_id) {
  if (request_id == NULL) return NULL;
  for (int i = 0; i < t->count; i++) {
    if (strcmp(t->entries[i].request_id, request_id) == 0) return &t->entries[i];
  }
  return NULL;
}

const ota_status_t *ota_tracker_active(const ota_tracker_t *t) {
  for (int i = 0; i < t->count; i++) {
    if (ota_state_is_active(t->entries[i].state)) return &t->entries[i];
  }
  return NULL;
}

void ota_tracker_update(ota_tracker_t *t, const char *request_id, const char *target_version,
                        ota_state_t state, ota_error_t error, int progress) {
  int idx = -1;
  for (int i = 0; i < t->count; i++) {
    if (strcmp(t->entries[i].request_id, request_id) == 0) idx = i;
  }
  if (idx < 0) {
    if (t->count == OTA_TRACKER_SIZE) { /* evict the oldest request that is not in flight */
      int victim = 0;
      for (int i = 0; i < t->count; i++) {
        if (!ota_state_is_active(t->entries[i].state)) {
          victim = i;
          break;
        }
      }
      memmove(&t->entries[victim], &t->entries[victim + 1],
              sizeof(t->entries[0]) * (size_t)(t->count - victim - 1));
      t->count--;
    }
    idx = t->count++;
  }
  ota_status_t *e = &t->entries[idx];
  snprintf(e->request_id, sizeof(e->request_id), "%s", request_id);
  snprintf(e->target_version, sizeof(e->target_version), "%s", target_version != NULL ? target_version : "");
  e->state = state;
  e->error = error;
  e->progress = progress;
}

ota_decision_t ota_decide(const ota_tracker_t *t, const ota_command_t *cmd, bool valid, ota_env_t env) {
  ota_decision_t d = {.action = OTA_ACT_ACCEPT, .error = OTA_ERR_NONE};
  if (ota_tracker_find(t, cmd->request_id) != NULL) {
    d.action = OTA_ACT_REPLAY;
  } else if (ota_tracker_active(t) != NULL) {
    d.action = OTA_ACT_REJECT;
    d.error = OTA_ERR_BUSY;
  } else if (!valid) {
    d.action = OTA_ACT_REJECT;
    d.error = OTA_ERR_INVALID_COMMAND;
  } else if (env.device_busy) {
    d.action = OTA_ACT_REJECT;
    d.error = OTA_ERR_BUSY;
  } else if (env.slot_size > 0 && cmd->size > env.slot_size) {
    d.action = OTA_ACT_REJECT;
    d.error = OTA_ERR_IMAGE_TOO_LARGE;
  } else if (!cmd->force && env.running_version != NULL && strcmp(env.running_version, cmd->version) == 0) {
    d.action = OTA_ACT_REJECT;
    d.error = OTA_ERR_SAME_VERSION;
  }
  return d;
}

bool ota_memory_ok(bool https, uint32_t free_bytes, uint32_t largest_block) {
  if (https) return free_bytes >= OTA_HTTPS_MIN_FREE_HEAP && largest_block >= OTA_HTTPS_MIN_LARGEST_BLOCK;
  return free_bytes >= OTA_HTTP_MIN_FREE_HEAP && largest_block >= OTA_HTTP_MIN_LARGEST_BLOCK;
}

/* ------------------------------------------------------------------ */
/* progress                                                            */
/* ------------------------------------------------------------------ */

void ota_progress_start(ota_progress_t *p, int64_t now_ms) {
  p->last_pct = 0;
  p->last_ms = now_ms;
}

int ota_percent(uint64_t read, uint32_t total) {
  if (total == 0) return 0;
  if (read >= total) return 100;
  return (int)((read * 100u) / total);
}

bool ota_progress_should_publish(ota_progress_t *p, int pct, int64_t now_ms) {
  if (pct <= p->last_pct) return false;
  if (pct >= p->last_pct + OTA_PROGRESS_STEP_PCT || now_ms - p->last_ms >= OTA_PROGRESS_INTERVAL_MS) {
    p->last_pct = pct;
    p->last_ms = now_ms;
    return true;
  }
  return false;
}

/* ------------------------------------------------------------------ */
/* ota/status                                                          */
/* ------------------------------------------------------------------ */

size_t ota_build_status(char *buf, size_t size, const ota_status_t *status, const char *running_version) {
  writer_t w;
  w_init(&w, buf, size);
  w_raw(&w, "{\"request_id\":");
  w_string(&w, status->request_id);
  w_raw(&w, ",\"state\":");
  w_string(&w, ota_state_name(status->state));
  if (status->state == OTA_ST_DOWNLOADING && status->progress >= 0) {
    w_raw(&w, ",\"progress\":");
    w_int(&w, status->progress > 100 ? 100 : status->progress);
  }
  if ((status->state == OTA_ST_REJECTED || status->state == OTA_ST_FAILED ||
       status->state == OTA_ST_ROLLED_BACK) &&
      status->error != OTA_ERR_NONE) {
    w_raw(&w, ",\"error\":{\"code\":");
    w_string(&w, ota_error_code(status->error));
    w_raw(&w, ",\"message\":");
    w_string(&w, ota_error_message(status->error));
    w_char(&w, '}');
  }
  w_raw(&w, ",\"running_version\":");
  w_string(&w, running_version != NULL ? running_version : "");
  w_raw(&w, ",\"target_version\":");
  w_string(&w, status->target_version);
  w_char(&w, '}');
  return w_finish(&w);
}

/* ------------------------------------------------------------------ */
/* image verification                                                  */
/* ------------------------------------------------------------------ */

void ota_hex_from_digest(const uint8_t digest[32], char out[OTA_SHA256_HEX_LEN + 1]) {
  static const char hex[] = "0123456789abcdef";
  for (int i = 0; i < 32; i++) {
    out[2 * i] = hex[digest[i] >> 4];
    out[2 * i + 1] = hex[digest[i] & 15];
  }
  out[OTA_SHA256_HEX_LEN] = '\0';
}

ota_error_t ota_verify_image(uint64_t received, uint32_t expected_size, const char *digest_hex,
                             const char *expected_hex) {
  if (received != expected_size) return OTA_ERR_SIZE_MISMATCH;
  if (digest_hex == NULL || expected_hex == NULL || strcmp(digest_hex, expected_hex) != 0) {
    return OTA_ERR_SHA256_MISMATCH;
  }
  return OTA_ERR_NONE;
}

/* ------------------------------------------------------------------ */
/* marker                                                              */
/* ------------------------------------------------------------------ */

size_t ota_marker_serialize(const ota_marker_t *m, char *buf, size_t size) {
  writer_t w;
  w_init(&w, buf, size);
  w_raw(&w, "{\"request_id\":");
  w_string(&w, m->request_id);
  w_raw(&w, ",\"target_version\":");
  w_string(&w, m->target_version);
  w_raw(&w, ",\"previous_version\":");
  w_string(&w, m->previous_version);
  w_raw(&w, ",\"target_slot\":");
  w_int(&w, m->target_slot);
  w_char(&w, '}');
  return w_finish(&w);
}

bool ota_marker_parse(const char *json, ota_marker_t *out) {
  if (json == NULL || json[0] == '\0' || out == NULL) return false;
  cJSON *root = cJSON_Parse(json);
  if (root == NULL) return false;
  bool ok = false;
  const char *id = string_field(root, "request_id", OTA_ID_MAX);
  const char *target = string_field(root, "target_version", OTA_VERSION_MAX);
  const char *previous = string_field(root, "previous_version", OTA_VERSION_MAX);
  const cJSON *slot = cJSON_GetObjectItemCaseSensitive(root, "target_slot");
  if (id != NULL && target != NULL && previous != NULL && cJSON_IsNumber(slot) &&
      (slot->valuedouble == 0.0 || slot->valuedouble == 1.0)) {
    memset(out, 0, sizeof(*out));
    strcpy(out->request_id, id);
    strcpy(out->target_version, target);
    strcpy(out->previous_version, previous);
    out->target_slot = (int)slot->valuedouble;
    ok = true;
  }
  cJSON_Delete(root);
  return ok;
}

/* ------------------------------------------------------------------ */
/* boot                                                                */
/* ------------------------------------------------------------------ */

ota_boot_plan_t ota_boot_decide(const ota_marker_t *marker, const char *running_version, int running_slot,
                                ota_img_state_t img) {
  ota_boot_plan_t p = {.validate = false,
                       .report = false,
                       .state = OTA_ST_SUCCEEDED,
                       .error = OTA_ERR_NONE,
                       .clear_marker = false};
  /* Whatever image is pending must be validated or the next reboot rolls it back. */
  p.validate = (img == OTA_IMG_PENDING_VERIFY || img == OTA_IMG_NEW);
  if (marker == NULL) return p;

  if (running_slot == marker->target_slot) { /* the new image runs */
    p.report = true;
    if (running_version != NULL && strcmp(running_version, marker->target_version) == 0) {
      p.state = OTA_ST_SUCCEEDED;
    } else { /* the image installed is not what the command promised */
      p.state = OTA_ST_FAILED;
      p.error = OTA_ERR_INTERNAL;
    }
  } else if (running_version != NULL && strcmp(running_version, marker->previous_version) == 0) {
    p.report = true; /* the previous image runs again: the bootloader rolled back */
    p.state = OTA_ST_ROLLED_BACK;
    p.error = OTA_ERR_ROLLBACK;
  } else {
    p.clear_marker = true; /* stale (reflashed by cable): drop it */
  }
  return p;
}

ota_validation_t ota_validation_step(bool wifi_connected, bool mqtt_connected, int64_t elapsed_s) {
  if (elapsed_s >= OTA_VALIDATE_TIMEOUT_S) return OTA_VALIDATION_ROLLBACK;
  if (wifi_connected && mqtt_connected) return OTA_VALIDATION_OK;
  return OTA_VALIDATION_WAIT;
}
