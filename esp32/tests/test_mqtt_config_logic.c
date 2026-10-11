/* Host tests for main/mqtt/mqtt_config_logic.c: the broker settings a device
 * uses, including a brand-new device whose NVS has no "storage" namespace. */
#include <string.h>

#include "mqtt_config_logic.h"
#include "test_util.h"

static void test_first_boot_defaults_with_factory_serial(void) {
  /* Freshly flashed: nothing saved from the web UI, serial only in "factory". */
  mqtt_config_input_t in = {.factory_serial = "IOT-ABCD-0001"};
  mqtt_config_t c;
  mqtt_config_resolve(&in, &c);
  CHECK(c.has_serial);
  CHECK(strcmp(c.client_id, "IOT-ABCD-0001") == 0);
  CHECK(c.use_tls);
  CHECK(strcmp(c.host, MQTT_DEFAULT_HOST) == 0);
  CHECK(strcmp(c.host, "192.168.1.100") == 0);
  CHECK(c.port == MQTT_DEFAULT_TLS_PORT);
  CHECK(MQTT_DEFAULT_TLS_PORT == 8883);
  CHECK(strcmp(c.uri, "mqtts://192.168.1.100") == 0);
}

static void test_no_serial_anywhere(void) {
  mqtt_config_input_t in = {0};
  mqtt_config_t c;
  mqtt_config_resolve(&in, &c);
  CHECK(!c.has_serial);
  CHECK(c.client_id[0] == '\0');
  /* the rest still resolves, so the web UI can show what would be used */
  CHECK(c.use_tls && c.port == MQTT_DEFAULT_TLS_PORT);
  in.serial = "";
  in.factory_serial = "";
  mqtt_config_resolve(&in, &c);
  CHECK(!c.has_serial);
}

static void test_storage_serial_wins_over_factory(void) {
  mqtt_config_input_t in = {.serial = "IOT-AAAA-0001", .factory_serial = "IOT-BBBB-0002"};
  mqtt_config_t c;
  mqtt_config_resolve(&in, &c);
  CHECK(strcmp(c.client_id, "IOT-AAAA-0001") == 0);
  in.serial = "";
  mqtt_config_resolve(&in, &c);
  CHECK(strcmp(c.client_id, "IOT-BBBB-0002") == 0);
}

static void test_saved_settings(void) {
  mqtt_config_input_t in = {.serial = "IOT-AAAA-0001", .use_tls = "0", .host = "mqtt://broker.lan:1884/x",
                            .port = "1884"};
  mqtt_config_t c;
  mqtt_config_resolve(&in, &c);
  CHECK(!c.use_tls);
  CHECK(strcmp(c.host, "broker.lan") == 0);
  CHECK(c.port == 1884);
  CHECK(strcmp(c.uri, "mqtt://broker.lan") == 0);
  /* plain TCP without a saved port defaults to 1883 */
  in.port = NULL;
  mqtt_config_resolve(&in, &c);
  CHECK(c.port == 1883);
  in.use_tls = "1";
  mqtt_config_resolve(&in, &c);
  CHECK(c.use_tls && c.port == MQTT_DEFAULT_TLS_PORT);
}

static void test_bad_values_fall_back_to_defaults(void) {
  mqtt_config_input_t in = {.serial = "IOT-AAAA-0001", .host = "   ", .port = "abc"};
  mqtt_config_t c;
  mqtt_config_resolve(&in, &c);
  CHECK(strcmp(c.host, MQTT_DEFAULT_HOST) == 0);
  CHECK(c.port == MQTT_DEFAULT_TLS_PORT);
  in.port = "0";
  mqtt_config_resolve(&in, &c);
  CHECK(c.port == MQTT_DEFAULT_TLS_PORT);
  in.port = "70000";
  mqtt_config_resolve(&in, &c);
  CHECK(c.port == MQTT_DEFAULT_TLS_PORT);
  in.port = "";
  mqtt_config_resolve(&in, &c);
  CHECK(c.port == MQTT_DEFAULT_TLS_PORT);
  in.port = "65535";
  mqtt_config_resolve(&in, &c);
  CHECK(c.port == 65535);
}

static void test_normalize_host(void) {
  char out[64];
  mqtt_config_normalize_host(" mqtts://user@10.0.0.2:8883/path ", out, sizeof(out));
  CHECK(strcmp(out, "10.0.0.2") == 0);
  mqtt_config_normalize_host("broker.example.com", out, sizeof(out));
  CHECK(strcmp(out, "broker.example.com") == 0);
  mqtt_config_normalize_host("[fe80::1]:8883", out, sizeof(out));
  CHECK(strcmp(out, "[fe80::1]:8883") == 0); /* IPv6 literal left untouched */
  mqtt_config_normalize_host(NULL, out, sizeof(out));
  CHECK(out[0] == '\0');
  char tiny[5];
  mqtt_config_normalize_host("abcdefgh", tiny, sizeof(tiny));
  CHECK(strcmp(tiny, "abcd") == 0);
}

int main(void) {
  RUN(test_first_boot_defaults_with_factory_serial);
  RUN(test_no_serial_anywhere);
  RUN(test_storage_serial_wins_over_factory);
  RUN(test_saved_settings);
  RUN(test_bad_values_fall_back_to_defaults);
  RUN(test_normalize_host);
  TEST_MAIN_END();
}
