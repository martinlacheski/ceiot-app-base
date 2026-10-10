/*
 * ota_manager.h
 *
 * Over-the-air update client. The rules are pure and host-tested
 * (ota_logic.c); this module is the ESP-IDF glue. Contract:
 * tools/emulador-dispositivo.py and backend/app/api/device/firmware/.
 *
 *   backend -> device   iot/devices/{serial}/ota/command   (QoS 1, not retained)
 *   device -> backend   iot/devices/{serial}/ota/status    (QoS 1, not retained)
 *
 * - mqtt_manager subscribes ota/command on every (re)connection, reassembles
 *   the payload and calls ota_manager_handle_command(): validate, decide
 *   (accept / reject / replay), publish the status, and on accept start one
 *   download task.
 * - The task streams the image with esp_http_client (plain http on the LAN,
 *   or https with the certificate bundle; redirects refused) straight into the
 *   next OTA partition while computing its SHA-256, checks the length and the
 *   digest, persists {request_id, target_version, previous_version, slot} in
 *   NVS, sets the boot partition and reboots.
 * - After the reboot, ota_manager_init() reads the marker: a new image in
 *   PENDING_VERIFY is marked valid once Wi-Fi and MQTT are up (180 s limit,
 *   else rollback); the final `succeeded` / `rolled_back` status is published
 *   once connected and only then the marker is cleared.
 *
 * Ported from DVEM-App devices/esp-idf-guition-1r1p/main/ota/ota_manager.c
 * without the screens, the sale manager and the PSRAM task allocation (this
 * board has no PSRAM: every task stack and buffer is internal RAM).
 *
 * Threading: handle_command() and on_connected() run in the MQTT task; the
 * download and the validation run in their own tasks.
 */

#ifndef OTA_MANAGER_H
#define OTA_MANAGER_H

#include "esp_err.h"
#include "ota_logic.h"
#include "ota_remote.h"
#include <stdbool.h>
#include <stddef.h>

/**
 * Reads the running version, the persisted marker and the running image state,
 * decides what the boot requires (validate / report) and starts the validation
 * task when needed. `serial` builds the status topic; "" leaves the status
 * unpublishable (an image that cannot reach the broker rolls back). Call once,
 * before mqtt_manager_start().
 */
esp_err_t ota_manager_init(const char *serial);

/* Status topic identity after the serial changes at runtime (MQTT reload). */
void ota_manager_set_serial(const char *serial);

/** One complete ota/command payload (NUL terminated). MQTT task only. */
void ota_manager_handle_command(const char *payload);

/** After each MQTT (re)connect: re-sends an unsent status and the final report of the last update. */
void ota_manager_on_connected(void);

/* ------------------------------------------------------------------ */
/* Updates started from the device (local web UI, "Firmware" page)     */
/* ------------------------------------------------------------------ */
/*
 *   device -> backend   iot/devices/{serial}/ota/check     {"request_id","running_version"}
 *   backend -> device   iot/devices/{serial}/ota/available {"request_id","version"|null,"size"?,"error"?}
 *   device -> backend   iot/devices/{serial}/ota/request   {"request_id","version","running_version"}
 *   backend -> device   iot/devices/{serial}/ota/command   (accepted request: the ordinary update)
 *
 * mqtt_manager subscribes ota/available on every (re)connection and hands it
 * to ota_manager_handle_available(). "Switch to the other slot" is local
 * only (the backend has no such operation): see ota_manager_switch_slot().
 */

typedef enum {
  OTA_LOCAL_OK = 0,
  OTA_LOCAL_OFFLINE, /* MQTT not connected (or no serial) */
  OTA_LOCAL_BUSY,    /* a question or an update in flight, or the new image still validating */
  OTA_LOCAL_NOTHING, /* nothing to request / no valid image in the other slot */
  OTA_LOCAL_FAILED   /* the publish or the flash operation failed */
} ota_local_result_t;

typedef struct {
  char running_version[OTA_VERSION_MAX];
  char running_label[17];
  int running_slot;
  bool validation_pending; /* running image still PENDING_VERIFY */
  bool mqtt_connected;
  ota_prev_candidate_t other; /* the slot the next update overwrites */
  char other_label[17];
  ota_prev_reason_t other_reason;
  ota_remote_t remote;       /* last check / request */
  bool has_active;           /* an update is in flight */
  ota_status_t active;
  bool has_last;             /* the most recent update handled since boot */
  ota_status_t last;
} ota_local_view_t;

/** Snapshot for the web UI (also advances the question's timeout). */
void ota_manager_get_local_view(ota_local_view_t *out);

/** Publishes ota/check. The answer arrives on ota/available. */
ota_local_result_t ota_manager_check(void);

/** Publishes ota/request for the release offered by the last check. */
ota_local_result_t ota_manager_request(void);

/** One complete ota/available payload (NUL terminated). MQTT task only. */
void ota_manager_handle_available(const char *payload);

/**
 * Makes the other OTA slot the boot partition when it holds a valid image of
 * another version (esp_ota_set_boot_partition verifies it first). A marker
 * with an OTA_SWITCH_PREFIX request id is stored first, so the usual boot
 * rules apply: the switched-to image must reach Wi-Fi + MQTT within 180 s or
 * the bootloader goes back to the current one. The caller restarts the
 * device after answering; `version` (nullable) gets the target version.
 */
ota_local_result_t ota_manager_switch_slot(char *version, size_t size);

#endif /* OTA_MANAGER_H */
