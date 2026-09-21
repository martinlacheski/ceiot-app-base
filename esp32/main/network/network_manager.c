/*
 * network_manager.c
 */

#include "network_manager.h"

#include "cJSON.h"
#include "esp_log.h"
#include "esp_sntp.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "nvs.h"
#include "nvs_flash.h"
#include <string.h>
#include <time.h>

#include "cellular_manager.h"
#include "wifi_manager.h"

static const char *TAG = "NET_MGR";

static SemaphoreHandle_t s_lock = NULL;
static network_mode_t s_mode = NETWORK_MODE_WIFI_FIRST;

static void ensure_time_sync_service_started(void) {
  if (esp_sntp_enabled()) {
    return;
  }

  ESP_LOGI(TAG, "Inicializando SNTP compartido para WiFi/celular");
  esp_sntp_setoperatingmode(SNTP_OPMODE_POLL);
  esp_sntp_setservername(0, "time.google.com");
  esp_sntp_setservername(1, "pool.ntp.org");
  esp_sntp_init();
}

static bool has_valid_ip(const char *ip) {
  return ip != NULL && ip[0] != '\0' && strcmp(ip, "0.0.0.0") != 0;
}

static bool wifi_has_data_path(void) {
  return wifi_manager_is_connected() && has_valid_ip(wifi_manager_get_ip());
}

static bool cellular_has_data_path(void) {
  return cellular_manager_has_data_path();
}

static network_link_t preferred_link_for_mode(network_mode_t mode) {
  switch (mode) {
  case NETWORK_MODE_CELLULAR_FIRST:
  case NETWORK_MODE_CELLULAR_ONLY:
    return NETWORK_LINK_CELLULAR;
  case NETWORK_MODE_WIFI_FIRST:
  case NETWORK_MODE_WIFI_ONLY:
  default:
    return NETWORK_LINK_WIFI;
  }
}

static void copy_decision_reason(char *dest, size_t dest_len,
                                 const char *reason) {
  if (dest == NULL || dest_len == 0) {
    return;
  }
  strlcpy(dest, reason ? reason : "", dest_len);
}

static void evaluate_network_selection(network_mode_t mode,
                                       bool wifi_reachable,
                                       bool cellular_reachable,
                                       network_status_snapshot_t *snapshot) {
  if (snapshot == NULL) {
    return;
  }

  memset(snapshot, 0, sizeof(*snapshot));
  snapshot->mode = mode;
  snapshot->preferred_link = preferred_link_for_mode(mode);
  snapshot->wifi_allowed = mode != NETWORK_MODE_CELLULAR_ONLY;
  snapshot->cellular_allowed = mode != NETWORK_MODE_WIFI_ONLY;
  snapshot->wifi_reachable = wifi_reachable;
  snapshot->cellular_reachable = cellular_reachable;
  snapshot->active_link = NETWORK_LINK_NONE;
  snapshot->time_synced = network_manager_is_time_synced();

  switch (mode) {
  case NETWORK_MODE_WIFI_ONLY:
    if (wifi_reachable) {
      snapshot->active_link = NETWORK_LINK_WIFI;
      copy_decision_reason(snapshot->decision_reason,
                           sizeof(snapshot->decision_reason),
                           "wifi_only_selected");
    } else {
      copy_decision_reason(snapshot->decision_reason,
                           sizeof(snapshot->decision_reason),
                           "wifi_only_no_reachability");
    }
    break;

  case NETWORK_MODE_CELLULAR_ONLY:
    if (cellular_reachable) {
      snapshot->active_link = NETWORK_LINK_CELLULAR;
      copy_decision_reason(snapshot->decision_reason,
                           sizeof(snapshot->decision_reason),
                           "cellular_only_selected");
    } else {
      copy_decision_reason(snapshot->decision_reason,
                           sizeof(snapshot->decision_reason),
                           "cellular_only_no_reachability");
    }
    break;

  case NETWORK_MODE_CELLULAR_FIRST:
    if (cellular_reachable) {
      snapshot->active_link = NETWORK_LINK_CELLULAR;
      copy_decision_reason(snapshot->decision_reason,
                           sizeof(snapshot->decision_reason),
                           "cellular_preferred_reachable");
    } else if (wifi_reachable) {
      snapshot->active_link = NETWORK_LINK_WIFI;
      snapshot->fallback_in_use = true;
      copy_decision_reason(snapshot->decision_reason,
                           sizeof(snapshot->decision_reason),
                           "cellular_unreachable_fallback_wifi");
    } else {
      copy_decision_reason(snapshot->decision_reason,
                           sizeof(snapshot->decision_reason),
                           "cellular_unreachable_wifi_unreachable");
    }
    break;

  case NETWORK_MODE_WIFI_FIRST:
  default:
    if (wifi_reachable) {
      snapshot->active_link = NETWORK_LINK_WIFI;
      copy_decision_reason(snapshot->decision_reason,
                           sizeof(snapshot->decision_reason),
                           "wifi_preferred_reachable");
    } else if (cellular_reachable) {
      snapshot->active_link = NETWORK_LINK_CELLULAR;
      snapshot->fallback_in_use = true;
      copy_decision_reason(snapshot->decision_reason,
                           sizeof(snapshot->decision_reason),
                           "wifi_unreachable_fallback_cellular");
    } else {
      copy_decision_reason(snapshot->decision_reason,
                           sizeof(snapshot->decision_reason),
                           "wifi_unreachable_cellular_unreachable");
    }
    break;
  }

  snapshot->online = snapshot->active_link != NETWORK_LINK_NONE;
}

static void load_mode_from_nvs(void) {
  nvs_handle_t nvs_h;
  if (nvs_open("storage", NVS_READONLY, &nvs_h) != ESP_OK) {
    return;
  }

  char mode_str[24] = "";
  size_t len = sizeof(mode_str);
  if (nvs_get_str(nvs_h, "network_mode", mode_str, &len) == ESP_OK) {
    s_mode = network_manager_mode_from_str(mode_str);
  }

  nvs_close(nvs_h);
}

static esp_err_t save_mode_to_nvs(network_mode_t mode) {
  nvs_handle_t nvs_h;
  esp_err_t err = nvs_open("storage", NVS_READWRITE, &nvs_h);
  if (err != ESP_OK) {
    return err;
  }

  err = nvs_set_str(nvs_h, "network_mode", network_manager_mode_to_str(mode));
  if (err == ESP_OK) {
    err = nvs_commit(nvs_h);
  }

  nvs_close(nvs_h);
  return err;
}

static void apply_mode(network_mode_t mode) {
  switch (mode) {
  case NETWORK_MODE_WIFI_ONLY:
    cellular_manager_set_enabled(false);
    break;
  case NETWORK_MODE_CELLULAR_ONLY:
    cellular_manager_set_enabled(true);
    break;
  case NETWORK_MODE_WIFI_FIRST:
  case NETWORK_MODE_CELLULAR_FIRST:
  default:
    cellular_manager_set_enabled(true);
    break;
  }
}

esp_err_t network_manager_init(void) {
  if (s_lock == NULL) {
    s_lock = xSemaphoreCreateMutex();
    if (s_lock == NULL) {
      return ESP_ERR_NO_MEM;
    }
  }

  load_mode_from_nvs();
  apply_mode(s_mode);
  ensure_time_sync_service_started();
  ESP_LOGI(TAG, "Modo de red inicial: %s", network_manager_mode_to_str(s_mode));
  return ESP_OK;
}

network_mode_t network_manager_get_mode(void) {
  network_mode_t mode;
  if (s_lock == NULL) {
    return s_mode;
  }
  xSemaphoreTake(s_lock, portMAX_DELAY);
  mode = s_mode;
  xSemaphoreGive(s_lock);
  return mode;
}

esp_err_t network_manager_set_mode(network_mode_t mode) {
  if (mode < NETWORK_MODE_WIFI_FIRST || mode > NETWORK_MODE_CELLULAR_ONLY) {
    return ESP_ERR_INVALID_ARG;
  }

  xSemaphoreTake(s_lock, portMAX_DELAY);
  s_mode = mode;
  xSemaphoreGive(s_lock);

  apply_mode(mode);
  ESP_LOGI(TAG, "Modo de red actualizado: %s", network_manager_mode_to_str(mode));
  return save_mode_to_nvs(mode);
}

network_link_t network_manager_get_active_link(void) {
  network_status_snapshot_t snapshot;
  if (network_manager_get_status_snapshot(&snapshot) != ESP_OK) {
    return NETWORK_LINK_NONE;
  }
  return snapshot.active_link;
}

bool network_manager_is_online(void) {
  network_status_snapshot_t snapshot;
  if (network_manager_get_status_snapshot(&snapshot) != ESP_OK) {
    return false;
  }
  return snapshot.online;
}

bool network_manager_has_data_path(void) { return network_manager_is_online(); }

bool network_manager_is_time_synced(void) {
  time_t now;
  struct tm timeinfo;

  time(&now);
  localtime_r(&now, &timeinfo);
  return timeinfo.tm_year >= (2024 - 1900);
}

esp_err_t network_manager_get_status_snapshot(
    network_status_snapshot_t *snapshot) {
  if (snapshot == NULL) {
    return ESP_ERR_INVALID_ARG;
  }

  network_mode_t mode = network_manager_get_mode();
  bool wifi_reachable = wifi_has_data_path();
  bool cellular_reachable = cellular_has_data_path();

  evaluate_network_selection(mode, wifi_reachable, cellular_reachable, snapshot);
  return ESP_OK;
}

const char *network_manager_mode_to_str(network_mode_t mode) {
  switch (mode) {
  case NETWORK_MODE_WIFI_FIRST:
    return "wifi_first";
  case NETWORK_MODE_CELLULAR_FIRST:
    return "cellular_first";
  case NETWORK_MODE_WIFI_ONLY:
    return "wifi_only";
  case NETWORK_MODE_CELLULAR_ONLY:
    return "cellular_only";
  default:
    return "wifi_first";
  }
}

network_mode_t network_manager_mode_from_str(const char *mode_str) {
  if (mode_str == NULL) {
    return NETWORK_MODE_WIFI_FIRST;
  }
  if (strcmp(mode_str, "wifi_first") == 0) {
    return NETWORK_MODE_WIFI_FIRST;
  }
  if (strcmp(mode_str, "cellular_first") == 0) {
    return NETWORK_MODE_CELLULAR_FIRST;
  }
  if (strcmp(mode_str, "wifi_only") == 0) {
    return NETWORK_MODE_WIFI_ONLY;
  }
  if (strcmp(mode_str, "cellular_only") == 0) {
    return NETWORK_MODE_CELLULAR_ONLY;
  }
  return NETWORK_MODE_WIFI_FIRST;
}

const char *network_manager_link_to_str(network_link_t link) {
  switch (link) {
  case NETWORK_LINK_WIFI:
    return "wifi";
  case NETWORK_LINK_CELLULAR:
    return "cellular";
  case NETWORK_LINK_NONE:
  default:
    return "none";
  }
}

char *network_manager_get_status_json(void) {
  cJSON *root = cJSON_CreateObject();
  if (!root) {
    return strdup("{}");
  }

  network_status_snapshot_t snapshot;
  if (network_manager_get_status_snapshot(&snapshot) != ESP_OK) {
    cJSON_Delete(root);
    return strdup("{}");
  }

  cJSON_AddStringToObject(root, "mode", network_manager_mode_to_str(snapshot.mode));
  cJSON_AddStringToObject(root, "preferred_link",
                          network_manager_link_to_str(snapshot.preferred_link));
  cJSON_AddStringToObject(root, "active_link",
                          network_manager_link_to_str(snapshot.active_link));
  cJSON_AddBoolToObject(root, "online", snapshot.online);
  cJSON_AddBoolToObject(root, "fallback_in_use", snapshot.fallback_in_use);
  cJSON_AddBoolToObject(root, "time_synced", snapshot.time_synced);
  cJSON_AddStringToObject(root, "decision_reason", snapshot.decision_reason);
  cJSON_AddStringToObject(root, "reason_code", snapshot.decision_reason);
  cJSON_AddBoolToObject(root, "wifi_allowed", snapshot.wifi_allowed);
  cJSON_AddBoolToObject(root, "cellular_allowed", snapshot.cellular_allowed);
  cJSON_AddBoolToObject(root, "wifi_reachable", snapshot.wifi_reachable);
  cJSON_AddBoolToObject(root, "cellular_reachable",
                        snapshot.cellular_reachable);
  cJSON_AddBoolToObject(root, "wifi_ready", snapshot.wifi_reachable);
  cJSON_AddBoolToObject(root, "cellular_ready", snapshot.cellular_reachable);
  cJSON_AddStringToObject(root, "wifi_last_error", wifi_manager_get_last_error());
  cJSON_AddStringToObject(root, "cellular_last_error",
                          cellular_manager_get_last_error());

  char *json = cJSON_PrintUnformatted(root);
  cJSON_Delete(root);
  if (!json) {
    return strdup("{}");
  }
  return json;
}
