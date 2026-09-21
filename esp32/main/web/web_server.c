/*
 * web_server.c
 */

#include "cJSON.h"
#include "esp_http_server.h"
#include "esp_littlefs.h"
#include "esp_log.h"
#include "esp_timer.h"
#include "esp_vfs.h"
#include "mqtt_manager.h"
#include "nvs_manager.h"
#include "cellular_manager.h"
#include "network_manager.h"
#include "wifi_manager.h"
#include <ctype.h>
#include <errno.h>
#include <fcntl.h>
#include <string.h>
#include <sys/stat.h>
#include <time.h>
#include <unistd.h>

#include "esp_mac.h"
#include "esp_random.h"
#include "nvs.h"
#include "nvs_flash.h"
#include <sys/param.h>

#include "favicon.h"
#include "web_pages.h"
#include "web_server.h"

static const char *TAG = "WEB_SERVER";
static httpd_handle_t server = NULL;

// Session management
#define SESSION_COOKIE_NAME "iot_session"
static char s_session_token[33] = {0};
static int64_t s_session_expiry = 0;

static void generate_session_token(void) {
  uint8_t random_bytes[16];
  esp_fill_random(random_bytes, 16);
  for (int i = 0; i < 16; i++) {
    sprintf(&s_session_token[i * 2], "%02x", random_bytes[i]);
  }
  // 30 min expiry
  // 30 min expiry
  s_session_expiry = esp_timer_get_time() + (30 * 60 * 1000000LL);
}

// NVS Helpers
static void read_nvs_str(const char *key, char *out_val, size_t max_len,
                         const char *default_val) {
  nvs_handle_t my_handle;
  esp_err_t err = nvs_open("storage", NVS_READONLY, &my_handle);
  if (err != ESP_OK) {
    ESP_LOGW(TAG, "NVS read open fallo key=%s err=%s", key,
             esp_err_to_name(err));
    strncpy(out_val, default_val, max_len);
    return;
  }
  size_t required_size = 0;
  err = nvs_get_str(my_handle, key, NULL, &required_size);
  if (err == ESP_OK && required_size <= max_len) {
    nvs_get_str(my_handle, key, out_val, &required_size);
  } else {
    strncpy(out_val, default_val, max_len);
  }
  nvs_close(my_handle);
}

static esp_err_t save_nvs_str(const char *key, const char *val) {
  nvs_handle_t my_handle;
  esp_err_t err = nvs_open("storage", NVS_READWRITE, &my_handle);
  if (err != ESP_OK) {
    ESP_LOGE(TAG, "NVS write open fallo key=%s err=%s", key,
             esp_err_to_name(err));
    return err;
  }
  err = nvs_set_str(my_handle, key, val);
  if (err == ESP_OK)
    err = nvs_commit(my_handle);
  if (err != ESP_OK) {
    ESP_LOGE(TAG, "NVS write fallo key=%s err=%s", key, esp_err_to_name(err));
  }
  nvs_close(my_handle);
  return err;
}

static bool is_cert_filepath(const char *filepath) {
  return strstr(filepath, "/client.crt") != NULL ||
         strstr(filepath, "/client.key") != NULL ||
         strstr(filepath, "/root.crt") != NULL;
}

static bool is_authenticated(httpd_req_t *req) {
  char buf[128];
  if (httpd_req_get_hdr_value_str(req, "Cookie", buf, sizeof(buf)) == ESP_OK) {
    char cookie_val[64];
    snprintf(cookie_val, sizeof(cookie_val), "%s=%s", SESSION_COOKIE_NAME,
             s_session_token);
    if (strstr(buf, cookie_val) != NULL) {
      if (esp_timer_get_time() < s_session_expiry) {
        // Refresh expiry
        s_session_expiry = esp_timer_get_time() + (30 * 60 * 1000000LL);
        return true;
      }
    }
    return false;
  }
  return false;
}

static bool check_credentials(const char *user, const char *pass) {
  char stored_user[32];
  char stored_pass[32];
  read_nvs_str("admin_user", stored_user, sizeof(stored_user), "admin");
  read_nvs_str("admin_pass", stored_pass, sizeof(stored_pass), "admin");
  return (strcmp(user, stored_user) == 0 && strcmp(pass, stored_pass) == 0);
}

// --- Implementación de Handlers ---

// GET /
// Helper to send common parts
static esp_err_t send_page(httpd_req_t *req, const char *view) {
  httpd_resp_set_type(req, "text/html");
  httpd_resp_send_chunk(req, HTML_HEAD, HTTPD_RESP_USE_STRLEN);
  httpd_resp_send_chunk(req, HTML_NAV, HTTPD_RESP_USE_STRLEN);
  httpd_resp_send_chunk(req, view, HTTPD_RESP_USE_STRLEN);
  httpd_resp_send_chunk(req, HTML_FOOTER_START, HTTPD_RESP_USE_STRLEN);
  httpd_resp_send_chunk(req, NULL, 0);
  return ESP_OK;
}

// GET / -> Redirect
static esp_err_t root_get_handler(httpd_req_t *req) {
  if (is_authenticated(req)) {
    httpd_resp_set_status(req, "302 Found");
    httpd_resp_set_hdr(req, "Location", "/status");
    httpd_resp_send(req, NULL, 0);
  } else {
    httpd_resp_set_status(req, "302 Found");
    httpd_resp_set_hdr(req, "Location", "/login");
    httpd_resp_send(req, NULL, 0);
  }
  return ESP_OK;
}

static const httpd_uri_t root = {.uri = "/",
                                 .method = HTTP_GET,
                                 .handler = root_get_handler,
                                 .user_ctx = NULL};

// GET /login
static esp_err_t login_page_handler(httpd_req_t *req) {
  if (is_authenticated(req)) {
    httpd_resp_set_status(req, "302 Found");
    httpd_resp_set_hdr(req, "Location", "/status");
    httpd_resp_send(req, NULL, 0);
    return ESP_OK;
  }
  httpd_resp_set_type(req, "text/html");
  httpd_resp_send_chunk(req, HTML_HEAD, HTTPD_RESP_USE_STRLEN);
  httpd_resp_send_chunk(req, HTML_LOGIN, HTTPD_RESP_USE_STRLEN);
  httpd_resp_send_chunk(req, HTML_FOOTER_START, HTTPD_RESP_USE_STRLEN);
  httpd_resp_send_chunk(req, NULL, 0);
  return ESP_OK;
}

// GET /status
static esp_err_t status_page_handler(httpd_req_t *req) {
  if (!is_authenticated(req)) {
    httpd_resp_set_status(req, "302 Found");
    httpd_resp_set_hdr(req, "Location", "/login");
    httpd_resp_send(req, NULL, 0);
    return ESP_OK;
  }
  return send_page(req, VIEW_STATUS);
}

// GET /wifi
static esp_err_t wifi_page_handler(httpd_req_t *req) {
  if (!is_authenticated(req)) {
    httpd_resp_set_status(req, "302 Found");
    httpd_resp_set_hdr(req, "Location", "/login");
    httpd_resp_send(req, NULL, 0);
    return ESP_OK;
  }
  return send_page(req, VIEW_WIFI);
}

// GET /mqtt
static esp_err_t mqtt_page_handler(httpd_req_t *req) {
  if (!is_authenticated(req)) {
    httpd_resp_set_status(req, "302 Found");
    httpd_resp_set_hdr(req, "Location", "/login");
    httpd_resp_send(req, NULL, 0);
    return ESP_OK;
  }
  return send_page(req, VIEW_MQTT);
}

// GET /device
static esp_err_t device_page_handler(httpd_req_t *req) {
  if (!is_authenticated(req)) {
    httpd_resp_set_status(req, "302 Found");
    httpd_resp_set_hdr(req, "Location", "/login");
    httpd_resp_send(req, NULL, 0);
    return ESP_OK;
  }
  return send_page(req, VIEW_DEVICE);
}

// GET /password
static esp_err_t password_page_handler(httpd_req_t *req) {
  if (!is_authenticated(req)) {
    httpd_resp_set_status(req, "302 Found");
    httpd_resp_set_hdr(req, "Location", "/login");
    httpd_resp_send(req, NULL, 0);
    return ESP_OK;
  }
  return send_page(req, VIEW_PASSWORD);
}

static const httpd_uri_t page_login = {.uri = "/login",
                                       .method = HTTP_GET,
                                       .handler = login_page_handler,
                                       .user_ctx = NULL};
static const httpd_uri_t page_status = {.uri = "/status",
                                        .method = HTTP_GET,
                                        .handler = status_page_handler,
                                        .user_ctx = NULL};
static const httpd_uri_t page_wifi = {.uri = "/wifi",
                                      .method = HTTP_GET,
                                      .handler = wifi_page_handler,
                                      .user_ctx = NULL};
static const httpd_uri_t page_mqtt = {.uri = "/mqtt",
                                      .method = HTTP_GET,
                                      .handler = mqtt_page_handler,
                                      .user_ctx = NULL};
static const httpd_uri_t page_device = {.uri = "/device",
                                        .method = HTTP_GET,
                                        .handler = device_page_handler,
                                        .user_ctx = NULL};
static const httpd_uri_t page_password = {.uri = "/password",
                                          .method = HTTP_GET,
                                          .handler = password_page_handler,
                                          .user_ctx = NULL};

// GET /favicon.ico (SVG)
static esp_err_t favicon_get_handler(httpd_req_t *req) {
  httpd_resp_set_type(req, "image/svg+xml");
  httpd_resp_send(req, FAVICON_SVG, HTTPD_RESP_USE_STRLEN);
  return ESP_OK;
}

static const httpd_uri_t favicon = {.uri = "/favicon.ico",
                                    .method = HTTP_GET,
                                    .handler = favicon_get_handler,
                                    .user_ctx = NULL};

// GET /api/status (JSON)
static esp_err_t api_status_get_handler(httpd_req_t *req) {
  if (!is_authenticated(req)) {
    httpd_resp_send_err(req, HTTPD_401_UNAUTHORIZED, "Unauthorized");
    return ESP_OK;
  }
  httpd_resp_set_type(req, "application/json");

  // Load Configs
  char serial[32];
  read_nvs_str("serial", serial, sizeof(serial), "");

  char mqtt_uri[128];
  read_nvs_str("mqtt_uri", mqtt_uri, sizeof(mqtt_uri), "192.168.1.100");
  char mqtt_port[8];
  read_nvs_str("mqtt_port", mqtt_port, sizeof(mqtt_port), "1883");
  char mqtt_use_tls[2];
  read_nvs_str("mqtt_use_tls", mqtt_use_tls, sizeof(mqtt_use_tls), "1");

  // Load QoS values
  char mqtt_qos_pub_telemetry[2], mqtt_qos_sub[2];
  read_nvs_str("mqtt_qos_pub_telemetry", mqtt_qos_pub_telemetry,
               sizeof(mqtt_qos_pub_telemetry), "0");
  read_nvs_str("mqtt_qos_sub", mqtt_qos_sub, sizeof(mqtt_qos_sub), "1");

  cJSON *root = cJSON_CreateObject();
  cJSON_AddStringToObject(root, "status", "ok");
  cJSON_AddStringToObject(root, "device", "IOT-ESP32S3");
  cJSON_AddNumberToObject(root, "uptime",
                          (double)esp_timer_get_time() / 1000000.0);
  cJSON_AddNumberToObject(root, "heap_free", esp_get_free_heap_size());

  time_t now;
  struct tm timeinfo;
  char iso_time[32] = "";
  time(&now);
  localtime_r(&now, &timeinfo);
  if (strftime(iso_time, sizeof(iso_time), "%Y-%m-%dT%H:%M:%S", &timeinfo) == 0) {
    iso_time[0] = '\0';
  }
  cJSON *time_obj = cJSON_CreateObject();
  cJSON_AddBoolToObject(time_obj, "synced", network_manager_is_time_synced());
  cJSON_AddNumberToObject(time_obj, "epoch", (double)now);
  cJSON_AddStringToObject(time_obj, "iso_local", iso_time);
  cJSON_AddItemToObject(root, "time", time_obj);

  // WiFi Info
  char *wifi_json = wifi_manager_get_status_json();
  if (wifi_json) {
    cJSON *wifi_obj = cJSON_Parse(wifi_json);
    if (wifi_obj) {
      // Add saved config info if not connected (or even if connected for
      // reference)
      char saved_ssid[32];
      if (wifi_manager_get_saved_config(saved_ssid, sizeof(saved_ssid)) ==
          ESP_OK) {
        cJSON_AddStringToObject(wifi_obj, "saved_ssid", saved_ssid);
      }
      cJSON_AddStringToObject(wifi_obj, "last_error",
                              wifi_manager_get_last_error());
      cJSON_AddItemToObject(root, "wifi", wifi_obj);
    }
    free(wifi_json);
  }

  // MQTT Status
  cJSON *mqtt = cJSON_CreateObject();
  mqtt_status_snapshot_t mqtt_snapshot;
  if (mqtt_manager_get_status_snapshot(&mqtt_snapshot) == ESP_OK) {
    cJSON_AddBoolToObject(mqtt, "connected", mqtt_snapshot.connected);
    cJSON_AddBoolToObject(mqtt, "client_initialized",
                          mqtt_snapshot.client_initialized);
    cJSON_AddBoolToObject(mqtt, "start_task_running",
                          mqtt_snapshot.start_task_running);
    cJSON_AddBoolToObject(mqtt, "network_ready", mqtt_snapshot.network_ready);
    cJSON_AddBoolToObject(mqtt, "time_ready", mqtt_snapshot.time_ready);
    cJSON_AddStringToObject(mqtt, "last_event", mqtt_snapshot.last_event);
    cJSON_AddStringToObject(mqtt, "last_error", mqtt_snapshot.last_error);
    cJSON_AddNumberToObject(mqtt, "last_error_type",
                            mqtt_snapshot.last_error_type);
    cJSON_AddNumberToObject(mqtt, "transport_sock_errno",
                            mqtt_snapshot.transport_sock_errno);
    cJSON_AddNumberToObject(mqtt, "tls_stack_err",
                            mqtt_snapshot.tls_stack_err);
    cJSON_AddNumberToObject(mqtt, "esp_tls_last_err",
                            mqtt_snapshot.esp_tls_last_err);
  } else {
    cJSON_AddBoolToObject(mqtt, "connected", mqtt_manager_is_connected());
  }
  cJSON_AddStringToObject(mqtt, "broker", mqtt_uri);
  cJSON_AddBoolToObject(mqtt, "use_tls", mqtt_use_tls[0] == '1');
  cJSON_AddItemToObject(root, "mqtt", mqtt);

  // Cellular Status
  char *cell_json = cellular_manager_get_status_json();
  if (cell_json) {
    cJSON *cell_obj = cJSON_Parse(cell_json);
    if (cell_obj) {
      cJSON_AddItemToObject(root, "cellular", cell_obj);
    }
    free(cell_json);
  }

  // Network Manager Status
  char *net_json = network_manager_get_status_json();
  if (net_json) {
    cJSON *net_obj = cJSON_Parse(net_json);
    if (net_obj) {
      cJSON_AddItemToObject(root, "network", net_obj);
    }
    free(net_json);
  }

  bool mqtt_test_pending = false;
  bool mqtt_test_success = false;
  int mqtt_test_elapsed_ms = 0;
  mqtt_manager_get_test_status(&mqtt_test_pending, &mqtt_test_success,
                               &mqtt_test_elapsed_ms);
  cJSON *mqtt_test = cJSON_CreateObject();
  cJSON_AddBoolToObject(mqtt_test, "pending", mqtt_test_pending);
  cJSON_AddBoolToObject(mqtt_test, "success", mqtt_test_success);
  cJSON_AddNumberToObject(mqtt_test, "elapsed_ms", mqtt_test_elapsed_ms);
  cJSON_AddItemToObject(root, "mqtt_test", mqtt_test);

  // Config (Flat for backward compatibility with existing JS, or properly
  // nested?) Existing JS uses data.serial, etc. so keep flat if
  // possible, OR update JS. User requested "Resto de informacion relevante...
  // modo resumen". I will keep the flat keys for config to avoid breaking
  // existing JS populators excessively, but the new dashboard in JS can look
  // at 'wifi' object.
  cJSON_AddStringToObject(root, "serial", serial);
  cJSON_AddStringToObject(root, "mqtt_uri", mqtt_uri);
  cJSON_AddStringToObject(root, "mqtt_port", mqtt_port);
  network_status_snapshot_t network_snapshot;
  if (network_manager_get_status_snapshot(&network_snapshot) == ESP_OK) {
    cJSON_AddStringToObject(root, "network_mode",
                            network_manager_mode_to_str(network_snapshot.mode));
    cJSON_AddStringToObject(
        root, "network_preferred",
        network_manager_link_to_str(network_snapshot.preferred_link));
    cJSON_AddStringToObject(root, "network_active",
                            network_manager_link_to_str(
                                network_snapshot.active_link));
    cJSON_AddBoolToObject(root, "network_fallback",
                          network_snapshot.fallback_in_use);
    cJSON_AddStringToObject(root, "network_reason",
                            network_snapshot.decision_reason);
    cJSON_AddBoolToObject(root, "time_synced", network_snapshot.time_synced);
  } else {
    cJSON_AddStringToObject(root, "network_mode",
                            network_manager_mode_to_str(
                                network_manager_get_mode()));
    cJSON_AddStringToObject(root, "network_active",
                            network_manager_link_to_str(
                                network_manager_get_active_link()));
  }
  cJSON_AddBoolToObject(root, "mqtt_use_tls", mqtt_use_tls[0] == '1');

  cJSON *diagnostics = cJSON_CreateObject();
  cJSON_AddStringToObject(diagnostics, "active_link",
                          network_manager_link_to_str(
                              network_manager_get_active_link()));
  cJSON_AddBoolToObject(diagnostics, "time_synced",
                        network_manager_is_time_synced());
  cJSON_AddStringToObject(diagnostics, "wifi_last_error",
                          wifi_manager_get_last_error());
  cJSON_AddNumberToObject(diagnostics, "wifi_reason_code",
                          wifi_manager_get_last_disconnect_reason());
  cJSON_AddStringToObject(diagnostics, "wifi_reason_name",
                          wifi_manager_disconnect_reason_to_str(
                              wifi_manager_get_last_disconnect_reason()));
  cJSON_AddStringToObject(diagnostics, "cellular_last_error",
                          cellular_manager_get_last_error());
  cJSON_AddStringToObject(diagnostics, "cellular_ppp_phase",
                          cellular_manager_ppp_phase_to_str(
                              cellular_manager_get_ppp_phase()));
  cJSON_AddBoolToObject(diagnostics, "cellular_ppp_up",
                        cellular_manager_is_ppp_up());
  cJSON_AddBoolToObject(diagnostics, "mqtt_connected",
                        mqtt_manager_is_connected());
  if (mqtt_manager_get_status_snapshot(&mqtt_snapshot) == ESP_OK) {
    cJSON_AddStringToObject(diagnostics, "mqtt_last_error",
                            mqtt_snapshot.last_error);
    cJSON_AddStringToObject(diagnostics, "mqtt_last_event",
                            mqtt_snapshot.last_event);
  }
  cJSON_AddItemToObject(root, "diagnostics", diagnostics);

  // Add QoS values
  cJSON_AddNumberToObject(root, "mqtt_qos_pub",
                          atoi(mqtt_qos_pub_telemetry));
  cJSON_AddNumberToObject(root, "mqtt_qos_sub", atoi(mqtt_qos_sub));

  const char *resp_str = cJSON_PrintUnformatted(root);
  httpd_resp_send(req, resp_str, HTTPD_RESP_USE_STRLEN);

  cJSON_Delete(root);
  free((void *)resp_str);
  return ESP_OK;
}

static const httpd_uri_t api_status = {.uri = "/api/status",
                                       .method = HTTP_GET,
                                       .handler = api_status_get_handler,
                                       .user_ctx = NULL};

// GET /api/login (Handle GET request gracefully)
static esp_err_t api_login_get_handler(httpd_req_t *req) {
  httpd_resp_send_err(req, HTTPD_405_METHOD_NOT_ALLOWED, "Use POST to login");
  return ESP_OK;
}

// POST /api/login
static esp_err_t api_login_post_handler(httpd_req_t *req) {
  char buf[128];
  int ret, remaining = req->content_len;

  if (remaining >= sizeof(buf)) {
    httpd_resp_send_500(req);
    return ESP_FAIL;
  }

  if ((ret = httpd_req_recv(req, buf, remaining)) <= 0) {
    if (ret == HTTPD_SOCK_ERR_TIMEOUT) {
      httpd_resp_send_408(req);
    }
    return ESP_FAIL;
  }
  buf[remaining] = '\0';

  cJSON *root = cJSON_Parse(buf);
  cJSON *user = cJSON_GetObjectItem(root, "username");
  cJSON *pass = cJSON_GetObjectItem(root, "password");

  if (cJSON_IsString(user) && cJSON_IsString(pass)) {
    if (check_credentials(user->valuestring, pass->valuestring)) {
      generate_session_token();
      char cookie_header[64];
      snprintf(cookie_header, sizeof(cookie_header), "%s=%s; Path=/",
               SESSION_COOKIE_NAME, s_session_token);
      httpd_resp_set_hdr(req, "Set-Cookie", cookie_header);
      httpd_resp_set_type(req, "application/json");
      httpd_resp_send(req, "{\"status\": \"ok\"}", HTTPD_RESP_USE_STRLEN);
      ESP_LOGI(TAG, "Login successful");
    } else {
      httpd_resp_send_err(req, HTTPD_401_UNAUTHORIZED, "Unauthorized");
      ESP_LOGW(TAG, "Login failed");
    }
  } else {
    httpd_resp_send_500(req);
  }
  cJSON_Delete(root);
  return ESP_OK;
}

// POST /api/scan (Trigger scan)
static esp_err_t api_scan_post_handler(httpd_req_t *req) {
  if (!is_authenticated(req)) {
    httpd_resp_send_err(req, HTTPD_401_UNAUTHORIZED, "Unauthorized");
    return ESP_OK;
  }
  wifi_manager_scan();
  const char *resp = "{\"status\": \"scanning\"}";
  httpd_resp_set_type(req, "application/json");
  httpd_resp_send(req, resp, HTTPD_RESP_USE_STRLEN);
  return ESP_OK;
}

// GET /api/certs/status
static esp_err_t api_certs_status_get_handler(httpd_req_t *req) {
  if (!is_authenticated(req)) {
    httpd_resp_send_err(req, HTTPD_401_UNAUTHORIZED, "Unauthorized");
    return ESP_OK;
  }

  cJSON *root = cJSON_CreateObject();
  struct stat st;

  if (stat("/littlefs/client.crt", &st) == 0) {
    cJSON_AddStringToObject(root, "client_crt", "client.crt");
  } else {
    cJSON_AddNullToObject(root, "client_crt");
  }

  if (stat("/littlefs/client.key", &st) == 0) {
    cJSON_AddStringToObject(root, "client_key", "client.key");
  } else {
    cJSON_AddNullToObject(root, "client_key");
  }

  if (stat("/littlefs/root.crt", &st) == 0) {
    cJSON_AddStringToObject(root, "root_crt", "root.crt");
  } else {
    cJSON_AddNullToObject(root, "root_crt");
  }

  const char *resp = cJSON_PrintUnformatted(root);
  httpd_resp_set_type(req, "application/json");
  httpd_resp_send(req, resp, HTTPD_RESP_USE_STRLEN);

  cJSON_Delete(root);
  free((void *)resp);
  return ESP_OK;
}

// GET /api/scan (Get results)
static esp_err_t api_scan_get_handler(httpd_req_t *req) {
  if (!is_authenticated(req)) {
    httpd_resp_send_err(req, HTTPD_401_UNAUTHORIZED, "Unauthorized");
    return ESP_OK;
  }
  char *json_results = wifi_manager_get_scan_results_json();
  if (json_results) {
    httpd_resp_set_type(req, "application/json");
    httpd_resp_send(req, json_results, HTTPD_RESP_USE_STRLEN);
    free(json_results);
  } else {
    httpd_resp_send_500(req);
  }
  return ESP_OK;
}

// POST /api/config (Set WiFi Credentials)
static esp_err_t api_config_post_handler(httpd_req_t *req) {
  if (!is_authenticated(req)) {
    httpd_resp_send_err(req, HTTPD_401_UNAUTHORIZED, "Unauthorized");
    return ESP_OK;
  }
  char buf[128];
  int ret, remaining = req->content_len;

  if (remaining >= sizeof(buf)) {
    httpd_resp_send_500(req);
    return ESP_FAIL;
  }

  if ((ret = httpd_req_recv(req, buf, remaining)) <= 0) {
    if (ret == HTTPD_SOCK_ERR_TIMEOUT) {
      httpd_resp_send_408(req);
    }
    return ESP_FAIL;
  }
  buf[remaining] = '\0';

  cJSON *root = cJSON_Parse(buf);
  if (root == NULL) {
    httpd_resp_send_500(req); // Bad JSON
    return ESP_FAIL;
  }

  cJSON *ssid_json = cJSON_GetObjectItem(root, "ssid");
  cJSON *pass_json = cJSON_GetObjectItem(root, "password");

  if (cJSON_IsString(ssid_json) && (ssid_json->valuestring != NULL)) {
    const char *pass = NULL;
    if (cJSON_IsString(pass_json)) {
      pass = pass_json->valuestring;
    }

    wifi_manager_set_config(ssid_json->valuestring, pass);

    const char *resp =
        "{\"status\": \"configured\", \"message\": \"Connecting...\"}";
    httpd_resp_set_type(req, "application/json");
    httpd_resp_send(req, resp, HTTPD_RESP_USE_STRLEN);
  } else {
    httpd_resp_send_500(req); // Missing SSID
  }

  cJSON_Delete(root);
  return ESP_OK;
}

// POST /api/config/network
static esp_err_t api_config_network_post_handler(httpd_req_t *req) {
  if (!is_authenticated(req)) {
    httpd_resp_send_err(req, HTTPD_401_UNAUTHORIZED, "Unauthorized");
    return ESP_OK;
  }

  char buf[384];
  int ret, remaining = req->content_len;
  if (remaining <= 0 || remaining >= sizeof(buf)) {
    httpd_resp_send_err(req, HTTPD_400_BAD_REQUEST, "Payload too large");
    return ESP_OK;
  }

  if ((ret = httpd_req_recv(req, buf, remaining)) <= 0) {
    return ESP_FAIL;
  }
  buf[remaining] = '\0';

  cJSON *root = cJSON_Parse(buf);
  if (root == NULL) {
    httpd_resp_send_err(req, HTTPD_400_BAD_REQUEST, "Invalid JSON");
    return ESP_OK;
  }

  cJSON *mode = cJSON_GetObjectItem(root, "mode");
  cJSON *apn = cJSON_GetObjectItem(root, "apn");
  cJSON *user = cJSON_GetObjectItem(root, "user");
  cJSON *pass = cJSON_GetObjectItem(root, "pass");

  if (cJSON_IsString(mode) && mode->valuestring != NULL) {
    network_mode_t m = network_manager_mode_from_str(mode->valuestring);
    network_manager_set_mode(m);
  }

  if (cJSON_IsString(apn) && apn->valuestring != NULL) {
    const char *u = (cJSON_IsString(user) && user->valuestring) ? user->valuestring : "";
    const char *p = (cJSON_IsString(pass) && pass->valuestring) ? pass->valuestring : "";
    esp_err_t err = cellular_manager_set_apn_config(apn->valuestring, u, p);
    if (err != ESP_OK) {
      cJSON_Delete(root);
      httpd_resp_send_err(req, HTTPD_500_INTERNAL_SERVER_ERROR,
                          "Failed to save APN config");
      return ESP_OK;
    }
  }

  cJSON_Delete(root);
  httpd_resp_send(req, "{\"status\":\"saved\"}", HTTPD_RESP_USE_STRLEN);
  return ESP_OK;
}

// POST /api/config/sensor
static esp_err_t api_config_sensor_post_handler(httpd_req_t *req) {
  if (!is_authenticated(req)) {
    httpd_resp_send_err(req, HTTPD_401_UNAUTHORIZED, "Unauthorized");
    return ESP_OK;
  }
  char buf[128];
  int ret, remaining = req->content_len;
  if (remaining >= sizeof(buf)) {
    httpd_resp_send_500(req);
    return ESP_FAIL;
  }
  if ((ret = httpd_req_recv(req, buf, remaining)) <= 0)
    return ESP_FAIL;
  buf[remaining] = '\0';

  cJSON *root = cJSON_Parse(buf);
  cJSON *code = root ? cJSON_GetObjectItem(root, "serial") : NULL;
  const char *serial = cJSON_IsString(code) ? code->valuestring : NULL;
  bool valid_serial = serial != NULL && strlen(serial) == 13 &&
                      strncmp(serial, "IOT-", 4) == 0 && serial[8] == '-';
  for (size_t i = 4; valid_serial && i < 13; i++) {
    if (i != 8 && !isalnum((unsigned char)serial[i])) {
      valid_serial = false;
    }
  }
  if (valid_serial) {
    if (factory_has_serial()) {
      httpd_resp_send_err(req, HTTPD_400_BAD_REQUEST,
                          "Serial already registered");
    } else {
      save_nvs_str("serial", serial);
      factory_store_serial_if_missing(serial);
      httpd_resp_send(req, "{\"status\":\"saved\"}", HTTPD_RESP_USE_STRLEN);
    }
  } else {
    httpd_resp_send_err(req, HTTPD_400_BAD_REQUEST,
                        "Serial must match IOT-XXXX-XXXX");
  }
  cJSON_Delete(root);
  return ESP_OK;
}

// POST /api/config/mqtt
static esp_err_t api_config_mqtt_post_handler(httpd_req_t *req) {
  if (!is_authenticated(req)) {
    httpd_resp_send_err(req, HTTPD_401_UNAUTHORIZED, "Unauthorized");
    return ESP_OK;
  }

  char buf[512];
  int remaining = req->content_len;
  if (remaining <= 0 || remaining >= (int)sizeof(buf)) {
    httpd_resp_send_err(req, HTTPD_400_BAD_REQUEST, "Invalid payload");
    return ESP_OK;
  }
  int received = httpd_req_recv(req, buf, remaining);
  if (received <= 0) return ESP_FAIL;
  buf[received] = '\0';

  cJSON *root = cJSON_Parse(buf);
  if (root == NULL) {
    httpd_resp_send_err(req, HTTPD_400_BAD_REQUEST, "Invalid JSON");
    return ESP_OK;
  }

  cJSON *uri = cJSON_GetObjectItem(root, "uri");
  cJSON *port = cJSON_GetObjectItem(root, "port");
  cJSON *use_tls = cJSON_GetObjectItem(root, "use_tls");
  cJSON *qos_pub = cJSON_GetObjectItem(root, "qos_pub");
  cJSON *qos_sub = cJSON_GetObjectItem(root, "qos_sub");

  if (!cJSON_IsString(uri) || !cJSON_IsString(port)) {
    cJSON_Delete(root);
    httpd_resp_send_err(req, HTTPD_400_BAD_REQUEST, "Host and port required");
    return ESP_OK;
  }

  save_nvs_str("mqtt_uri", uri->valuestring);
  save_nvs_str("mqtt_port", port->valuestring);
  save_nvs_str("mqtt_use_tls",
               cJSON_IsBool(use_tls) && cJSON_IsTrue(use_tls) ? "1" : "0");

  char qos[2];
  snprintf(qos, sizeof(qos), "%d",
           cJSON_IsNumber(qos_pub) ? qos_pub->valueint : 0);
  save_nvs_str("mqtt_qos_pub_telemetry", qos);
  snprintf(qos, sizeof(qos), "%d",
           cJSON_IsNumber(qos_sub) ? qos_sub->valueint : 1);
  save_nvs_str("mqtt_qos_sub", qos);

  cJSON_Delete(root);
  httpd_resp_send(req, "{\"status\":\"saved\"}", HTTPD_RESP_USE_STRLEN);
  return ESP_OK;
}

// Helper for URL decoding
static void url_decode(char *dst, const char *src) {
  char a, b;
  while (*src) {
    if ((*src == '%') && ((a = src[1]) && (b = src[2])) &&
        (isxdigit((int)a) && isxdigit((int)b))) {
      if (a >= 'a')
        a -= 'a' - 'A';
      if (a >= 'A')
        a -= ('A' - 10);
      else
        a -= '0';
      if (b >= 'a')
        b -= 'a' - 'A';
      if (b >= 'A')
        b -= ('A' - 10);
      else
        b -= '0';
      *dst++ = 16 * a + b;
      src += 3;
    } else if (*src == '+') {
      *dst++ = ' ';
      src++;
    } else {
      *dst++ = *src++;
    }
  }
  *dst++ = '\0';
}

// POST /api/config/wifi/forget
static esp_err_t api_wifi_forget_post_handler(httpd_req_t *req) {
  if (!is_authenticated(req)) {
    httpd_resp_send_err(req, HTTPD_401_UNAUTHORIZED, "Unauthorized");
    return ESP_OK;
  }

  wifi_manager_clear_config();
  httpd_resp_send(req, "{\"status\": \"forgotten\"}", HTTPD_RESP_USE_STRLEN);
  return ESP_OK;
}

// Helper to factory reset
void factory_reset_device(void *arg) {
  ESP_LOGW(TAG, "!!! INICIANDO FACTORY RESET TOTAL !!!");

  // Snapshot TLS flag + certs before wipe
  factory_store_tls_snapshot();

  // 1. Borrar NVS por namespaces (mantener "factory")
  nvs_handle_t nvs_h;
  if (nvs_open("storage", NVS_READWRITE, &nvs_h) == ESP_OK) {
    nvs_erase_all(nvs_h);
    nvs_commit(nvs_h);
    nvs_close(nvs_h);
  }
  if (nvs_open("wifi_prefs", NVS_READWRITE, &nvs_h) == ESP_OK) {
    nvs_erase_all(nvs_h);
    nvs_commit(nvs_h);
    nvs_close(nvs_h);
  }

  // 2. Borrar LittleFS completo (Certificados, Logs, etc.)
  // Usamos el nombre de la partición "storage" definida en partitions.csv
  esp_err_t err_fs = esp_littlefs_format("storage");
  if (err_fs == ESP_OK) {
    ESP_LOGI(TAG, "Partición LittleFS (storage) formateada con éxito");
  } else {
    ESP_LOGE(TAG, "Fallo al formatear LittleFS: %s", esp_err_to_name(err_fs));
  }

  ESP_LOGW(TAG, "Sistema limpio. Reiniciando en 1 segundo...");
  vTaskDelay(pdMS_TO_TICKS(1000));
  esp_restart();
}

static void restart_device(void *arg) {
  ESP_LOGI(TAG, "Reiniciando dispositivo...");
  vTaskDelay(pdMS_TO_TICKS(200));
  esp_restart();
}

// POST /api/reset-factory
static esp_err_t api_reset_factory_post_handler(httpd_req_t *req) {
  if (!is_authenticated(req)) {
    httpd_resp_send_err(req, HTTPD_401_UNAUTHORIZED, "Unauthorized");
    return ESP_OK;
  }

  httpd_resp_send(req, "{\"status\": \"ok\", \"message\": \"Resetting...\"}",
                  HTTPD_RESP_USE_STRLEN);

  xTaskCreate((TaskFunction_t)factory_reset_device, "reset_task", 4096, NULL, 5,
              NULL);

  return ESP_OK;
}

// POST /api/restart
static esp_err_t api_restart_post_handler(httpd_req_t *req) {
  if (!is_authenticated(req)) {
    httpd_resp_send_err(req, HTTPD_401_UNAUTHORIZED, "Unauthorized");
    return ESP_OK;
  }

  httpd_resp_send(req,
                  "{\"status\": \"ok\", \"message\": "
                  "\"Restarting...\"}",
                  HTTPD_RESP_USE_STRLEN);
  xTaskCreate((TaskFunction_t)restart_device, "restart_task", 2048, NULL, 5,
              NULL);
  return ESP_OK;
}

// POST /api/mqtt/reset-certs
static esp_err_t api_mqtt_reset_certs_post_handler(httpd_req_t *req) {
  if (!is_authenticated(req)) {
    httpd_resp_send_err(req, HTTPD_401_UNAUTHORIZED, "Unauthorized");
    return ESP_OK;
  }

  const char *certs[] = {"/littlefs/client.crt", "/littlefs/client.key",
                         "/littlefs/root.crt"};
  for (int i = 0; i < 3; i++) {
    if (unlink(certs[i]) == 0) {
      ESP_LOGI(TAG, "Archivo borrado: %s", certs[i]);
    } else {
      ESP_LOGW(TAG, "Fallo al borrar (puede que no exista): %s (errno: %d)",
               certs[i], errno);
    }
  }

  ESP_LOGI(TAG, "Certificados borrados a petición del usuario");

  httpd_resp_send(req, "{\"status\": \"ok\"}", HTTPD_RESP_USE_STRLEN);
  return ESP_OK;
}

// POST /api/mqtt/test
static esp_err_t api_mqtt_test_post_handler(httpd_req_t *req) {
  if (!is_authenticated(req)) {
    httpd_resp_send_err(req, HTTPD_401_UNAUTHORIZED, "Unauthorized");
    return ESP_OK;
  }

  if (!mqtt_manager_start_test()) {
    httpd_resp_send_err(req, HTTPD_400_BAD_REQUEST, "MQTT not connected");
    return ESP_OK;
  }

  httpd_resp_send(req,
                  "{\"status\": \"sent\", \"message\": "
                  "\"Probando conexión...\"}",
                  HTTPD_RESP_USE_STRLEN);
  return ESP_OK;
}

// POST /api/files?path=/path/to/file
static esp_err_t api_files_post_handler(httpd_req_t *req) {
  if (!is_authenticated(req)) {
    httpd_resp_send_err(req, HTTPD_401_UNAUTHORIZED, "Unauthorized");
    return ESP_OK;
  }

  // Parse query string for path
  char filepath[256] = "/littlefs/";
  char query[256];
  if (httpd_req_get_url_query_str(req, query, sizeof(query)) == ESP_OK) {
    char param[128];
    if (httpd_query_key_value(query, "path", param, sizeof(param)) == ESP_OK) {
      // Decode URL (converts %2F to /)
      char decoded_path[128];
      url_decode(decoded_path, param);

      // Construct full path
      if (decoded_path[0] == '/') {
        snprintf(filepath, sizeof(filepath), "/littlefs%s", decoded_path);
      } else {
        snprintf(filepath, sizeof(filepath), "/littlefs/%s", decoded_path);
      }
    }
  }

  ESP_LOGI(TAG, "Uploading file to: %s", filepath);

  int fd = open(filepath, O_WRONLY | O_CREAT | O_TRUNC, 0666);
  if (fd < 0) {
    ESP_LOGE(TAG, "Failed to open file : %s", filepath);
    httpd_resp_send_500(req);
    return ESP_FAIL;
  }

  char buf[1024];
  int remaining = req->content_len;
  int received;

  while (remaining > 0) {
    if ((received = httpd_req_recv(req, buf, MIN(remaining, sizeof(buf)))) <=
        0) {
      if (received == HTTPD_SOCK_ERR_TIMEOUT) {
        continue;
      }
      close(fd);
      return ESP_FAIL;
    }
    write(fd, buf, received);
    remaining -= received;
  }

  close(fd);
  if (is_cert_filepath(filepath)) {
    factory_store_certs_if_missing();
  }
  httpd_resp_send(req, "{\"status\": \"ok\"}", HTTPD_RESP_USE_STRLEN);
  return ESP_OK;
}

// POST /api/auth/password
static esp_err_t api_auth_password_post_handler(httpd_req_t *req) {
  if (!is_authenticated(req)) {
    httpd_resp_send_err(req, HTTPD_401_UNAUTHORIZED, "Unauthorized");
    return ESP_OK;
  }

  char buf[256];
  int ret, remaining = req->content_len;
  if (remaining <= 0 || remaining >= sizeof(buf)) {
    httpd_resp_send_500(req);
    return ESP_FAIL;
  }
  if ((ret = httpd_req_recv(req, buf, remaining)) <= 0)
    return ESP_FAIL;
  buf[remaining] = '\0';

  cJSON *root = cJSON_Parse(buf);
  cJSON *current = cJSON_GetObjectItem(root, "current");
  cJSON *new_pass = cJSON_GetObjectItem(root, "new");

  if (cJSON_IsString(current) && cJSON_IsString(new_pass)) {
    if (strlen(new_pass->valuestring) < 6) {
      httpd_resp_send_err(req, HTTPD_400_BAD_REQUEST, "Password too short");
    } else {
      // Verify current password
      char stored_user[32];
      read_nvs_str("admin_user", stored_user, sizeof(stored_user), "admin");
      if (check_credentials(stored_user, current->valuestring)) {
        save_nvs_str("admin_pass", new_pass->valuestring);
        s_session_expiry = 0; // Force relogin
        httpd_resp_send(req, "{\"status\": \"ok\"}", HTTPD_RESP_USE_STRLEN);
      } else {
        httpd_resp_send_err(req, HTTPD_401_UNAUTHORIZED,
                            "Invalid current password");
      }
    }
  } else {
    httpd_resp_send_500(req);
  }
  cJSON_Delete(root);
  return ESP_OK;
}

static const httpd_uri_t api_login = {.uri = "/api/login",
                                      .method = HTTP_POST,
                                      .handler = api_login_post_handler,
                                      .user_ctx = NULL};

static const httpd_uri_t api_login_get = {.uri = "/api/login",
                                          .method = HTTP_GET,
                                          .handler = api_login_get_handler,
                                          .user_ctx = NULL};

static const httpd_uri_t api_files_post = {.uri = "/api/files",
                                           .method = HTTP_POST,
                                           .handler = api_files_post_handler,
                                           .user_ctx = NULL};

static const httpd_uri_t api_scan_post = {.uri = "/api/scan",
                                          .method = HTTP_POST,
                                          .handler = api_scan_post_handler,
                                          .user_ctx = NULL};

static const httpd_uri_t api_scan_get = {.uri = "/api/scan",
                                         .method = HTTP_GET,
                                         .handler = api_scan_get_handler,
                                         .user_ctx = NULL};

static const httpd_uri_t api_config_post = {.uri = "/api/config",
                                            .method = HTTP_POST,
                                            .handler = api_config_post_handler,
                                            .user_ctx = NULL};

static const httpd_uri_t api_config_sensor = {
    .uri = "/api/config/sensor",
    .method = HTTP_POST,
    .handler = api_config_sensor_post_handler,
    .user_ctx = NULL};
static const httpd_uri_t api_config_mqtt = {.uri = "/api/config/mqtt",
                                            .method = HTTP_POST,
                                            .handler =
                                                api_config_mqtt_post_handler,
                                            .user_ctx = NULL};
static const httpd_uri_t api_config_network = {
    .uri = "/api/config/network",
    .method = HTTP_POST,
    .handler = api_config_network_post_handler,
    .user_ctx = NULL};

static const httpd_uri_t api_certs_status = {.uri = "/api/certs/status",
                                             .method = HTTP_GET,
                                             .handler =
                                                 api_certs_status_get_handler,
                                             .user_ctx = NULL};

// --- Funciones Públicas ---

esp_err_t web_server_start(void) {
  if (server != NULL) {
    ESP_LOGW(TAG, "El servidor ya está corriendo");
    return ESP_OK;
  }

  httpd_config_t config = HTTPD_DEFAULT_CONFIG();
  config.max_uri_handlers = 32;
  config.stack_size = 8192; // Aumentar stack si es necesario

  ESP_LOGI(TAG, "Iniciando servidor web en puerto: %d", config.server_port);

  if (httpd_start(&server, &config) == ESP_OK) {
    // Registrar URIs
    httpd_register_uri_handler(server, &root);
    httpd_register_uri_handler(server, &page_login);
    httpd_register_uri_handler(server, &page_status);
    httpd_register_uri_handler(server, &page_wifi);
    httpd_register_uri_handler(server, &page_mqtt);
    httpd_register_uri_handler(server, &page_device);
    httpd_register_uri_handler(server, &page_password);

    httpd_register_uri_handler(server, &favicon);
    httpd_register_uri_handler(server, &api_status);
    httpd_register_uri_handler(server, &api_login);
    httpd_register_uri_handler(server, &api_login_get);
    httpd_register_uri_handler(server, &api_scan_post);
    httpd_register_uri_handler(server, &api_scan_get);
    httpd_register_uri_handler(server, &api_config_post);
    httpd_register_uri_handler(server, &api_config_sensor);
    httpd_register_uri_handler(server, &api_config_mqtt);
    httpd_register_uri_handler(server, &api_config_network);

    // New endpoints
    static const httpd_uri_t api_wifi_forget = {
        .uri = "/api/config/wifi/forget",
        .method = HTTP_POST,
        .handler = api_wifi_forget_post_handler,
        .user_ctx = NULL};
    httpd_register_uri_handler(server, &api_wifi_forget);

    static const httpd_uri_t api_mqtt_test = {.uri = "/api/mqtt/test",
                                              .method = HTTP_POST,
                                              .handler =
                                                  api_mqtt_test_post_handler,
                                              .user_ctx = NULL};
    httpd_register_uri_handler(server, &api_mqtt_test);

    httpd_register_uri_handler(server, &api_certs_status);
    httpd_register_uri_handler(server, &api_files_post);

    // Factory Reset & Cert Reset
    static const httpd_uri_t api_reset_factory = {
        .uri = "/api/reset-factory",
        .method = HTTP_POST,
        .handler = api_reset_factory_post_handler,
        .user_ctx = NULL};
    httpd_register_uri_handler(server, &api_reset_factory);

    static const httpd_uri_t api_restart = {.uri = "/api/restart",
                                            .method = HTTP_POST,
                                            .handler = api_restart_post_handler,
                                            .user_ctx = NULL};
    httpd_register_uri_handler(server, &api_restart);

    static const httpd_uri_t api_mqtt_reset_certs = {
        .uri = "/api/mqtt/reset-certs",
        .method = HTTP_POST,
        .handler = api_mqtt_reset_certs_post_handler,
        .user_ctx = NULL};
    httpd_register_uri_handler(server, &api_mqtt_reset_certs);

    // Auth Management
    static const httpd_uri_t api_auth_password = {
        .uri = "/api/auth/password",
        .method = HTTP_POST,
        .handler = api_auth_password_post_handler,
        .user_ctx = NULL};
    httpd_register_uri_handler(server, &api_auth_password);

    ESP_LOGI(TAG, "Servidor web iniciado correctamente");
    return ESP_OK;
  }

  ESP_LOGE(TAG, "Error al iniciar servidor web");
  return ESP_FAIL;
}

void web_server_stop(void) {
  if (server) {
    httpd_stop(server);
    server = NULL;
    ESP_LOGI(TAG, "Servidor web detenido");
  }
}
