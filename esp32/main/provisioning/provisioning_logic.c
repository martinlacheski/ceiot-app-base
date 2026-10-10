/*
 * provisioning_logic.c - see provisioning_logic.h. Pure C99 + cJSON.
 */
#include "provisioning_logic.h"

#include <ctype.h>
#include <math.h>
#include <stdio.h>
#include <string.h>

#include "cJSON.h"
#include "sensor_logic.h"

#define SERIAL_LEN 13 /* IOT-XXXX-XXXX */

bool prov_serial_is_valid(const char *serial) {
  if (serial == NULL || strlen(serial) != SERIAL_LEN) return false;
  if (strncmp(serial, "IOT-", 4) != 0 || serial[8] != '-') return false;
  for (size_t i = 4; i < SERIAL_LEN; i++) {
    if (i == 8) continue;
    unsigned char c = (unsigned char)serial[i];
    bool ascii_alnum = (c >= '0' && c <= '9') || (c >= 'A' && c <= 'Z') ||
                       (c >= 'a' && c <= 'z');
    if (!ascii_alnum) return false;
  }
  return true;
}

bool prov_parse_serial_text(const char *text, size_t len, char *out, size_t size) {
  if (out == NULL || size == 0) return false;
  out[0] = '\0';
  if (text == NULL) return false;

  size_t start = 0;
  while (start < len && isspace((unsigned char)text[start])) start++;
  size_t end = len;
  while (end > start && isspace((unsigned char)text[end - 1])) end--;

  size_t n = end - start;
  if (n == 0 || n >= size || n >= PROV_SERIAL_MAX) return false;
  memcpy(out, text + start, n);
  out[n] = '\0';
  if (!prov_serial_is_valid(out)) {
    out[0] = '\0';
    return false;
  }
  return true;
}

static bool parse_host(const cJSON *item, char *out, size_t size) {
  if (!cJSON_IsString(item) || item->valuestring == NULL) return false;
  const char *s = item->valuestring;
  size_t len = strlen(s);
  size_t start = 0;
  while (start < len && isspace((unsigned char)s[start])) start++;
  while (len > start && isspace((unsigned char)s[len - 1])) len--;
  size_t n = len - start;
  if (n == 0 || n >= size) return false;
  memcpy(out, s + start, n);
  out[n] = '\0';
  return true;
}

static bool parse_port(const cJSON *item, char *out, size_t size) {
  long port = 0;
  if (cJSON_IsNumber(item)) {
    double v = item->valuedouble;
    if (v != floor(v)) return false;
    port = (long)v;
  } else if (cJSON_IsString(item) && item->valuestring != NULL) {
    const char *s = item->valuestring;
    if (s[0] == '\0' || strlen(s) > 5) return false;
    for (const char *p = s; *p; p++) {
      if (!isdigit((unsigned char)*p)) return false;
      port = port * 10 + (*p - '0');
    }
  } else {
    return false;
  }
  if (port < 1 || port > 65535) return false;
  snprintf(out, size, "%ld", port);
  return true;
}

static bool equals_ignore_case(const char *a, const char *b) {
  while (*a && *b) {
    if (tolower((unsigned char)*a) != tolower((unsigned char)*b)) return false;
    a++;
    b++;
  }
  return *a == *b;
}

static bool parse_tls(const cJSON *item, char *out) {
  int value = -1;
  if (cJSON_IsBool(item)) {
    value = cJSON_IsTrue(item) ? 1 : 0;
  } else if (cJSON_IsNumber(item)) {
    if (item->valuedouble == 0.0) value = 0;
    if (item->valuedouble == 1.0) value = 1;
  } else if (cJSON_IsString(item) && item->valuestring != NULL) {
    const char *s = item->valuestring;
    if (strcmp(s, "1") == 0 || equals_ignore_case(s, "true")) value = 1;
    if (strcmp(s, "0") == 0 || equals_ignore_case(s, "false")) value = 0;
  }
  if (value < 0) return false;
  out[0] = value ? '1' : '0';
  out[1] = '\0';
  return true;
}

static void parse_sensor(const cJSON *item, prov_profile_t *out) {
  out->sensor[0] = '\0';
  out->sensor_invalid = false;
  if (item == NULL) return;
  int setting = SENSOR_SETTING_AUTO;
  if (!cJSON_IsString(item) || item->valuestring == NULL ||
      !sensor_logic_parse_setting(item->valuestring, &setting)) {
    out->sensor_invalid = true;
    return;
  }
  snprintf(out->sensor, sizeof(out->sensor), "%s",
           sensor_logic_setting_key(setting));
}

bool prov_parse_profile(const char *json, prov_profile_t *out) {
  if (json == NULL || out == NULL) return false;
  cJSON *root = cJSON_Parse(json);
  if (!cJSON_IsObject(root)) {
    cJSON_Delete(root);
    return false;
  }
  prov_profile_t parsed;
  bool ok =
      parse_host(cJSON_GetObjectItemCaseSensitive(root, "mqtt_uri"), parsed.host,
                 sizeof(parsed.host)) &&
      parse_port(cJSON_GetObjectItemCaseSensitive(root, "mqtt_port"), parsed.port,
                 sizeof(parsed.port)) &&
      parse_tls(cJSON_GetObjectItemCaseSensitive(root, "mqtt_use_tls"), parsed.use_tls);
  if (ok) parse_sensor(cJSON_GetObjectItemCaseSensitive(root, "sensor"), &parsed);
  cJSON_Delete(root);
  if (ok) *out = parsed;
  return ok;
}

bool prov_cn_from_dn(const char *dn, char *out, size_t size) {
  if (out == NULL || size == 0) return false;
  out[0] = '\0';
  if (dn == NULL) return false;

  /* mbedtls_x509_dn_gets() joins the attributes with ", " and escapes a ','
   * inside a value as "\,". */
  const char *p = dn;
  while (*p) {
    if (strncmp(p, "CN=", 3) == 0 && (p == dn || p[-1] == ' ' || p[-1] == ',')) {
      const char *value = p + 3;
      size_t n = 0;
      while (value[n] != '\0' && !(value[n] == ',' && (n == 0 || value[n - 1] != '\\'))) n++;
      if (n == 0 || n >= size) return false;
      memcpy(out, value, n);
      out[n] = '\0';
      return true;
    }
    p++;
  }
  return false;
}

prov_identity_t prov_identity_check(const char *serial, bool cert_present,
                                    const char *cert_cn) {
  if (serial == NULL || serial[0] == '\0') return PROV_IDENTITY_NO_SERIAL;
  if (!cert_present) return PROV_IDENTITY_NO_CERT;
  if (cert_cn == NULL || cert_cn[0] == '\0') return PROV_IDENTITY_UNREADABLE;
  return strcmp(serial, cert_cn) == 0 ? PROV_IDENTITY_OK : PROV_IDENTITY_MISMATCH;
}

bool prov_identity_blocks_connect(prov_identity_t identity, bool use_tls) {
  if (!use_tls) return false;
  return identity == PROV_IDENTITY_MISMATCH || identity == PROV_IDENTITY_UNREADABLE;
}

const char *prov_identity_name(prov_identity_t identity) {
  switch (identity) {
  case PROV_IDENTITY_OK:
    return "ok";
  case PROV_IDENTITY_NO_SERIAL:
    return "no_serial";
  case PROV_IDENTITY_NO_CERT:
    return "no_cert";
  case PROV_IDENTITY_UNREADABLE:
    return "unreadable";
  case PROV_IDENTITY_MISMATCH:
    return "mismatch";
  }
  return "unknown";
}
