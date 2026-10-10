/*
 * ota_logic.h
 *
 * Pure rules of the OTA client. Contract: tools/emulador-dispositivo.py and
 * backend/app/api/device/firmware/ (service.py builds the command, status.py
 * validates the status). Ported from DVEM-App
 * devices/esp-idf-guition-1r1p/main/ota/ota_logic.h without the device-screen
 * texts and the sale-related rules; plain http is accepted (LAN development:
 * the command arrives over mTLS MQTT and carries the image SHA-256).
 *
 * Command validation, accept / reject / replay decision, the bounded record of
 * handled requests (QoS 1 redelivery), progress throttling, the ota/status
 * payload, the persisted marker and what the device must do after the reboot.
 * No ESP-IDF, no I/O: host-tested (esp32/tests/test_ota_logic.c). The glue
 * (ota_manager.c) owns MQTT, HTTP, flash and the FreeRTOS tasks.
 */

#ifndef OTA_LOGIC_H
#define OTA_LOGIC_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#define OTA_ID_MAX 65         /* request_id: 1..64 chars (backend / emulator), plus the NUL */
#define OTA_VERSION_MAX 33    /* esp_app_desc_t.version is char[32]: 1..32 chars, plus the NUL */
#define OTA_URL_MAX 1024      /* longest accepted url, without the NUL */
#define OTA_SHA256_HEX_LEN 64 /* lowercase hex of a SHA-256 */
#define OTA_COMMAND_MAX 2048  /* largest ota/command payload the device reassembles */

#define OTA_PROGRESS_STEP_PCT 10      /* a progress status at least every 10 %... */
#define OTA_PROGRESS_INTERVAL_MS 5000 /* ...or every 5 s with some advance */
#define OTA_VALIDATE_TIMEOUT_S 180    /* PENDING_VERIFY image: validate within this many seconds of boot */
#define OTA_TRACKER_SIZE 4            /* handled requests remembered for QoS 1 redelivery */
#define OTA_MARKER_SERIALIZED_MAX 320
#define OTA_STATUS_MAX 512 /* a serialized ota/status payload always fits */

/*
 * Heap budget checked before the download task starts (internal RAM: the
 * classic ESP32 has no PSRAM). The MQTT mTLS session stays up during the
 * download. Plain http: download task stack (6 KB) + 4 KB chunk + HTTP
 * buffers (~3.5 KB) + lwIP receive window, with margin for the rest of the
 * firmware. https adds a second mbedTLS session: handshake peak ~35-40 KB and
 * an input record buffer of up to 16 KB (CONFIG_MBEDTLS_SSL_IN_CONTENT_LEN,
 * allocated on demand by CONFIG_MBEDTLS_DYNAMIC_BUFFER), plus a 10 KB stack.
 */
#define OTA_HTTP_MIN_FREE_HEAP (32u * 1024u)
#define OTA_HTTP_MIN_LARGEST_BLOCK (12u * 1024u)
#define OTA_HTTPS_MIN_FREE_HEAP (64u * 1024u)
#define OTA_HTTPS_MIN_LARGEST_BLOCK (24u * 1024u)

typedef enum {
  OTA_ST_ACCEPTED = 0,
  OTA_ST_REJECTED,
  OTA_ST_DOWNLOADING,
  OTA_ST_VERIFYING,
  OTA_ST_INSTALLING,
  OTA_ST_REBOOTING,
  OTA_ST_SUCCEEDED,
  OTA_ST_FAILED,
  OTA_ST_ROLLED_BACK
} ota_state_t;

typedef enum {
  OTA_ERR_NONE = 0,
  OTA_ERR_BUSY,
  OTA_ERR_SAME_VERSION,
  OTA_ERR_INVALID_COMMAND,
  OTA_ERR_IMAGE_TOO_LARGE, /* size > the OTA slot of this device (esp32/partitions.csv) */
  OTA_ERR_DOWNLOAD_FAILED,
  OTA_ERR_TLS_ERROR,
  OTA_ERR_SIZE_MISMATCH,
  OTA_ERR_SHA256_MISMATCH,
  OTA_ERR_NO_OTA_PARTITION,
  OTA_ERR_FLASH_ERROR,
  OTA_ERR_NO_MEMORY, /* not enough internal RAM to download next to MQTT */
  OTA_ERR_ROLLBACK,
  OTA_ERR_INTERNAL /* keep last */
} ota_error_t;

const char *ota_state_name(ota_state_t state);
/** The `error.code` string of the contract ("" for OTA_ERR_NONE). */
const char *ota_error_code(ota_error_t error);
/** A short Spanish description for `error.message` (shown to the administrator). */
const char *ota_error_message(ota_error_t error);
/** accepted .. rebooting: an update is in flight. */
bool ota_state_is_active(ota_state_t state);

/* ---- command ---- */

typedef struct {
  char request_id[OTA_ID_MAX];
  char version[OTA_VERSION_MAX];
  char url[OTA_URL_MAX + 1];
  char sha256[OTA_SHA256_HEX_LEN + 1];
  uint32_t size;
  bool force;
} ota_command_t;

typedef enum {
  OTA_PARSE_OK = 0,
  OTA_PARSE_UNREADABLE, /* no usable request_id: nothing can be answered, ignore */
  OTA_PARSE_INVALID     /* request_id known, a field is out of contract: rejected/invalid_command */
} ota_parse_t;

/**
 * Parses and validates an ota/command payload: url http:// or https:// with a
 * host (<= 1024 chars, no spaces), sha256 = 64 lowercase hex, size an integer
 * in 1..UINT32_MAX (the slot limit is ota_decide's), version 1..32 chars,
 * force optional boolean. On OTA_PARSE_INVALID `out->request_id` is filled and
 * `out->version` too when it was usable (else ""), so the rejection can echo them.
 */
ota_parse_t ota_parse_command(const char *json, ota_command_t *out);

/** True for an https:// url (the download then needs TLS and the certificate bundle). */
bool ota_url_is_https(const char *url);

/* ---- handled requests and the decision ---- */

/** One request's last status (also what is re-published on a QoS 1 redelivery). */
typedef struct {
  char request_id[OTA_ID_MAX];
  char target_version[OTA_VERSION_MAX];
  ota_state_t state;
  ota_error_t error;
  int progress; /* 0..100, meaningful with OTA_ST_DOWNLOADING; -1 otherwise */
} ota_status_t;

typedef struct {
  ota_status_t entries[OTA_TRACKER_SIZE]; /* oldest first */
  int count;
} ota_tracker_t;

void ota_tracker_init(ota_tracker_t *t);
const ota_status_t *ota_tracker_find(const ota_tracker_t *t, const char *request_id);
/** The request in flight (state accepted..rebooting), NULL when none. */
const ota_status_t *ota_tracker_active(const ota_tracker_t *t);
/** Creates or updates the entry of `request_id` (the oldest finished one is evicted when full). */
void ota_tracker_update(ota_tracker_t *t, const char *request_id, const char *target_version,
                        ota_state_t state, ota_error_t error, int progress);

typedef enum {
  OTA_ACT_ACCEPT = 0,
  OTA_ACT_REJECT, /* publish rejected with `error` */
  OTA_ACT_REPLAY  /* handled before: re-publish its last status, run nothing */
} ota_action_t;

typedef struct {
  ota_action_t action;
  ota_error_t error; /* OTA_ACT_REJECT only */
} ota_decision_t;

typedef struct {
  const char *running_version;
  bool device_busy;   /* the new image is still being validated after an update */
  uint32_t slot_size; /* size of the partition the image would go to; 0 = unknown */
} ota_env_t;

/**
 * In this order: a request_id already handled is replayed; another update in
 * flight -> busy; an invalid command -> invalid_command; the device busy ->
 * busy; size larger than the slot -> image_too_large; same version without
 * `force` -> same_version; otherwise accept. `valid` is the parse result.
 */
ota_decision_t ota_decide(const ota_tracker_t *t, const ota_command_t *cmd, bool valid, ota_env_t env);

/** True when the internal heap can hold the download next to the MQTT session. */
bool ota_memory_ok(bool https, uint32_t free_bytes, uint32_t largest_block);

/* ---- progress ---- */

typedef struct {
  int last_pct;
  int64_t last_ms;
} ota_progress_t;

void ota_progress_start(ota_progress_t *p, int64_t now_ms);
/** 0..100 from the bytes read so far; 0 when total is 0. */
int ota_percent(uint64_t read, uint32_t total);
/** True (and the throttle is updated) when `pct` advanced 10 points or 5 s passed with some advance. */
bool ota_progress_should_publish(ota_progress_t *p, int pct, int64_t now_ms);

/* ---- ota/status ---- */

/**
 * Serializes {"request_id","state","progress"?,"error"?,"running_version","target_version"}.
 * `progress` appears only for OTA_ST_DOWNLOADING (when >= 0), `error` only for
 * rejected / failed / rolled_back with a code. Returns the length, 0 when it does not fit.
 */
size_t ota_build_status(char *buf, size_t size, const ota_status_t *status, const char *running_version);

/* ---- image verification ---- */

/** Lowercase hex of a 32-byte digest into out[65]. */
void ota_hex_from_digest(const uint8_t digest[32], char out[OTA_SHA256_HEX_LEN + 1]);
/** OTA_ERR_NONE when the length and the SHA-256 match the command, else size / sha256 mismatch. */
ota_error_t ota_verify_image(uint64_t received, uint32_t expected_size, const char *digest_hex,
                             const char *expected_hex);

/* ---- persisted marker and the boot after an update ---- */

typedef struct {
  char request_id[OTA_ID_MAX];
  char target_version[OTA_VERSION_MAX];
  char previous_version[OTA_VERSION_MAX];
  int target_slot; /* 0 = ota_0, 1 = ota_1: the partition the new image was written to */
} ota_marker_t;

/** Returns the length, 0 on failure. */
size_t ota_marker_serialize(const ota_marker_t *m, char *buf, size_t size);
bool ota_marker_parse(const char *json, ota_marker_t *out);

typedef enum {
  OTA_IMG_UNDEFINED = 0,
  OTA_IMG_VALID,
  OTA_IMG_PENDING_VERIFY,
  OTA_IMG_NEW,
  OTA_IMG_INVALID
} ota_img_state_t;

typedef struct {
  bool validate;     /* mark the running image valid once the conditions hold (or roll back) */
  bool report;       /* publish `state` / `error` for the marker's request, after validating */
  ota_state_t state; /* succeeded | rolled_back | failed */
  ota_error_t error;
  bool clear_marker; /* the marker is stale: drop it with no report (else it goes after the report) */
} ota_boot_plan_t;

/**
 * What to do at boot. `marker` is NULL when none is stored; `running_slot` is
 * the OTA slot index of the running partition. The image in the marker's slot
 * -> validate (when pending) and report succeeded (failed/internal when its
 * version is not the target); another slot running the previous version ->
 * the bootloader rolled back: report rolled_back/rollback; anything else is a
 * stale marker (reflashed by cable) and is dropped. Without a marker a
 * PENDING_VERIFY image is still validated.
 */
ota_boot_plan_t ota_boot_decide(const ota_marker_t *marker, const char *running_version, int running_slot,
                                ota_img_state_t img);

typedef enum { OTA_VALIDATION_WAIT = 0, OTA_VALIDATION_OK, OTA_VALIDATION_ROLLBACK } ota_validation_t;

/**
 * OK as soon as Wi-Fi and MQTT are both up before OTA_VALIDATE_TIMEOUT_S;
 * ROLLBACK once that many seconds of boot passed without it; WAIT otherwise.
 */
ota_validation_t ota_validation_step(bool wifi_connected, bool mqtt_connected, int64_t elapsed_s);

#endif /* OTA_LOGIC_H */
