/*
 * ota_remote.h
 *
 * Pure rules of the updates started from the device itself (its local web UI,
 * "Firmware" page): the ota/check and ota/request payloads, the ota/available
 * answer, the state of the open question and the "switch to the other OTA
 * slot" offer. Contract: backend/app/api/device/firmware/service.py
 * (handle_check, handle_request, _answer) and status.py.
 *
 *   device -> backend   iot/devices/{serial}/ota/check     {"request_id","running_version"}
 *   backend -> device   iot/devices/{serial}/ota/available {"request_id","version"|null,"size"?,"error"?}
 *   device -> backend   iot/devices/{serial}/ota/request   {"request_id","version","running_version"}
 *
 * A request the backend accepts is answered with the ordinary ota/command
 * (same request_id), handled by ota_manager like an update started from the
 * platform; a refused one with ota/available carrying `error`.
 *
 * Ported from DVEM-App devices/esp-idf-guition-1r1p/main/ota/ota_remote.h
 * (payloads, ota/available, previous image) and ota_flow.h (the question
 * state), without the device-screen texts and the sale rules. No ESP-IDF, no
 * I/O: host-tested (esp32/tests/test_ota_remote.c).
 */

#ifndef OTA_REMOTE_H
#define OTA_REMOTE_H

#include "ota_logic.h"
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

/* Request id prefix of a local "switch to the other slot": the backend has no
 * attempt with that id, so the final status reported after the restart is
 * ignored there (FirmwareService.apply_status). */
#define OTA_SWITCH_PREFIX "local-switch:"
#define OTA_REMOTE_MSG_MAX 128
#define OTA_REMOTE_CODE_MAX 32
#define OTA_REMOTE_PAYLOAD_MAX 256
#define OTA_REMOTE_ANSWER_TIMEOUT_MS 20000 /* ota/available (or the ota/command) must arrive by then */

/* ---- payloads (device -> backend) ---- */

/** {"request_id","running_version"}. Returns the length, 0 when it does not fit. */
size_t ota_build_check(char *buf, size_t size, const char *request_id, const char *running_version);
/** {"request_id","version","running_version"}. Returns the length, 0 when it does not fit. */
size_t ota_build_request(char *buf, size_t size, const char *request_id, const char *version,
                         const char *running_version);
/** A uuid-v4 shaped id from 128 random bits, preceded by `prefix` (NULL or "" for none). */
bool ota_make_request_id(char *out, size_t size, const char *prefix, const uint32_t rnd[4]);

/* ---- ota/available (backend -> device) ---- */

typedef struct {
  char request_id[OTA_ID_MAX];
  bool has_version;
  char version[OTA_VERSION_MAX];
  uint32_t size;
  bool has_error;
  char error_code[OTA_REMOTE_CODE_MAX];
  char error_message[OTA_REMOTE_MSG_MAX];
} ota_available_t;

/** False when the payload is unreadable or has no request_id. `version` null/absent = none. */
bool ota_parse_available(const char *json, ota_available_t *out);

/* ---- the other OTA slot ---- */

typedef struct {
  int slot;      /* OTA slot index (0 = ota_0, 1 = ota_1); -1 when there is none */
  bool readable; /* the partition holds an app descriptor with a version */
  char version[OTA_VERSION_MAX];
  ota_img_state_t state;
} ota_prev_candidate_t;

typedef enum {
  OTA_PREV_NO_IMAGE = 0, /* no slot, or empty / unreadable */
  OTA_PREV_NOT_VALID,    /* never validated, pending, invalid or aborted */
  OTA_PREV_SAME_VERSION, /* nothing to switch to */
  OTA_PREV_OFFER
} ota_prev_reason_t;

/** Only a readable image in state VALID (or undefined) with another version is offered. */
ota_prev_reason_t ota_prev_decide(const ota_prev_candidate_t *c, const char *running_version);

/**
 * The marker persisted before switching to the other slot: the existing boot
 * rules (ota_boot_decide) then validate the image within 180 s or the
 * bootloader goes back to `running_version`, and report under `request_id`.
 */
void ota_switch_marker(ota_marker_t *m, const char *request_id, const ota_prev_candidate_t *prev,
                       const char *running_version);

/* ---- the open question (check / request) ---- */

typedef enum {
  OTA_REMOTE_IDLE = 0,
  OTA_REMOTE_CHECKING,   /* ota/check sent, waiting for ota/available */
  OTA_REMOTE_UP_TO_DATE, /* answer: no newer release */
  OTA_REMOTE_AVAILABLE,  /* answer: `version` can be requested */
  OTA_REMOTE_REQUESTING, /* ota/request sent, waiting for the ota/command (or a refusal) */
  OTA_REMOTE_UPDATING,   /* the command arrived: progress is the OTA client's status */
  OTA_REMOTE_ERROR       /* error_code / error_message say why */
} ota_remote_phase_t;

typedef struct {
  ota_remote_phase_t phase;
  char request_id[OTA_ID_MAX]; /* the open (or last) question */
  int64_t since_ms;            /* when it was sent */
  bool has_answer;             /* some question was answered (or failed) */
  int64_t answered_ms;         /* when */
  char version[OTA_VERSION_MAX]; /* release offered / requested, "" when none */
  uint32_t size;
  char error_code[OTA_REMOTE_CODE_MAX];
  char error_message[OTA_REMOTE_MSG_MAX];
} ota_remote_t;

void ota_remote_init(ota_remote_t *r);
const char *ota_remote_phase_name(ota_remote_phase_t phase);
/** CHECKING / REQUESTING / UPDATING: a question or an update is in flight. */
bool ota_remote_is_busy(const ota_remote_t *r);

/** Any phase but CHECKING / REQUESTING / UPDATING -> CHECKING. */
bool ota_remote_begin_check(ota_remote_t *r, const char *request_id, int64_t now_ms);
/** AVAILABLE -> REQUESTING for the offered release, under a new request id. */
bool ota_remote_begin_request(ota_remote_t *r, const char *request_id, int64_t now_ms);

/**
 * An ota/available arrived. True when it answers the open question. CHECKING:
 * error -> ERROR, version -> AVAILABLE, none -> UP_TO_DATE. REQUESTING: an
 * accepted request is answered by ota/command, so anything here is a refusal
 * (code "refused" when it carries no error).
 */
bool ota_remote_on_available(ota_remote_t *r, const ota_available_t *a, int64_t now_ms);

/**
 * The OTA client's last status of a request (ignored for other ids and
 * outside REQUESTING / UPDATING): accepted .. rebooting -> UPDATING;
 * rejected / failed -> ERROR with the status error.
 */
void ota_remote_on_status(ota_remote_t *r, const ota_status_t *st, int64_t now_ms);

/** CHECKING / REQUESTING older than OTA_REMOTE_ANSWER_TIMEOUT_MS -> ERROR "timeout". */
void ota_remote_step(ota_remote_t *r, int64_t now_ms);

/** A local problem (the publish failed): CHECKING / REQUESTING -> ERROR. */
void ota_remote_fail(ota_remote_t *r, const char *code, const char *message);

#endif /* OTA_REMOTE_H */
