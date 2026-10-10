/*
 * network_manager.c
 */

#include "network_manager.h"

#include <string.h>
#include <time.h>

#include "wifi_manager.h"

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
