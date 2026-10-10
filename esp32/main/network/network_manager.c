/*
 * network_manager.c
 */

#include "network_manager.h"

#include "esp_log.h"
#include "esp_sntp.h"
#include <string.h>
#include <time.h>

#include "wifi_manager.h"

static const char *TAG = "NET_MGR";

static void ensure_time_sync_service_started(void) {
  if (esp_sntp_enabled()) {
    return;
  }

  ESP_LOGI(TAG, "Starting SNTP");
  esp_sntp_setoperatingmode(SNTP_OPMODE_POLL);
  esp_sntp_setservername(0, "time.google.com");
  esp_sntp_setservername(1, "pool.ntp.org");
  esp_sntp_init();
}

esp_err_t network_manager_init(void) {
  ensure_time_sync_service_started();
  return ESP_OK;
}

bool network_manager_has_data_path(void) {
  const char *ip = wifi_manager_get_ip();
  return wifi_manager_is_connected() && ip != NULL && ip[0] != '\0' &&
         strcmp(ip, "0.0.0.0") != 0;
}

bool network_manager_is_time_synced(void) {
  time_t now;
  struct tm timeinfo;

  time(&now);
  gmtime_r(&now, &timeinfo);
  return timeinfo.tm_year >= (2024 - 1900);
}
