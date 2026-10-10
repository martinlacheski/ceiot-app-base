/*
 * provisioning_logic.h
 *
 * Pure provisioning rules (no ESP-IDF, host-tested in
 * esp32/tests/test_provisioning_logic.c):
 *
 *  - the serial staged in /littlefs/serial.txt and the broker profile staged
 *    in /littlefs/provisioning.json by provisioning/provision.py, read once
 *    at boot into the NVS "factory" namespace;
 *  - the identity check: the client certificate CN must be the device serial
 *    (the broker maps the CN to the MQTT username and the ACL only allows
 *    iot/devices/<CN>/#), so a device never connects with a mismatched
 *    identity.
 */
#ifndef PROVISIONING_LOGIC_H
#define PROVISIONING_LOGIC_H

#include <stdbool.h>
#include <stddef.h>

#define PROV_SERIAL_MAX 32
#define PROV_HOST_MAX 128
#define PROV_PORT_MAX 8

/* Broker profile from provisioning.json, normalized to the NVS string form
 * of the "storage" keys mqtt_uri / mqtt_port / mqtt_use_tls. */
typedef struct {
  char host[PROV_HOST_MAX]; /* "mqtt_uri": non-empty string */
  char port[PROV_PORT_MAX]; /* "mqtt_port": 1..65535, number or digit string */
  char use_tls[2];          /* "mqtt_use_tls": "1" or "0" (bool, 0/1, "true"/"false") */
} prov_profile_t;

typedef enum {
  PROV_IDENTITY_OK = 0,      /* client certificate CN == serial */
  PROV_IDENTITY_NO_SERIAL,   /* no serial assigned yet */
  PROV_IDENTITY_NO_CERT,     /* no client certificate in /littlefs */
  PROV_IDENTITY_UNREADABLE,  /* certificate present but not parseable / no CN */
  PROV_IDENTITY_MISMATCH,    /* CN differs from the serial */
} prov_identity_t;

/* IOT-XXXX-XXXX with ASCII letters/digits in the X positions (the format the
 * web UI accepts; the backend stores it uppercase). */
bool prov_serial_is_valid(const char *serial);

/* serial.txt content (not NUL terminated, `len` bytes): surrounding
 * whitespace trimmed, then it must be a valid serial. `out` is "" on false. */
bool prov_parse_serial_text(const char *text, size_t len, char *out, size_t size);

/* provisioning.json: all three fields required and valid; `out` untouched
 * on false. */
bool prov_parse_profile(const char *json, prov_profile_t *out);

/* Extracts the CN from an mbedtls_x509_dn_gets() string such as
 * "C=AR, O=CEIoT, CN=IOT-DEM0-0001". False when there is no (non-empty) CN
 * or it does not fit `size`. */
bool prov_cn_from_dn(const char *dn, char *out, size_t size);

/* `cert_cn` is NULL when the certificate could not be parsed. */
prov_identity_t prov_identity_check(const char *serial, bool cert_present,
                                    const char *cert_cn);

/* Whether MQTT must not start: a present certificate whose CN is not the
 * serial (or cannot be read) is only presented, and therefore only blocks,
 * when TLS is on. */
bool prov_identity_blocks_connect(prov_identity_t identity, bool use_tls);

/* "ok", "no_serial", "no_cert", "unreadable", "mismatch". */
const char *prov_identity_name(prov_identity_t identity);

#endif
