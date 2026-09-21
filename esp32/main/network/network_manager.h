/*
 * network_manager.h
 *
 * Selección de enlace activo entre WiFi y celular.
 */

#ifndef NETWORK_MANAGER_H
#define NETWORK_MANAGER_H

#include "esp_err.h"
#include <stdbool.h>

typedef enum {
  NETWORK_MODE_WIFI_FIRST = 0,
  NETWORK_MODE_CELLULAR_FIRST,
  NETWORK_MODE_WIFI_ONLY,
  NETWORK_MODE_CELLULAR_ONLY,
} network_mode_t;

typedef enum {
  NETWORK_LINK_NONE = 0,
  NETWORK_LINK_WIFI,
  NETWORK_LINK_CELLULAR,
} network_link_t;

typedef struct {
  network_mode_t mode;
  network_link_t active_link;
  network_link_t preferred_link;
  bool online;
  bool wifi_allowed;
  bool cellular_allowed;
  bool wifi_reachable;
  bool cellular_reachable;
  bool fallback_in_use;
  bool time_synced;
  char decision_reason[64];
} network_status_snapshot_t;

esp_err_t network_manager_init(void);

network_mode_t network_manager_get_mode(void);
esp_err_t network_manager_set_mode(network_mode_t mode);

network_link_t network_manager_get_active_link(void);
bool network_manager_is_online(void);
bool network_manager_has_data_path(void);
bool network_manager_is_time_synced(void);
esp_err_t network_manager_get_status_snapshot(
    network_status_snapshot_t *snapshot);

const char *network_manager_mode_to_str(network_mode_t mode);
network_mode_t network_manager_mode_from_str(const char *mode_str);
const char *network_manager_link_to_str(network_link_t link);

char *network_manager_get_status_json(void);

#endif // NETWORK_MANAGER_H
