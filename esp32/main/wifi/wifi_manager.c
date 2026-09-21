/*
 * wifi_manager.c
 */

#include "cJSON.h"
#include "esp_event.h"
#include "esp_log.h"
#include "esp_mac.h"
#include "esp_sntp.h"
#include "esp_system.h"
#include "esp_wifi.h"
#include "freertos/FreeRTOS.h"
#include "freertos/event_groups.h"
#include "freertos/task.h"
#include "freertos/timers.h"
#include "lwip/err.h"
#include "lwip/sys.h"
#include "mdns.h"
#include "nvs.h"
#include "nvs_flash.h"
#include <string.h>

#include "wifi_manager.h"
#include "led_manager.h"

static const char *TAG = "WIFI_MGR";

// Configuración por defecto
#define DEFAULT_WIFI_SSID CONFIG_ESP_WIFI_SSID
#define DEFAULT_WIFI_PASS CONFIG_ESP_WIFI_PASSWORD

// Configuración AP
#define DEFAULT_AP_SSID_PREFIX "IOT_"
#define DEFAULT_AP_CHANNEL 1
#define DEFAULT_AP_MAX_CONN 4

// Bits de eventos
#define WIFI_CONNECTED_BIT BIT0
#define WIFI_FAIL_BIT BIT1

// Notificaciones para wifi_task
#define WIFI_CMD_CONNECT BIT0
#define WIFI_CMD_RECONNECT BIT1
#define WIFI_CMD_START_AP BIT2
#define WIFI_CMD_STOP_AP BIT3
#define WIFI_CMD_SCAN BIT4

static EventGroupHandle_t s_wifi_event_group;
static TimerHandle_t s_reconnect_timer;
static TaskHandle_t s_wifi_task_handle = NULL;

static int s_retry_num = 0;
static bool s_is_connected = false;
static bool s_ap_active = false;
// Scan results handling
static cJSON *s_scan_results_json = NULL;
static SemaphoreHandle_t s_scan_lock = NULL;
static bool s_scan_in_progress = false;
static char s_last_error[32] = "";
static int s_last_disconnect_reason = 0;

// --- Forward Declarations ---
static void initialise_mdns(void);
static void initialise_sntp(void);
static void wifi_event_handler(void *arg, esp_event_base_t event_base,
                               int32_t event_id, void *event_data);
static void reconnect_timer_callback(TimerHandle_t xTimer);
static void wifi_task(void *pvParameters);
static void update_scan_results(uint16_t ap_count, wifi_ap_record_t *ap_info);
static void process_start_ap(void);
static void process_stop_ap(void);

const char *wifi_manager_disconnect_reason_to_str(int reason) {
  switch (reason) {
  case WIFI_REASON_UNSPECIFIED:
    return "WIFI_REASON_UNSPECIFIED";
  case WIFI_REASON_AUTH_EXPIRE:
    return "WIFI_REASON_AUTH_EXPIRE";
  case WIFI_REASON_AUTH_LEAVE:
    return "WIFI_REASON_AUTH_LEAVE";
  case WIFI_REASON_ASSOC_EXPIRE:
    return "WIFI_REASON_ASSOC_EXPIRE";
  case WIFI_REASON_ASSOC_TOOMANY:
    return "WIFI_REASON_ASSOC_TOOMANY";
  case WIFI_REASON_NOT_AUTHED:
    return "WIFI_REASON_NOT_AUTHED";
  case WIFI_REASON_NOT_ASSOCED:
    return "WIFI_REASON_NOT_ASSOCED";
  case WIFI_REASON_ASSOC_LEAVE:
    return "WIFI_REASON_ASSOC_LEAVE";
  case WIFI_REASON_ASSOC_NOT_AUTHED:
    return "WIFI_REASON_ASSOC_NOT_AUTHED";
  case WIFI_REASON_4WAY_HANDSHAKE_TIMEOUT:
    return "WIFI_REASON_4WAY_HANDSHAKE_TIMEOUT";
  case WIFI_REASON_GROUP_KEY_UPDATE_TIMEOUT:
    return "WIFI_REASON_GROUP_KEY_UPDATE_TIMEOUT";
  case WIFI_REASON_802_1X_AUTH_FAILED:
    return "WIFI_REASON_802_1X_AUTH_FAILED";
  case WIFI_REASON_BEACON_TIMEOUT:
    return "WIFI_REASON_BEACON_TIMEOUT";
  case WIFI_REASON_NO_AP_FOUND:
    return "WIFI_REASON_NO_AP_FOUND";
  case WIFI_REASON_AUTH_FAIL:
    return "WIFI_REASON_AUTH_FAIL";
  case WIFI_REASON_ASSOC_FAIL:
    return "WIFI_REASON_ASSOC_FAIL";
  case WIFI_REASON_HANDSHAKE_TIMEOUT:
    return "WIFI_REASON_HANDSHAKE_TIMEOUT";
  case 0:
    return "";
  default:
    return "WIFI_REASON_UNKNOWN";
  }
}

// --- Implementación ---

static void initialise_mdns(void) {
  uint8_t mac[6];
  esp_base_mac_addr_get(mac);

  char hostname[32];
  snprintf(hostname, sizeof(hostname), "iot-%02x%02x%02x", mac[3], mac[4],
           mac[5]);

  char instance[64];
  snprintf(instance, sizeof(instance), "IOT Device %02X%02X%02X", mac[3],
           mac[4], mac[5]);

  ESP_ERROR_CHECK(mdns_init());
  ESP_ERROR_CHECK(mdns_hostname_set(hostname));
  ESP_ERROR_CHECK(mdns_instance_name_set(instance));

  mdns_txt_item_t serviceTxtData[] = {{"board", "esp32s3"}, {"u", "admin"}};

  ESP_ERROR_CHECK(
      mdns_service_add("IOT-Web", "_http", "_tcp", 80, serviceTxtData, 2));
  ESP_LOGI(TAG, "mDNS inicializado: %s.local", hostname);
}

static void initialise_sntp(void) {
  if (esp_sntp_enabled()) {
    return;
  }

  ESP_LOGI(TAG, "Inicializando SNTP");
  esp_sntp_setoperatingmode(SNTP_OPMODE_POLL);
  esp_sntp_setservername(0, "time.google.com");
  esp_sntp_setservername(1, "pool.ntp.org");
  esp_sntp_init();
}

static void reconnect_timer_callback(TimerHandle_t xTimer) {
  if (s_wifi_task_handle != NULL) {
    xTaskNotify(s_wifi_task_handle, WIFI_CMD_RECONNECT, eSetBits);
  }
}

static void wifi_event_handler(void *arg, esp_event_base_t event_base,
                               int32_t event_id, void *event_data) {
  if (event_base == WIFI_EVENT && event_id == WIFI_EVENT_STA_START) {
    if (s_wifi_task_handle != NULL) {
      // Verificar si hay credenciales cargadas en el config STA antes
      // de intentar conectar.
      wifi_config_t current_config = {0};
      if (esp_wifi_get_config(WIFI_IF_STA, &current_config) == ESP_OK) {
        if (strlen((char *)current_config.sta.ssid) > 0) {
          xTaskNotify(s_wifi_task_handle, WIFI_CMD_CONNECT, eSetBits);
        }
      }
    }
  } else if (event_base == WIFI_EVENT &&
             event_id == WIFI_EVENT_STA_DISCONNECTED) {
    wifi_event_sta_disconnected_t *disconn =
        (wifi_event_sta_disconnected_t *)event_data;
    ESP_LOGW(TAG, "WiFi Disconnected. Reason: %d", disconn->reason);
    s_last_disconnect_reason = disconn->reason;

    if (disconn->reason == WIFI_REASON_AUTH_FAIL ||
        disconn->reason == WIFI_REASON_4WAY_HANDSHAKE_TIMEOUT) {
      strlcpy(s_last_error, "AUTH_FAIL", sizeof(s_last_error));
    } else if (disconn->reason == WIFI_REASON_NO_AP_FOUND) {
      strlcpy(s_last_error, "NOT_FOUND", sizeof(s_last_error));
    } else {
      strlcpy(s_last_error, "DISCONNECTED", sizeof(s_last_error));
    }

    s_is_connected = false;
    led_set_wifi_connected(false);
    xEventGroupClearBits(s_wifi_event_group, WIFI_CONNECTED_BIT);

    // Si no estamos escaneando, intentar reconectar
    if (!s_scan_in_progress) {
      s_retry_num++;
      uint32_t delay_ms = 5000;
      if (s_retry_num > 10)
        delay_ms = 60000;
      else if (s_retry_num > 6)
        delay_ms = 30000;
      else if (s_retry_num > 3)
        delay_ms = 15000;

      ESP_LOGW(TAG, "Desconectado. Reintento %d en %lu ms", s_retry_num,
               delay_ms);
      xTimerChangePeriod(s_reconnect_timer, pdMS_TO_TICKS(delay_ms), 0);
      xTimerStart(s_reconnect_timer, 0);
    } else {
      ESP_LOGI(
          TAG,
          "Desconectado durante escaneo, no se programa reconexión inmediata.");
    }

  } else if (event_base == IP_EVENT && event_id == IP_EVENT_STA_GOT_IP) {
    ip_event_got_ip_t *event = (ip_event_got_ip_t *)event_data;
    ESP_LOGI(TAG, "Conectado! IP: " IPSTR, IP2STR(&event->ip_info.ip));
    s_retry_num = 0;
    s_is_connected = true;
    led_set_wifi_connected(true);
    s_last_error[0] = '\0'; // Clear error on success
    s_last_disconnect_reason = 0;

    // Confirmar y persistir configuración en NVS ahora que sabemos que funciona
    wifi_config_t current_config;
    if (esp_wifi_get_config(WIFI_IF_STA, &current_config) == ESP_OK) {
      ESP_LOGI(TAG, "Conexión confirmada. Persistiendo configuración en NVS.");
      nvs_handle_t nvs_h;
      esp_err_t nvs_err = nvs_open("wifi_prefs", NVS_READWRITE, &nvs_h);
      if (nvs_err == ESP_OK) {
        nvs_set_str(nvs_h, "sta_ssid", (char *)current_config.sta.ssid);
        nvs_set_str(nvs_h, "sta_pass", (char *)current_config.sta.password);
        nvs_err = nvs_commit(nvs_h);
        if (nvs_err != ESP_OK) {
          ESP_LOGE(TAG, "NVS commit fallo al persistir WiFi err=%s",
                   esp_err_to_name(nvs_err));
        }
        nvs_close(nvs_h);
      } else {
        ESP_LOGW(TAG, "NVS open fallo al persistir WiFi err=%s",
                 esp_err_to_name(nvs_err));
      }
    }

    xTimerStop(s_reconnect_timer, 0);
    xEventGroupSetBits(s_wifi_event_group, WIFI_CONNECTED_BIT);
    initialise_sntp();
  }
}

static void update_scan_results(uint16_t ap_count, wifi_ap_record_t *ap_info) {
  if (s_scan_lock == NULL)
    return;

  xSemaphoreTake(s_scan_lock, portMAX_DELAY);

  if (s_scan_results_json != NULL) {
    cJSON_Delete(s_scan_results_json);
  }

  s_scan_results_json = cJSON_CreateArray();
  for (int i = 0; i < ap_count; i++) {
    cJSON *item = cJSON_CreateObject();
    cJSON_AddStringToObject(item, "ssid", (char *)ap_info[i].ssid);
    cJSON_AddNumberToObject(item, "rssi", ap_info[i].rssi);
    cJSON_AddNumberToObject(item, "auth", ap_info[i].authmode);
    cJSON_AddItemToArray(s_scan_results_json, item);
  }

  xSemaphoreGive(s_scan_lock);
}

static void wifi_task(void *pvParameters) {
  uint32_t ulNotificationValue;

  while (1) {
    if (xTaskNotifyWait(0, 0xFFFFFFFF, &ulNotificationValue, portMAX_DELAY) ==
        pdTRUE) {

      if (ulNotificationValue & WIFI_CMD_CONNECT) {
        ESP_LOGI(TAG, "Comando recibido: CONNECT");
        s_last_error[0] = '\0';
        s_retry_num = 0;
        esp_wifi_connect();
      }

      if (ulNotificationValue & WIFI_CMD_RECONNECT) {
        ESP_LOGI(TAG, "Comando recibido: RECONNECT (Timer expired)");
        esp_wifi_connect();
      }

      if (ulNotificationValue & WIFI_CMD_START_AP) {
        process_start_ap();
      }

      if (ulNotificationValue & WIFI_CMD_STOP_AP) {
        process_stop_ap();
      }

      if (ulNotificationValue & WIFI_CMD_SCAN) {
        ESP_LOGI(TAG, "Iniciando escaneo WiFi...");
        s_scan_in_progress = true;

        wifi_scan_config_t scan_config = {
            .ssid = 0, .bssid = 0, .channel = 0, .show_hidden = true};

        esp_err_t ret =
            esp_wifi_scan_start(&scan_config, true); // Blocking scan
        if (ret == ESP_OK) {
          uint16_t ap_count = 0;
          esp_wifi_scan_get_ap_num(&ap_count);
          wifi_ap_record_t *ap_info =
              (wifi_ap_record_t *)malloc(sizeof(wifi_ap_record_t) * ap_count);

          if (ap_info) {
            ESP_ERROR_CHECK(esp_wifi_scan_get_ap_records(&ap_count, ap_info));
            ESP_LOGI(TAG, "Escaneo completado. Encontrados %d APs:", ap_count);

            // Actualizar buffer de resultados
            update_scan_results(ap_count, ap_info);

            for (int i = 0; i < ap_count; i++) {
              ESP_LOGD(TAG, "SSID: %s, RSSI: %d, Authmode: %d", ap_info[i].ssid,
                       ap_info[i].rssi, ap_info[i].authmode);
            }
            free(ap_info);
          } else {
            ESP_LOGE(TAG,
                     "Error al reservar memoria para resultados de escaneo");
          }
        } else {
          ESP_LOGE(TAG, "Error iniciando escaneo: %s", esp_err_to_name(ret));
        }

        s_scan_in_progress = false;
        // Si estábamos desconectados, el evento de fin de escaneo podría
        // gatillar reconexión si fuera necesario Por simplicidad, si estábamos
        // en medio de backoff, esto podría necesitar ajuste.
      }
    }
  }
}

esp_err_t wifi_manager_init(void) {
  s_wifi_event_group = xEventGroupCreate();
  s_scan_lock = xSemaphoreCreateMutex();
  s_reconnect_timer = xTimerCreate("WiFiReconnect", pdMS_TO_TICKS(5000),
                                   pdFALSE, NULL, reconnect_timer_callback);

  ESP_ERROR_CHECK(esp_netif_init());
  ESP_ERROR_CHECK(esp_event_loop_create_default());

  esp_netif_create_default_wifi_sta();
  esp_netif_create_default_wifi_ap();

  wifi_init_config_t cfg = WIFI_INIT_CONFIG_DEFAULT();
  ESP_ERROR_CHECK(esp_wifi_init(&cfg));

  esp_event_handler_instance_t instance_any_id;
  esp_event_handler_instance_t instance_got_ip;
  ESP_ERROR_CHECK(esp_event_handler_instance_register(
      WIFI_EVENT, ESP_EVENT_ANY_ID, &wifi_event_handler, NULL,
      &instance_any_id));
  ESP_ERROR_CHECK(esp_event_handler_instance_register(
      IP_EVENT, IP_EVENT_STA_GOT_IP, &wifi_event_handler, NULL,
      &instance_got_ip));

  xTaskCreate(wifi_task, "wifi_task", 8192, NULL, 6, &s_wifi_task_handle);

  // SIEMPRE usar RAM para almacenamiento interno de esp_wifi.
  // Nosotros manejamos la persistencia con NVS manualmente.
  esp_wifi_set_storage(WIFI_STORAGE_RAM);

#undef DEFAULT_WIFI_SSID
#define DEFAULT_WIFI_SSID ""
#undef DEFAULT_WIFI_PASS
#define DEFAULT_WIFI_PASS ""

  // Cargar configuración desde NVS manualmente
  wifi_config_t wifi_config_sta = {0};
  nvs_handle_t nvs_h;
  bool has_saved_config = false;

  if (nvs_open("wifi_prefs", NVS_READONLY, &nvs_h) == ESP_OK) {
    char ssid[33] = {0};
    char pass[65] = {0};
    size_t s_len = sizeof(ssid);
    size_t p_len = sizeof(pass);

    if (nvs_get_str(nvs_h, "sta_ssid", ssid, &s_len) == ESP_OK) {
      strlcpy((char *)wifi_config_sta.sta.ssid, ssid,
              sizeof(wifi_config_sta.sta.ssid));
      if (nvs_get_str(nvs_h, "sta_pass", pass, &p_len) == ESP_OK) {
        strlcpy((char *)wifi_config_sta.sta.password, pass,
                sizeof(wifi_config_sta.sta.password));
      }
      has_saved_config = true;
      ESP_LOGI(TAG, "Configuración WiFi cargada de NVS: %s", ssid);
    }
    nvs_close(nvs_h);
  }

  ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_STA));

  if (has_saved_config) {
    ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_STA, &wifi_config_sta));
  } else {
    ESP_LOGI(TAG, "No hay configuración WiFi en NVS.");
  }

  ESP_ERROR_CHECK(esp_wifi_start());

  // NOTA: Eliminamos la llamada directa a wifi_connect aquí para evitar doble
  // conexión. El evento WIFI_EVENT_STA_START disparará el comando de conexión
  // si hay credenciales.

  ESP_LOGI(TAG, "WiFi inicializado en modo STA.");
  if (!has_saved_config) {
    ESP_LOGW(TAG, "No hay credenciales STA configuradas. Iniciando Modo AP "
                  "automáticamente (First Boot).");
    xTaskNotify(s_wifi_task_handle, WIFI_CMD_START_AP, eSetBits);
  }

  initialise_mdns();

  return ESP_OK;
}

bool wifi_manager_is_connected(void) { return s_is_connected; }

bool wifi_manager_is_ap_active(void) { return s_ap_active; }

const char *wifi_manager_get_last_error(void) { return s_last_error; }

int wifi_manager_get_last_disconnect_reason(void) {
  return s_last_disconnect_reason;
}

void wifi_manager_start_ap(void) {
  if (s_wifi_task_handle != NULL) {
    xTaskNotify(s_wifi_task_handle, WIFI_CMD_START_AP, eSetBits);
  }
}

static void process_start_ap(void) {
  if (s_ap_active) {
    ESP_LOGI(TAG, "AP ya está activo");
    return;
  }

  ESP_LOGI(TAG, "Activando Modo AP Manual...");

  uint8_t mac_addr[6] = {0};
  esp_base_mac_addr_get(mac_addr);

  char ap_ssid[32];
  char ap_pass[16];

  snprintf(ap_ssid, sizeof(ap_ssid), "%s%02X%02X%02X%02X",
           DEFAULT_AP_SSID_PREFIX, mac_addr[2], mac_addr[3], mac_addr[4],
           mac_addr[5]);

  snprintf(ap_pass, sizeof(ap_pass), "%02X%02X%02X%02X", mac_addr[2],
           mac_addr[3], mac_addr[4], mac_addr[5]);

  wifi_config_t wifi_config_ap = {
      .ap =
          {
              .channel = DEFAULT_AP_CHANNEL,
              .max_connection = DEFAULT_AP_MAX_CONN,
              .authmode = WIFI_AUTH_WPA_WPA2_PSK,
              .pmf_cfg = {.required = false},
          },
  };

  strlcpy((char *)wifi_config_ap.ap.ssid, ap_ssid,
          sizeof(wifi_config_ap.ap.ssid));
  strlcpy((char *)wifi_config_ap.ap.password, ap_pass,
          sizeof(wifi_config_ap.ap.password));
  wifi_config_ap.ap.ssid_len = strlen(ap_ssid);

  ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_APSTA));
  ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_AP, &wifi_config_ap));

  ESP_LOGI(TAG, "Modo AP Activado");
  ESP_LOGI(TAG, "SSID: %s", ap_ssid);
  ESP_LOGI(TAG, "PASS: %s", ap_pass);

  s_ap_active = true;
  led_set_ap_active(true);
}

void wifi_manager_stop_ap(void) {
  if (s_wifi_task_handle != NULL) {
    xTaskNotify(s_wifi_task_handle, WIFI_CMD_STOP_AP, eSetBits);
  }
}

static void process_stop_ap(void) {
  if (!s_ap_active)
    return;

  ESP_LOGI(TAG, "Desactivando Modo AP...");
  ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_STA));
  s_ap_active = false;
  led_set_ap_active(false);
}

void wifi_manager_scan(void) {
  if (s_wifi_task_handle != NULL) {
    xTaskNotify(s_wifi_task_handle, WIFI_CMD_SCAN, eSetBits);
  }
}

char *wifi_manager_get_scan_results_json(void) {
  if (s_scan_lock == NULL)
    return strdup("[]");

  char *json_str = NULL;
  xSemaphoreTake(s_scan_lock, portMAX_DELAY);
  if (s_scan_results_json != NULL) {
    json_str = cJSON_PrintUnformatted(s_scan_results_json);
  } else {
    json_str = strdup("[]");
  }
  xSemaphoreGive(s_scan_lock);
  return json_str;
}

char *wifi_manager_get_status_json(void) {
  cJSON *root = cJSON_CreateObject();
  wifi_status_snapshot_t snapshot;
  if (wifi_manager_get_status_snapshot(&snapshot) == ESP_OK) {
    cJSON_AddBoolToObject(root, "connected", snapshot.connected);
    cJSON_AddBoolToObject(root, "ap_active", snapshot.ap_active);
    cJSON_AddNumberToObject(root, "rssi", snapshot.rssi_dbm);
    cJSON_AddStringToObject(root, "ssid", snapshot.ssid);
    cJSON_AddStringToObject(root, "ip", snapshot.ip);
    cJSON_AddStringToObject(root, "saved_ssid", snapshot.saved_ssid);
    cJSON_AddStringToObject(root, "last_error", snapshot.last_error);
    cJSON_AddNumberToObject(root, "last_disconnect_reason",
                            snapshot.last_disconnect_reason);
    cJSON_AddStringToObject(root, "last_disconnect_reason_name",
                            wifi_manager_disconnect_reason_to_str(
                                snapshot.last_disconnect_reason));
  }

  char *json_str = cJSON_PrintUnformatted(root);
  cJSON_Delete(root);
  return json_str;
}

esp_err_t wifi_manager_get_status_snapshot(wifi_status_snapshot_t *snapshot) {
  if (snapshot == NULL) {
    return ESP_ERR_INVALID_ARG;
  }

  memset(snapshot, 0, sizeof(*snapshot));
  snapshot->connected = s_is_connected;
  snapshot->ap_active = s_ap_active;
  snapshot->rssi_dbm = wifi_manager_get_rssi();
  snapshot->last_disconnect_reason = s_last_disconnect_reason;
  strlcpy(snapshot->ssid, wifi_manager_get_ssid(), sizeof(snapshot->ssid));
  strlcpy(snapshot->ip, wifi_manager_get_ip(), sizeof(snapshot->ip));
  strlcpy(snapshot->last_error, s_last_error, sizeof(snapshot->last_error));
  if (wifi_manager_get_saved_config(snapshot->saved_ssid,
                                    sizeof(snapshot->saved_ssid)) != ESP_OK) {
    snapshot->saved_ssid[0] = '\0';
  }

  return ESP_OK;
}

esp_err_t wifi_manager_set_config(const char *ssid, const char *password) {
  if (ssid == NULL)
    return ESP_ERR_INVALID_ARG;

  // Clear last error and reset connection state before starting new attempt
  s_last_error[0] = '\0';
  s_retry_num = 0;
  if (s_reconnect_timer != NULL) {
    xTimerStop(s_reconnect_timer, 0);
  }

  wifi_config_t wifi_config;
  memset(&wifi_config, 0, sizeof(wifi_config_t));

  wifi_config.sta.threshold.authmode = WIFI_AUTH_WPA2_PSK;
  wifi_config.sta.pmf_cfg.capable = true;
  wifi_config.sta.pmf_cfg.required = false;

  strlcpy((char *)wifi_config.sta.ssid, ssid, sizeof(wifi_config.sta.ssid));
  if (password) {
    strlcpy((char *)wifi_config.sta.password, password,
            sizeof(wifi_config.sta.password));
  }

  ESP_LOGI(TAG, "Probando nueva configuración WiFi SSID: %s (sin persistir)",
           ssid);

  esp_err_t err = esp_wifi_set_config(WIFI_IF_STA, &wifi_config);
  if (err != ESP_OK) {
    ESP_LOGE(TAG, "Error al aplicar configuración WiFi: %s",
             esp_err_to_name(err));
    return err;
  }

  // Intentar conectar con la nueva configuración
  if (s_wifi_task_handle != NULL) {
    xTaskNotify(s_wifi_task_handle, WIFI_CMD_CONNECT, eSetBits);
  }

  return ESP_OK;
}

esp_err_t wifi_manager_clear_config(void) {
  // Configuración STA vacía
  wifi_config_t wifi_config_sta = {
      .sta =
          {
              .ssid = "",
              .password = "",
          },
  };

  // Desconectar primero
  if (s_wifi_task_handle != NULL) {
    if (s_is_connected) {
      esp_wifi_disconnect();
    }
  }

  // Borrar configuración en NVS
  ESP_LOGI(TAG, "Borrando configuración WiFi STA de NVS...");
  s_last_error[0] = '\0';
  s_last_disconnect_reason = 0;
  nvs_handle_t nvs_h;
  esp_err_t nvs_err = nvs_open("wifi_prefs", NVS_READWRITE, &nvs_h);
  if (nvs_err == ESP_OK) {
    nvs_erase_key(nvs_h, "sta_ssid");
    nvs_erase_key(nvs_h, "sta_pass");
    nvs_err = nvs_commit(nvs_h);
    if (nvs_err != ESP_OK) {
      ESP_LOGE(TAG, "NVS commit fallo al borrar WiFi err=%s",
               esp_err_to_name(nvs_err));
    }
    nvs_close(nvs_h);
  } else {
    ESP_LOGW(TAG, "NVS open fallo al borrar WiFi err=%s",
             esp_err_to_name(nvs_err));
  }

  // Limpiar configuración en RAM
  ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_STA, &wifi_config_sta));

  // Volver a modo AP
  wifi_manager_start_ap();

  return ESP_OK;
}

esp_err_t wifi_manager_get_saved_config(char *ssid, size_t max_len) {
  if (ssid == NULL || max_len == 0)
    return ESP_ERR_INVALID_ARG;

  nvs_handle_t nvs_h;
  esp_err_t err = nvs_open("wifi_prefs", NVS_READONLY, &nvs_h);
  if (err == ESP_OK) {
    size_t required_size = max_len;
    err = nvs_get_str(nvs_h, "sta_ssid", ssid, &required_size);
    nvs_close(nvs_h);
    if (err == ESP_OK && strlen(ssid) > 0) {
      return ESP_OK;
    }
  }

  ssid[0] = '\0';
  return ESP_FAIL; // No hay config guardada
}

int wifi_manager_get_rssi(void) {
  if (!s_is_connected)
    return 0;
  wifi_ap_record_t ap_info;
  if (esp_wifi_sta_get_ap_info(&ap_info) == ESP_OK) {
    return ap_info.rssi;
  }
  return 0;
}

const char *wifi_manager_get_ssid(void) {
  static char ssid[33];
  if (!s_is_connected)
    return "";
  wifi_ap_record_t ap_info;
  if (esp_wifi_sta_get_ap_info(&ap_info) == ESP_OK) {
    strlcpy(ssid, (char *)ap_info.ssid, sizeof(ssid));
    return ssid;
  }
  return "";
}

const char *wifi_manager_get_ip(void) {
  static char ip_str[16];
  if (!s_is_connected)
    return "";
  esp_netif_ip_info_t ip_info;
  esp_netif_t *netif = esp_netif_get_handle_from_ifkey("WIFI_STA_DEF");
  if (netif && esp_netif_get_ip_info(netif, &ip_info) == ESP_OK) {
    snprintf(ip_str, sizeof(ip_str), IPSTR, IP2STR(&ip_info.ip));
    return ip_str;
  }
  return "";
}
