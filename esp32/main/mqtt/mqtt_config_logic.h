/*
 * mqtt_config_logic.h
 *
 * Pure resolution of the broker settings from what NVS holds. A brand-new
 * device has no "storage" namespace at all: every value is then missing and
 * the defaults apply (mTLS on 8883 to MQTT_DEFAULT_HOST), so a freshly flashed
 * board with its certificates and a factory serial connects without visiting
 * the web UI. No ESP-IDF: host-tested (esp32/tests/test_mqtt_config_logic.c).
 */
#ifndef MQTT_CONFIG_LOGIC_H
#define MQTT_CONFIG_LOGIC_H

#include <stdbool.h>
#include <stddef.h>

#define MQTT_DEFAULT_HOST "192.168.1.100"
#define MQTT_DEFAULT_TLS_PORT 8883
#define MQTT_DEFAULT_TCP_PORT 1883
#define MQTT_SERIAL_MAX 32
#define MQTT_HOST_MAX 128
#define MQTT_URI_MAX 160

/* Raw NVS values; NULL (or "") when the key or the whole namespace is missing. */
typedef struct {
  const char *serial;         /* "storage"/serial (set from the web UI) */
  const char *factory_serial; /* "factory"/serial (kept across a factory reset) */
  const char *use_tls;        /* "storage"/mqtt_use_tls: "0" disables TLS, default on */
  const char *host;           /* "storage"/mqtt_uri: host, URI or host:port */
  const char *port;           /* "storage"/mqtt_port: 1..65535, default by transport */
} mqtt_config_input_t;

typedef struct {
  char client_id[MQTT_SERIAL_MAX]; /* the device serial, "" when none */
  bool has_serial;
  bool use_tls;
  char host[MQTT_HOST_MAX];
  int port;
  char uri[MQTT_URI_MAX]; /* mqtts://host or mqtt://host (the port is set apart) */
} mqtt_config_t;

void mqtt_config_resolve(const mqtt_config_input_t *in, mqtt_config_t *out);

/* Strips scheme, user info, path and a ":port" suffix (not from an IPv6
 * literal) and surrounding spaces. Always NUL terminated. */
void mqtt_config_normalize_host(const char *input, char *output, size_t size);

#endif
