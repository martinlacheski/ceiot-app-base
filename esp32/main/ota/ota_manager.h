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

#endif /* OTA_MANAGER_H */
