#ifndef CELLULAR_PPP_STABILITY_H
#define CELLULAR_PPP_STABILITY_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

typedef enum {
  CELLULAR_PPP_FAIL_NONE = 0,
  CELLULAR_PPP_FAIL_MODEM_NO_RESPONSE,
  CELLULAR_PPP_FAIL_MODEM_CREATE,
  CELLULAR_PPP_FAIL_SIM_NOT_READY,
  CELLULAR_PPP_FAIL_NOT_REGISTERED,
  CELLULAR_PPP_FAIL_NOT_ATTACHED,
  CELLULAR_PPP_FAIL_APN_CONFIG,
  CELLULAR_PPP_FAIL_START,
  CELLULAR_PPP_FAIL_LOST_IP,
  CELLULAR_PPP_FAIL_INTERNAL,
  CELLULAR_PPP_FAIL_COUNT,
} cellular_ppp_failure_code_t;

typedef struct {
  uint32_t total;
  uint32_t consecutive;
  uint32_t per_code[CELLULAR_PPP_FAIL_COUNT];
  cellular_ppp_failure_code_t last_code;
  uint32_t last_timestamp_ms;
} cellular_ppp_failure_counters_t;

void cellular_ppp_failure_counters_reset(cellular_ppp_failure_counters_t *counters);
void cellular_ppp_failure_record(cellular_ppp_failure_counters_t *counters,
                                 cellular_ppp_failure_code_t code,
                                 uint32_t timestamp_ms);
void cellular_ppp_failure_mark_recovered(cellular_ppp_failure_counters_t *counters);
const char *cellular_ppp_failure_code_to_str(cellular_ppp_failure_code_t code);

typedef enum {
  CELLULAR_PPP_FSM_DISABLED = 0,
  CELLULAR_PPP_FSM_IDLE,
  CELLULAR_PPP_FSM_STARTING,
  CELLULAR_PPP_FSM_NEGOTIATING,
  CELLULAR_PPP_FSM_RUNNING,
  CELLULAR_PPP_FSM_STOPPING,
  CELLULAR_PPP_FSM_FAILED,
  CELLULAR_PPP_FSM_COUNT,
} cellular_ppp_fsm_state_t;

typedef enum {
  CELLULAR_PPP_EVT_ENABLE = 0,
  CELLULAR_PPP_EVT_DISABLE,
  CELLULAR_PPP_EVT_START_REQUEST,
  CELLULAR_PPP_EVT_STOP_REQUEST,
  CELLULAR_PPP_EVT_PHASE_INITIALIZE,
  CELLULAR_PPP_EVT_PHASE_NEGOTIATING,
  CELLULAR_PPP_EVT_PHASE_RUNNING,
  CELLULAR_PPP_EVT_PHASE_TERMINATE,
  CELLULAR_PPP_EVT_IP_LOST,
  CELLULAR_PPP_EVT_ERROR,
  CELLULAR_PPP_EVT_RESET,
  CELLULAR_PPP_EVT_COUNT,
} cellular_ppp_fsm_event_t;

typedef struct {
  bool valid;
  bool changed;
  cellular_ppp_fsm_state_t from;
  cellular_ppp_fsm_state_t to;
  cellular_ppp_fsm_event_t event;
} cellular_ppp_fsm_transition_t;

cellular_ppp_fsm_transition_t cellular_ppp_fsm_apply(
    cellular_ppp_fsm_state_t current, cellular_ppp_fsm_event_t event);
const char *cellular_ppp_fsm_state_to_str(cellular_ppp_fsm_state_t state);
const char *cellular_ppp_fsm_event_to_str(cellular_ppp_fsm_event_t event);

typedef enum {
  CELLULAR_PPP_DIAG_INFO = 0,
  CELLULAR_PPP_DIAG_WARN,
  CELLULAR_PPP_DIAG_ERROR,
} cellular_ppp_diag_level_t;

typedef struct {
  uint32_t timestamp_ms;
  cellular_ppp_diag_level_t level;
  cellular_ppp_fsm_state_t from_state;
  cellular_ppp_fsm_state_t to_state;
  cellular_ppp_fsm_event_t event;
  cellular_ppp_failure_code_t failure_code;
  char detail[80];
} cellular_ppp_diag_entry_t;

typedef struct {
  cellular_ppp_diag_entry_t *storage;
  size_t capacity;
  size_t next_index;
  size_t size;
  uint32_t dropped;
} cellular_ppp_diag_ring_t;

typedef struct {
  uint32_t boot_guard_ms;
  uint32_t power_on_ready_window_ms;
  uint32_t pwrkey_pulse_ms;
  uint32_t at_command_timeout_ms;
  uint32_t at_retry_interval_ms;
  uint32_t at_max_retries;
  uint32_t status_poll_ms;
  uint32_t disabled_poll_ms;
  uint32_t csq_timeout_ms;
  uint32_t cops_timeout_ms;
} cellular_ppp_timing_profile_t;

typedef enum {
  CELLULAR_PPP_HW_PRECHECK_OK = 0,
  CELLULAR_PPP_HW_PRECHECK_UART_PORT_INVALID,
  CELLULAR_PPP_HW_PRECHECK_UART_TX_INVALID,
  CELLULAR_PPP_HW_PRECHECK_UART_RX_INVALID,
  CELLULAR_PPP_HW_PRECHECK_UART_PINS_CONFLICT,
  CELLULAR_PPP_HW_PRECHECK_PWRKEY_INVALID,
  CELLULAR_PPP_HW_PRECHECK_SLEEP_INVALID,
  CELLULAR_PPP_HW_PRECHECK_BAUD_INVALID,
} cellular_ppp_hw_precheck_result_t;

const cellular_ppp_timing_profile_t *cellular_ppp_timing_profile_default(void);
cellular_ppp_hw_precheck_result_t cellular_ppp_hw_precheck(
    int uart_port, int tx_gpio, int rx_gpio, int pwrkey_gpio, int sleep_gpio,
    int baud_rate);
const char *cellular_ppp_hw_precheck_result_to_str(
    cellular_ppp_hw_precheck_result_t result);

void cellular_ppp_diag_ring_init(cellular_ppp_diag_ring_t *ring,
                                 cellular_ppp_diag_entry_t *storage,
                                 size_t capacity);
bool cellular_ppp_diag_ring_push(cellular_ppp_diag_ring_t *ring,
                                 const cellular_ppp_diag_entry_t *entry);
size_t cellular_ppp_diag_ring_size(const cellular_ppp_diag_ring_t *ring);
uint32_t cellular_ppp_diag_ring_dropped(const cellular_ppp_diag_ring_t *ring);
bool cellular_ppp_diag_ring_get_latest(const cellular_ppp_diag_ring_t *ring,
                                       size_t newest_offset,
                                       cellular_ppp_diag_entry_t *out);

#endif
