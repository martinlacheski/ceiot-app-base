/*
 * cellular_manager.h
 *
 * Gestión celular con esp_modem + PPPoS para A7670SA
 */

#ifndef CELLULAR_MANAGER_H
#define CELLULAR_MANAGER_H

#include "esp_err.h"
#include "cellular_ppp_stability.h"
#include <stdbool.h>
#include <stddef.h>

typedef enum {
  CELLULAR_PPP_PHASE_DISABLED = 0,
  CELLULAR_PPP_PHASE_IDLE,
  CELLULAR_PPP_PHASE_STARTING,
  CELLULAR_PPP_PHASE_NEGOTIATING,
  CELLULAR_PPP_PHASE_RUNNING,
  CELLULAR_PPP_PHASE_STOPPING,
  CELLULAR_PPP_PHASE_FAILED,
} cellular_ppp_phase_t;

typedef struct {
  bool enabled;
  bool modem_alive;
  bool sim_ready;
  bool registered;
  bool attached;
  bool ppp_up;
  cellular_ppp_phase_t ppp_phase;
  int rssi_dbm;
  int registration_status_code;
  int attach_status_code;
  int last_ppp_event_id;
  cellular_ppp_fsm_state_t ppp_fsm_state;
  cellular_ppp_failure_code_t last_failure_code;
  uint32_t failure_total_count;
  uint32_t failure_consecutive_count;
  uint32_t diagnostics_dropped_count;
  unsigned int registration_retry_count;
  unsigned int ppp_retry_count;
  char operator_name[32];
  char ip[16];
  char dns_primary[16];
  char dns_secondary[16];
  char last_ppp_event[48];
  char apn[64];
  char user[64];
  char pass[64];
  char last_error[64];
} cellular_status_snapshot_t;

esp_err_t cellular_manager_init(void);

void cellular_manager_set_enabled(bool enabled);
bool cellular_manager_is_enabled(void);

bool cellular_manager_is_registered(void);
bool cellular_manager_is_modem_alive(void);
bool cellular_manager_is_attached(void);
bool cellular_manager_is_ppp_up(void);
bool cellular_manager_has_data_path(void);
cellular_ppp_phase_t cellular_manager_get_ppp_phase(void);
const char *cellular_manager_get_last_error(void);
esp_err_t cellular_manager_get_status_snapshot(
    cellular_status_snapshot_t *snapshot);
const char *cellular_manager_ppp_phase_to_str(cellular_ppp_phase_t phase);

int cellular_manager_get_rssi_dbm(void);
const char *cellular_manager_get_operator(void);

esp_err_t cellular_manager_set_apn_config(const char *apn, const char *user,
                                          const char *pass);
esp_err_t cellular_manager_get_apn_config(char *apn, size_t apn_len, char *user,
                                          size_t user_len, char *pass,
                                          size_t pass_len);

size_t cellular_manager_get_diagnostics(cellular_ppp_diag_entry_t *entries,
                                        size_t max_entries,
                                        uint32_t *dropped_count);

char *cellular_manager_get_status_json(void);

#endif // CELLULAR_MANAGER_H
