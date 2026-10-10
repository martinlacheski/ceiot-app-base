/*
 * mqtt_config_logic.c - see mqtt_config_logic.h. Pure C99.
 */
#include "mqtt_config_logic.h"

#include <ctype.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static bool is_set(const char *value) { return value != NULL && value[0] != '\0'; }

static bool is_digits_only(const char *value) {
  if (!is_set(value)) return false;
  for (const char *p = value; *p; p++) {
    if (!isdigit((unsigned char)*p)) return false;
  }
  return true;
}

static void trim(char *value) {
  size_t len = strlen(value);
  while (len > 0 && isspace((unsigned char)value[len - 1])) value[--len] = '\0';
  char *start = value;
  while (*start && isspace((unsigned char)*start)) start++;
  if (start != value) memmove(value, start, strlen(start) + 1);
}

void mqtt_config_normalize_host(const char *input, char *output, size_t size) {
  if (output == NULL || size == 0) return;
  output[0] = '\0';
  if (input == NULL) return;

  char buffer[MQTT_HOST_MAX];
  snprintf(buffer, sizeof(buffer), "%s", input);
  trim(buffer);
  const char *start = strstr(buffer, "://");
  start = start ? start + 3 : buffer;
  const char *at = strrchr(start, '@');
  if (at != NULL) start = at + 1;
  size_t length = strcspn(start, "/?#");
  if (length >= size) length = size - 1;
  memcpy(output, start, length);
  output[length] = '\0';

  if (output[0] != '[') {
    char *first = strchr(output, ':');
    char *last = strrchr(output, ':');
    if (first != NULL && first == last && is_digits_only(last + 1)) *last = '\0';
  }
  trim(output);
}

static int parse_port(const char *value) {
  if (!is_digits_only(value) || strlen(value) > 5) return 0;
  int port = atoi(value);
  return (port >= 1 && port <= 65535) ? port : 0;
}

void mqtt_config_resolve(const mqtt_config_input_t *in, mqtt_config_t *out) {
  memset(out, 0, sizeof(*out));
  const char *serial = is_set(in->serial) ? in->serial : (is_set(in->factory_serial) ? in->factory_serial : "");
  snprintf(out->client_id, sizeof(out->client_id), "%s", serial);
  out->has_serial = out->client_id[0] != '\0';

  out->use_tls = !(is_set(in->use_tls) && in->use_tls[0] == '0');

  mqtt_config_normalize_host(is_set(in->host) ? in->host : MQTT_DEFAULT_HOST, out->host, sizeof(out->host));
  if (out->host[0] == '\0') snprintf(out->host, sizeof(out->host), "%s", MQTT_DEFAULT_HOST);

  int port = parse_port(in->port);
  out->port = port > 0 ? port : (out->use_tls ? MQTT_DEFAULT_TLS_PORT : MQTT_DEFAULT_TCP_PORT);

  snprintf(out->uri, sizeof(out->uri), "%s%s", out->use_tls ? "mqtts://" : "mqtt://", out->host);
}
