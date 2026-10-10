/* Host tests for main/provisioning/provisioning_logic.c: serial.txt and
 * provisioning.json staged by provisioning/provision.py, and the client
 * certificate CN vs serial identity check. */
#include <string.h>

#include "provisioning_logic.h"
#include "test_util.h"

static void test_serial_format(void) {
  CHECK(prov_serial_is_valid("IOT-DEM0-0001"));
  CHECK(prov_serial_is_valid("IOT-abcd-9XYZ"));
  CHECK(!prov_serial_is_valid(NULL));
  CHECK(!prov_serial_is_valid(""));
  CHECK(!prov_serial_is_valid("IOT-DEM0-001"));
  CHECK(!prov_serial_is_valid("IOT-DEM0-00011"));
  CHECK(!prov_serial_is_valid("IOX-DEM0-0001"));
  CHECK(!prov_serial_is_valid("IOT-DEM0_0001"));
  CHECK(!prov_serial_is_valid("IOT-DEM -0001"));
  CHECK(!prov_serial_is_valid("IOT-DEM0-000/"));
}

static void test_serial_text(void) {
  char out[PROV_SERIAL_MAX];
  const char *text = "IOT-DEM0-0002\n";
  CHECK(prov_parse_serial_text(text, strlen(text), out, sizeof(out)));
  CHECK(strcmp(out, "IOT-DEM0-0002") == 0);

  text = "  \r\n IOT-DEM0-0003 \r\n\t";
  CHECK(prov_parse_serial_text(text, strlen(text), out, sizeof(out)));
  CHECK(strcmp(out, "IOT-DEM0-0003") == 0);

  /* length-bounded: bytes after `len` are ignored */
  CHECK(prov_parse_serial_text("IOT-DEM0-0004GARBAGE", 13, out, sizeof(out)));
  CHECK(strcmp(out, "IOT-DEM0-0004") == 0);

  text = "\n \n";
  CHECK(!prov_parse_serial_text(text, strlen(text), out, sizeof(out)));
  CHECK(out[0] == '\0');
  text = "not a serial\n";
  CHECK(!prov_parse_serial_text(text, strlen(text), out, sizeof(out)));
  CHECK(out[0] == '\0');
  CHECK(!prov_parse_serial_text(NULL, 0, out, sizeof(out)));

  char tiny[8];
  text = "IOT-DEM0-0001";
  CHECK(!prov_parse_serial_text(text, strlen(text), tiny, sizeof(tiny)));
}

static void test_profile_strings(void) {
  prov_profile_t p;
  CHECK(prov_parse_profile(
      "{\"mqtt_uri\":\"192.168.1.100\",\"mqtt_port\":\"18883\",\"mqtt_use_tls\":\"1\"}", &p));
  CHECK(strcmp(p.host, "192.168.1.100") == 0);
  CHECK(strcmp(p.port, "18883") == 0);
  CHECK(strcmp(p.use_tls, "1") == 0);

  CHECK(prov_parse_profile(
      "{\"mqtt_uri\":\" broker.example.com \",\"mqtt_port\":\"1883\",\"mqtt_use_tls\":\"false\"}", &p));
  CHECK(strcmp(p.host, "broker.example.com") == 0);
  CHECK(strcmp(p.port, "1883") == 0);
  CHECK(strcmp(p.use_tls, "0") == 0);

  CHECK(prov_parse_profile(
      "{\"mqtt_uri\":\"h\",\"mqtt_port\":\"8883\",\"mqtt_use_tls\":\"TRUE\"}", &p));
  CHECK(strcmp(p.use_tls, "1") == 0);
}

static void test_profile_native_types(void) {
  prov_profile_t p;
  CHECK(prov_parse_profile(
      "{\"mqtt_uri\":\"192.168.1.100\",\"mqtt_port\":18883,\"mqtt_use_tls\":true}", &p));
  CHECK(strcmp(p.port, "18883") == 0);
  CHECK(strcmp(p.use_tls, "1") == 0);
  CHECK(prov_parse_profile(
      "{\"mqtt_uri\":\"h\",\"mqtt_port\":1883,\"mqtt_use_tls\":0}", &p));
  CHECK(strcmp(p.use_tls, "0") == 0);
  CHECK(prov_parse_profile(
      "{\"mqtt_uri\":\"h\",\"mqtt_port\":1883,\"mqtt_use_tls\":false}", &p));
  CHECK(strcmp(p.use_tls, "0") == 0);
}

static void test_profile_invalid_leaves_output(void) {
  prov_profile_t p;
  memset(&p, 'x', sizeof(p));
  p.host[0] = 'K';
  const char *bad[] = {
      NULL,
      "",
      "not json",
      "[]",
      "{\"mqtt_port\":\"18883\",\"mqtt_use_tls\":\"1\"}",                       /* no host */
      "{\"mqtt_uri\":\"\",\"mqtt_port\":\"18883\",\"mqtt_use_tls\":\"1\"}",     /* empty host */
      "{\"mqtt_uri\":\"  \",\"mqtt_port\":\"18883\",\"mqtt_use_tls\":\"1\"}",   /* blank host */
      "{\"mqtt_uri\":\"h\",\"mqtt_use_tls\":\"1\"}",                            /* no port */
      "{\"mqtt_uri\":\"h\",\"mqtt_port\":\"0\",\"mqtt_use_tls\":\"1\"}",
      "{\"mqtt_uri\":\"h\",\"mqtt_port\":\"65536\",\"mqtt_use_tls\":\"1\"}",
      "{\"mqtt_uri\":\"h\",\"mqtt_port\":\"18a83\",\"mqtt_use_tls\":\"1\"}",
      "{\"mqtt_uri\":\"h\",\"mqtt_port\":\"\",\"mqtt_use_tls\":\"1\"}",
      "{\"mqtt_uri\":\"h\",\"mqtt_port\":-1,\"mqtt_use_tls\":\"1\"}",
      "{\"mqtt_uri\":\"h\",\"mqtt_port\":18883.5,\"mqtt_use_tls\":\"1\"}",
      "{\"mqtt_uri\":\"h\",\"mqtt_port\":\"18883\"}",                           /* no tls */
      "{\"mqtt_uri\":\"h\",\"mqtt_port\":\"18883\",\"mqtt_use_tls\":\"maybe\"}",
      "{\"mqtt_uri\":\"h\",\"mqtt_port\":\"18883\",\"mqtt_use_tls\":2}",
      "{\"mqtt_uri\":7,\"mqtt_port\":\"18883\",\"mqtt_use_tls\":\"1\"}",
  };
  for (size_t i = 0; i < sizeof(bad) / sizeof(bad[0]); i++) {
    if (prov_parse_profile(bad[i], &p)) {
      printf("  accepted invalid profile #%u\n", (unsigned)i);
      CHECK(false);
    }
  }
  CHECK(p.host[0] == 'K');

  /* a host that does not fit is rejected, not truncated */
  char json[400];
  char host[PROV_HOST_MAX + 1];
  memset(host, 'a', sizeof(host) - 1);
  host[sizeof(host) - 1] = '\0';
  snprintf(json, sizeof(json),
           "{\"mqtt_uri\":\"%s\",\"mqtt_port\":\"1\",\"mqtt_use_tls\":\"1\"}", host);
  CHECK(!prov_parse_profile(json, &p));
  CHECK(!prov_parse_profile("{\"mqtt_uri\":\"h\",\"mqtt_port\":\"1\",\"mqtt_use_tls\":\"1\"}", NULL));
}

static void test_cn_from_dn(void) {
  char cn[PROV_SERIAL_MAX];
  CHECK(prov_cn_from_dn("CN=IOT-DEM0-0001", cn, sizeof(cn)));
  CHECK(strcmp(cn, "IOT-DEM0-0001") == 0);
  CHECK(prov_cn_from_dn("C=AR, O=CEIoT, CN=IOT-DEM0-0002", cn, sizeof(cn)));
  CHECK(strcmp(cn, "IOT-DEM0-0002") == 0);
  CHECK(prov_cn_from_dn("CN=IOT-DEM0-0003, O=CEIoT", cn, sizeof(cn)));
  CHECK(strcmp(cn, "IOT-DEM0-0003") == 0);
  /* another attribute ending in "CN" is not the CN */
  CHECK(!prov_cn_from_dn("XCN=IOT-DEM0-0004", cn, sizeof(cn)));
  CHECK(cn[0] == '\0');
  CHECK(!prov_cn_from_dn("O=CEIoT", cn, sizeof(cn)));
  CHECK(!prov_cn_from_dn("CN=", cn, sizeof(cn)));
  CHECK(!prov_cn_from_dn("", cn, sizeof(cn)));
  CHECK(!prov_cn_from_dn(NULL, cn, sizeof(cn)));
  char tiny[4];
  CHECK(!prov_cn_from_dn("CN=IOT-DEM0-0001", tiny, sizeof(tiny)));
}

static void test_identity_check(void) {
  CHECK(prov_identity_check("IOT-DEM0-0001", true, "IOT-DEM0-0001") == PROV_IDENTITY_OK);
  CHECK(prov_identity_check("IOT-DEM0-0001", true, "IOT-DEM0-0002") == PROV_IDENTITY_MISMATCH);
  /* exact match: the broker ACL is case sensitive */
  CHECK(prov_identity_check("IOT-DEM0-0001", true, "iot-dem0-0001") == PROV_IDENTITY_MISMATCH);
  CHECK(prov_identity_check("IOT-DEM0-0001", true, NULL) == PROV_IDENTITY_UNREADABLE);
  CHECK(prov_identity_check("IOT-DEM0-0001", false, NULL) == PROV_IDENTITY_NO_CERT);
  CHECK(prov_identity_check("", true, "IOT-DEM0-0001") == PROV_IDENTITY_NO_SERIAL);
  CHECK(prov_identity_check(NULL, true, "IOT-DEM0-0001") == PROV_IDENTITY_NO_SERIAL);
}

static void test_identity_decision(void) {
  CHECK(!prov_identity_blocks_connect(PROV_IDENTITY_OK, true));
  CHECK(prov_identity_blocks_connect(PROV_IDENTITY_MISMATCH, true));
  CHECK(prov_identity_blocks_connect(PROV_IDENTITY_UNREADABLE, true));
  /* plain TCP never presents the certificate */
  CHECK(!prov_identity_blocks_connect(PROV_IDENTITY_MISMATCH, false));
  CHECK(!prov_identity_blocks_connect(PROV_IDENTITY_UNREADABLE, false));
  /* missing material is reported by the TLS layer itself, not an identity clash */
  CHECK(!prov_identity_blocks_connect(PROV_IDENTITY_NO_CERT, true));
  CHECK(!prov_identity_blocks_connect(PROV_IDENTITY_NO_SERIAL, true));

  CHECK(strcmp(prov_identity_name(PROV_IDENTITY_OK), "ok") == 0);
  CHECK(strcmp(prov_identity_name(PROV_IDENTITY_MISMATCH), "mismatch") == 0);
  CHECK(strcmp(prov_identity_name(PROV_IDENTITY_NO_CERT), "no_cert") == 0);
  CHECK(strcmp(prov_identity_name(PROV_IDENTITY_NO_SERIAL), "no_serial") == 0);
  CHECK(strcmp(prov_identity_name(PROV_IDENTITY_UNREADABLE), "unreadable") == 0);
}

int main(void) {
  RUN(test_serial_format);
  RUN(test_serial_text);
  RUN(test_profile_strings);
  RUN(test_profile_native_types);
  RUN(test_profile_invalid_leaves_output);
  RUN(test_cn_from_dn);
  RUN(test_identity_check);
  RUN(test_identity_decision);
  TEST_MAIN_END();
}
