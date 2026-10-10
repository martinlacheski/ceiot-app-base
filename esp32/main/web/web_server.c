/*
 * web_server.c
 */

#include "cJSON.h"
#include "esp_app_desc.h"
#include "esp_http_server.h"
#include "esp_littlefs.h"
#include "esp_log.h"
#include "esp_timer.h"
#include "esp_vfs.h"
#include "mqtt_manager.h"
#include "provisioning_logic.h"
#include "nvs_manager.h"
#include "sensor.h"
#include "telemetry.h"
#include "time_sync.h"
#include "network_manager.h"
#include "wifi_manager.h"
#include <ctype.h>
#include <math.h>
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
    strlcpy(out_val, default_val, max_len);
    return;
  }
  size_t required_size = 0;
  err = nvs_get_str(my_handle, key, NULL, &required_size);
  if (err == ESP_OK && required_size <= max_len) {
    nvs_get_str(my_handle, key, out_val, &required_size);
  } else {
    strlcpy(out_val, default_val, max_len);
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

static void erase_nvs_key(const char *key) {
  nvs_handle_t handle;
  if (nvs_open("storage", NVS_READWRITE, &handle) != ESP_OK) return;
  if (nvs_erase_key(handle, key) == ESP_OK) nvs_commit(handle);
  nvs_close(handle);
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
  httpd_resp_send_chunk(req, HTML_FOOTER, HTTPD_RESP_USE_STRLEN);
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
  httpd_resp_send_chunk(req, HTML_FOOTER, HTTPD_RESP_USE_STRLEN);
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

static bool file_exists(const char *path) {
  struct stat st;
  return stat(path, &st) == 0 && st.st_size > 0;
}

// "sensor": setting ("auto" or a model key), model/key in use (null when
// none), source ("auto" detection or "manual" setting), state and the last
// valid reading of the model in use.
static void add_sensor_status(cJSON *root) {
  cJSON *sensor = cJSON_AddObjectToObject(root, "sensor");
  sensor_status_t status;
  sensor_get_status(&status);
  cJSON_AddStringToObject(sensor, "setting",
                          sensor_logic_setting_key(status.setting));
  if (status.model != SENSOR_NONE) {
    cJSON_AddStringToObject(sensor, "model",
                            sensor_logic_model_name(status.model));
    cJSON_AddStringToObject(sensor, "key", sensor_logic_model_key(status.model));
  } else {
    cJSON_AddNullToObject(sensor, "model");
    cJSON_AddNullToObject(sensor, "key");
  }
  cJSON_AddStringToObject(sensor, "source",
                          status.setting == SENSOR_SETTING_AUTO ? "auto"
                                                                : "manual");
  cJSON_AddStringToObject(sensor, "state", sensor_state_name(status.state));
  sensor_reading_t last;
  int64_t age_s = 0;
  if (!sensor_get_last(&last, NULL, &age_s)) {
    cJSON_AddNullToObject(sensor, "last");
    return;
  }
  cJSON *values = cJSON_AddObjectToObject(sensor, "last");
  if (last.has_temperature) {
    cJSON_AddNumberToObject(values, "temperature",
                            round(last.temperature * 10.0) / 10.0);
  }
  if (last.has_relative_humidity) {
    cJSON_AddNumberToObject(values, "relative_humidity",
                            round(last.relative_humidity * 10.0) / 10.0);
  }
  if (last.has_pressure) {
    cJSON_AddNumberToObject(values, "pressure",
                            round(last.pressure * 10.0) / 10.0);
  }
  cJSON_AddNumberToObject(sensor, "age_s", (double)age_s);
}

static void add_time_status(cJSON *root) {
  time_t now;
  struct tm utc;
  char iso[32] = "";
  time(&now);
  gmtime_r(&now, &utc);
  strftime(iso, sizeof(iso), "%Y-%m-%dT%H:%M:%S", &utc);
  cJSON *time_obj = cJSON_AddObjectToObject(root, "time");
  cJSON_AddBoolToObject(time_obj, "synced", network_manager_is_time_synced());
  cJSON_AddStringToObject(time_obj, "iso", iso);
  cJSON_AddStringToObject(time_obj, "source",
                          time_sync_source_name(time_sync_get_source()));
}

// GET /api/status (JSON)
static esp_err_t api_status_get_handler(httpd_req_t *req) {
  if (!is_authenticated(req)) {
    httpd_resp_send_err(req, HTTPD_401_UNAUTHORIZED, "Unauthorized");
    return ESP_OK;
  }

  char serial[32];
  read_nvs_str("serial", serial, sizeof(serial), "");

  cJSON *root = cJSON_CreateObject();
  cJSON_AddStringToObject(root, "serial", serial);

  cJSON *device = cJSON_AddObjectToObject(root, "device");
  cJSON_AddStringToObject(device, "firmware_version",
                          esp_app_get_description()->version);
  cJSON_AddStringToObject(device, "idf_version", esp_get_idf_version());
  cJSON_AddNumberToObject(device, "uptime",
                          (double)(esp_timer_get_time() / 1000000LL));
  cJSON_AddNumberToObject(device, "heap_free", esp_get_free_heap_size());
  cJSON_AddNumberToObject(device, "heap_min",
                          esp_get_minimum_free_heap_size());

  add_sensor_status(root);
  add_time_status(root);

  wifi_status_snapshot_t wifi;
  wifi_manager_get_status_snapshot(&wifi);
  cJSON *wifi_obj = cJSON_AddObjectToObject(root, "wifi");
  cJSON_AddBoolToObject(wifi_obj, "connected", wifi.connected);
  cJSON_AddStringToObject(wifi_obj, "ssid", wifi.ssid);
  cJSON_AddStringToObject(wifi_obj, "saved_ssid", wifi.saved_ssid);
  cJSON_AddStringToObject(wifi_obj, "ip", wifi.ip);
  cJSON_AddNumberToObject(wifi_obj, "rssi", wifi.rssi_dbm);
  cJSON_AddStringToObject(wifi_obj, "last_error", wifi.last_error);
  cJSON_AddStringToObject(
      wifi_obj, "last_disconnect_reason",
      wifi_manager_disconnect_reason_to_str(wifi.last_disconnect_reason));

  cJSON *ap = cJSON_AddObjectToObject(root, "ap");
  cJSON_AddBoolToObject(ap, "active", wifi.ap_active);
  cJSON_AddStringToObject(ap, "ssid", wifi_manager_get_ap_ssid());

  mqtt_status_snapshot_t mqtt_snapshot;
  mqtt_manager_get_status_snapshot(&mqtt_snapshot);
  cJSON *mqtt = cJSON_AddObjectToObject(root, "mqtt");
  cJSON_AddBoolToObject(mqtt, "connected", mqtt_snapshot.connected);
  cJSON_AddStringToObject(mqtt, "host", mqtt_snapshot.host);
  cJSON_AddNumberToObject(mqtt, "port", mqtt_snapshot.port);
  cJSON_AddBoolToObject(mqtt, "use_tls", mqtt_snapshot.use_tls);
  char backend_url[128];
  time_sync_get_backend_url(backend_url, sizeof(backend_url));
  cJSON_AddStringToObject(mqtt, "backend_url", backend_url);
  char configured_backend[128];
  read_nvs_str("backend_url", configured_backend, sizeof(configured_backend),
               "");
  cJSON_AddStringToObject(mqtt, "backend_url_configured", configured_backend);
  cJSON_AddBoolToObject(mqtt, "network_ready", mqtt_snapshot.network_ready);
  cJSON_AddStringToObject(mqtt, "last_event", mqtt_snapshot.last_event);
  cJSON_AddStringToObject(mqtt, "last_error", mqtt_snapshot.last_error);
  cJSON_AddNumberToObject(mqtt, "tls_stack_err", mqtt_snapshot.tls_stack_err);
  cJSON_AddNumberToObject(mqtt, "esp_tls_last_err",
                          mqtt_snapshot.esp_tls_last_err);

  cJSON *certs = cJSON_AddObjectToObject(root, "certs");
  cJSON_AddBoolToObject(certs, "root_crt", file_exists("/littlefs/root.crt"));
  cJSON_AddBoolToObject(certs, "client_crt",
                        file_exists("/littlefs/client.crt"));
  cJSON_AddBoolToObject(certs, "client_key",
                        file_exists("/littlefs/client.key"));
  // Client certificate CN vs serial: "mismatch"/"unreadable" keep MQTT off.
  cJSON_AddStringToObject(certs, "identity", mqtt_snapshot.identity);
  cJSON_AddStringToObject(certs, "client_cn", mqtt_snapshot.cert_cn);

  char *resp_str = cJSON_PrintUnformatted(root);
  cJSON_Delete(root);
  if (resp_str == NULL) {
    httpd_resp_send_500(req);
    return ESP_OK;
  }
  httpd_resp_set_type(req, "application/json");
  httpd_resp_send(req, resp_str, HTTPD_RESP_USE_STRLEN);
  free(resp_str);
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

// POST /api/config/serial {"serial":"IOT-XXXX-XXXX"}
static esp_err_t api_config_serial_post_handler(httpd_req_t *req) {
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
  if (prov_serial_is_valid(serial)) {
    if (factory_has_serial()) {
      httpd_resp_send_err(req, HTTPD_400_BAD_REQUEST,
                          "El serial ya está registrado");
    } else {
      save_nvs_str("serial", serial);
      factory_store_serial_if_missing(serial);
      httpd_resp_send(req, "{\"status\":\"saved\"}", HTTPD_RESP_USE_STRLEN);
      mqtt_manager_request_reload(); // MQTT starts with the new identity
    }
  } else {
    httpd_resp_send_err(req, HTTPD_400_BAD_REQUEST,
                        "El serial debe tener el formato IOT-XXXX-XXXX");
  }
  cJSON_Delete(root);
  return ESP_OK;
}

// POST /api/config/sensor {"setting":"auto|dht11|dht22|bmp280|bme280"}
// Stored in NVS and applied by the telemetry task without a restart.
static esp_err_t api_config_sensor_post_handler(httpd_req_t *req) {
  if (!is_authenticated(req)) {
    httpd_resp_send_err(req, HTTPD_401_UNAUTHORIZED, "Unauthorized");
    return ESP_OK;
  }
  char buf[128];
  int remaining = req->content_len;
  if (remaining <= 0 || remaining >= (int)sizeof(buf)) {
    httpd_resp_send_err(req, HTTPD_400_BAD_REQUEST, "Invalid payload");
    return ESP_OK;
  }
  int received = httpd_req_recv(req, buf, remaining);
  if (received <= 0) return ESP_FAIL;
  buf[received] = '\0';

  cJSON *root = cJSON_Parse(buf);
  cJSON *value = root ? cJSON_GetObjectItem(root, "setting") : NULL;
  int setting = SENSOR_SETTING_AUTO;
  bool valid = cJSON_IsString(value) &&
               sensor_logic_parse_setting(value->valuestring, &setting);
  cJSON_Delete(root);
  if (!valid) {
    httpd_resp_send_err(req, HTTPD_400_BAD_REQUEST,
                        "El sensor debe ser auto, dht11, dht22, bmp280 o bme280");
    return ESP_OK;
  }
  if (sensor_set_setting(setting) != ESP_OK) {
    httpd_resp_send_500(req);
    return ESP_OK;
  }
  telemetry_request_now(); // the telemetry task applies it right away
  httpd_resp_set_type(req, "application/json");
  httpd_resp_send(req, "{\"status\":\"saved\"}", HTTPD_RESP_USE_STRLEN);
  return ESP_OK;
}

// POST /api/config/sensor/detect: setting "auto" and a fresh detection.
static esp_err_t api_config_sensor_detect_post_handler(httpd_req_t *req) {
  if (!is_authenticated(req)) {
    httpd_resp_send_err(req, HTTPD_401_UNAUTHORIZED, "Unauthorized");
    return ESP_OK;
  }
  if (sensor_request_detection() != ESP_OK) {
    httpd_resp_send_500(req);
    return ESP_OK;
  }
  telemetry_request_now();
  httpd_resp_set_type(req, "application/json");
  httpd_resp_send(req, "{\"status\":\"detecting\"}", HTTPD_RESP_USE_STRLEN);
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
  cJSON *backend_url = cJSON_GetObjectItem(root, "backend_url");

  // Optional backend base URL for the HTTP time bootstrap; "" = default
  // (http://<broker host>:18000).
  if (backend_url != NULL &&
      (!cJSON_IsString(backend_url) ||
       strlen(backend_url->valuestring) >= 128 ||
       (backend_url->valuestring[0] != '\0' &&
        strncmp(backend_url->valuestring, "http://", 7) != 0 &&
        strncmp(backend_url->valuestring, "https://", 8) != 0))) {
    cJSON_Delete(root);
    httpd_resp_send_err(req, HTTPD_400_BAD_REQUEST,
                        "backend_url must start with http:// or https://");
    return ESP_OK;
  }

  int port_number = cJSON_IsString(port) ? atoi(port->valuestring) : 0;
  if (!cJSON_IsString(uri) || uri->valuestring[0] == '\0' ||
      strlen(uri->valuestring) >= 128 || port_number < 1 ||
      port_number > 65535) {
    cJSON_Delete(root);
    httpd_resp_send_err(req, HTTPD_400_BAD_REQUEST, "Host and port required");
    return ESP_OK;
  }

  save_nvs_str("mqtt_uri", uri->valuestring);
  save_nvs_str("mqtt_port", port->valuestring);
  save_nvs_str("mqtt_use_tls",
               cJSON_IsBool(use_tls) && cJSON_IsTrue(use_tls) ? "1" : "0");
  if (cJSON_IsString(backend_url)) {
    if (backend_url->valuestring[0] != '\0') {
      save_nvs_str("backend_url", backend_url->valuestring);
    } else {
      erase_nvs_key("backend_url");
    }
  }

  cJSON_Delete(root);
  httpd_resp_send(req, "{\"status\":\"saved\"}", HTTPD_RESP_USE_STRLEN);
  mqtt_manager_request_reload(); // reconnect with the new broker settings
  return ESP_OK;
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

#define CERT_MAX_BYTES 8192

// POST /api/files?path=<root.crt|client.crt|client.key> (raw file body).
// Only the three mTLS files can be written, always into /littlefs/.
static esp_err_t api_files_post_handler(httpd_req_t *req) {
  if (!is_authenticated(req)) {
    httpd_resp_send_err(req, HTTPD_401_UNAUTHORIZED, "Unauthorized");
    return ESP_OK;
  }

  char query[64];
  char name[32] = "";
  if (httpd_req_get_url_query_str(req, query, sizeof(query)) == ESP_OK) {
    httpd_query_key_value(query, "path", name, sizeof(name));
  }
  const char *file = name[0] == '/' ? name + 1 : name;
  if (strcmp(file, "root.crt") != 0 && strcmp(file, "client.crt") != 0 &&
      strcmp(file, "client.key") != 0) {
    httpd_resp_send_err(req, HTTPD_400_BAD_REQUEST,
                        "path must be root.crt, client.crt or client.key");
    return ESP_OK;
  }
  if (req->content_len <= 0 || req->content_len > CERT_MAX_BYTES) {
    httpd_resp_send_err(req, HTTPD_400_BAD_REQUEST, "Invalid file size");
    return ESP_OK;
  }

  char filepath[48];
  char tmppath[52];
  snprintf(filepath, sizeof(filepath), "/littlefs/%s", file);
  snprintf(tmppath, sizeof(tmppath), "%s.tmp", filepath);
  ESP_LOGI(TAG, "Uploading %s (%d bytes)", filepath, (int)req->content_len);

  int fd = open(tmppath, O_WRONLY | O_CREAT | O_TRUNC, 0600);
  if (fd < 0) {
    httpd_resp_send_500(req);
    return ESP_OK;
  }

  char buf[1024];
  int remaining = req->content_len;
  bool ok = true;
  while (remaining > 0) {
    int received = httpd_req_recv(req, buf, MIN(remaining, (int)sizeof(buf)));
    if (received == HTTPD_SOCK_ERR_TIMEOUT) continue;
    if (received <= 0 || write(fd, buf, received) != received) {
      ok = false;
      break;
    }
    remaining -= received;
  }
  close(fd);

  // Replace the old file only once the new one is complete.
  if (!ok || (unlink(filepath) != 0 && errno != ENOENT) ||
      rename(tmppath, filepath) != 0) {
    unlink(tmppath);
    httpd_resp_send_500(req);
    return ESP_OK;
  }
  factory_store_certs_if_missing();
  httpd_resp_set_type(req, "application/json");
  httpd_resp_send(req, "{\"status\": \"ok\"}", HTTPD_RESP_USE_STRLEN);
  return ESP_OK;
}

// POST /api/ap/stop
static esp_err_t api_ap_stop_post_handler(httpd_req_t *req) {
  if (!is_authenticated(req)) {
    httpd_resp_send_err(req, HTTPD_401_UNAUTHORIZED, "Unauthorized");
    return ESP_OK;
  }
  wifi_manager_stop_ap();
  httpd_resp_set_type(req, "application/json");
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
        // 403, not 401: the session is still valid (401 sends the UI to login).
        httpd_resp_send_err(req, HTTPD_403_FORBIDDEN,
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

static const httpd_uri_t api_config_serial = {
    .uri = "/api/config/serial",
    .method = HTTP_POST,
    .handler = api_config_serial_post_handler,
    .user_ctx = NULL};
static const httpd_uri_t api_config_sensor = {
    .uri = "/api/config/sensor",
    .method = HTTP_POST,
    .handler = api_config_sensor_post_handler,
    .user_ctx = NULL};
static const httpd_uri_t api_config_sensor_detect = {
    .uri = "/api/config/sensor/detect",
    .method = HTTP_POST,
    .handler = api_config_sensor_detect_post_handler,
    .user_ctx = NULL};
static const httpd_uri_t api_config_mqtt = {.uri = "/api/config/mqtt",
                                            .method = HTTP_POST,
                                            .handler =
                                                api_config_mqtt_post_handler,
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
    httpd_register_uri_handler(server, &api_config_serial);
    httpd_register_uri_handler(server, &api_config_sensor);
    httpd_register_uri_handler(server, &api_config_sensor_detect);
    httpd_register_uri_handler(server, &api_config_mqtt);

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

    static const httpd_uri_t api_ap_stop = {.uri = "/api/ap/stop",
                                            .method = HTTP_POST,
                                            .handler = api_ap_stop_post_handler,
                                            .user_ctx = NULL};
    httpd_register_uri_handler(server, &api_ap_stop);

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
