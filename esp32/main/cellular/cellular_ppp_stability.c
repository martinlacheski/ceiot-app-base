#include "cellular_ppp_stability.h"

#include <string.h>

static const cellular_ppp_timing_profile_t s_timing_profile_default = {
    .boot_guard_ms = 12000,
    .power_on_ready_window_ms = 12000,
    .pwrkey_pulse_ms = 1500,
    .at_command_timeout_ms = 1500,
    .at_retry_interval_ms = 2000,
    .at_max_retries = 8,
    .status_poll_ms = 5000,
    .disabled_poll_ms = 1000,
    .csq_timeout_ms = 1200,
    .cops_timeout_ms = 1800,
};

static bool is_valid_gpio_number(int gpio_num) {
  return gpio_num >= 0;
}

static bool is_optional_gpio_number(int gpio_num) {
  return gpio_num < 0 || is_valid_gpio_number(gpio_num);
}

const cellular_ppp_timing_profile_t *cellular_ppp_timing_profile_default(void) {
  return &s_timing_profile_default;
}

cellular_ppp_hw_precheck_result_t cellular_ppp_hw_precheck(
    int uart_port, int tx_gpio, int rx_gpio, int pwrkey_gpio, int sleep_gpio,
    int baud_rate) {
  if (uart_port < 0 || uart_port > 2) {
    return CELLULAR_PPP_HW_PRECHECK_UART_PORT_INVALID;
  }
  if (!is_valid_gpio_number(tx_gpio)) {
    return CELLULAR_PPP_HW_PRECHECK_UART_TX_INVALID;
  }
  if (!is_valid_gpio_number(rx_gpio)) {
    return CELLULAR_PPP_HW_PRECHECK_UART_RX_INVALID;
  }
  if (tx_gpio == rx_gpio) {
    return CELLULAR_PPP_HW_PRECHECK_UART_PINS_CONFLICT;
  }
  if (!is_optional_gpio_number(pwrkey_gpio)) {
    return CELLULAR_PPP_HW_PRECHECK_PWRKEY_INVALID;
  }
  if (!is_optional_gpio_number(sleep_gpio)) {
    return CELLULAR_PPP_HW_PRECHECK_SLEEP_INVALID;
  }
  if ((pwrkey_gpio >= 0 && (pwrkey_gpio == tx_gpio || pwrkey_gpio == rx_gpio)) ||
      (sleep_gpio >= 0 && (sleep_gpio == tx_gpio || sleep_gpio == rx_gpio)) ||
      (pwrkey_gpio >= 0 && sleep_gpio >= 0 && pwrkey_gpio == sleep_gpio)) {
    return CELLULAR_PPP_HW_PRECHECK_UART_PINS_CONFLICT;
  }
  if (baud_rate < 9600 || baud_rate > 921600) {
    return CELLULAR_PPP_HW_PRECHECK_BAUD_INVALID;
  }
  return CELLULAR_PPP_HW_PRECHECK_OK;
}

const char *cellular_ppp_hw_precheck_result_to_str(
    cellular_ppp_hw_precheck_result_t result) {
  switch (result) {
  case CELLULAR_PPP_HW_PRECHECK_OK:
    return "ok";
  case CELLULAR_PPP_HW_PRECHECK_UART_PORT_INVALID:
    return "uart_port_invalido";
  case CELLULAR_PPP_HW_PRECHECK_UART_TX_INVALID:
    return "uart_tx_invalido";
  case CELLULAR_PPP_HW_PRECHECK_UART_RX_INVALID:
    return "uart_rx_invalido";
  case CELLULAR_PPP_HW_PRECHECK_UART_PINS_CONFLICT:
    return "pins_en_conflicto";
  case CELLULAR_PPP_HW_PRECHECK_PWRKEY_INVALID:
    return "pwrkey_invalido";
  case CELLULAR_PPP_HW_PRECHECK_SLEEP_INVALID:
    return "sleep_invalido";
  case CELLULAR_PPP_HW_PRECHECK_BAUD_INVALID:
    return "baud_invalido";
  default:
    return "desconocido";
  }
}

static const cellular_ppp_fsm_state_t s_transition_table[CELLULAR_PPP_FSM_COUNT]
                                                        [CELLULAR_PPP_EVT_COUNT] = {
    [CELLULAR_PPP_FSM_DISABLED] =
        {
            [CELLULAR_PPP_EVT_ENABLE] = CELLULAR_PPP_FSM_IDLE,
            [CELLULAR_PPP_EVT_DISABLE] = CELLULAR_PPP_FSM_DISABLED,
            [CELLULAR_PPP_EVT_RESET] = CELLULAR_PPP_FSM_DISABLED,
        },
    [CELLULAR_PPP_FSM_IDLE] =
        {
            [CELLULAR_PPP_EVT_ENABLE] = CELLULAR_PPP_FSM_IDLE,
            [CELLULAR_PPP_EVT_DISABLE] = CELLULAR_PPP_FSM_DISABLED,
            [CELLULAR_PPP_EVT_START_REQUEST] = CELLULAR_PPP_FSM_STARTING,
            [CELLULAR_PPP_EVT_STOP_REQUEST] = CELLULAR_PPP_FSM_IDLE,
            [CELLULAR_PPP_EVT_RESET] = CELLULAR_PPP_FSM_IDLE,
        },
    [CELLULAR_PPP_FSM_STARTING] =
        {
            [CELLULAR_PPP_EVT_DISABLE] = CELLULAR_PPP_FSM_DISABLED,
            [CELLULAR_PPP_EVT_STOP_REQUEST] = CELLULAR_PPP_FSM_STOPPING,
            [CELLULAR_PPP_EVT_PHASE_INITIALIZE] = CELLULAR_PPP_FSM_STARTING,
            [CELLULAR_PPP_EVT_PHASE_NEGOTIATING] = CELLULAR_PPP_FSM_NEGOTIATING,
            [CELLULAR_PPP_EVT_PHASE_RUNNING] = CELLULAR_PPP_FSM_RUNNING,
            [CELLULAR_PPP_EVT_PHASE_TERMINATE] = CELLULAR_PPP_FSM_STOPPING,
            [CELLULAR_PPP_EVT_IP_LOST] = CELLULAR_PPP_FSM_IDLE,
            [CELLULAR_PPP_EVT_ERROR] = CELLULAR_PPP_FSM_FAILED,
            [CELLULAR_PPP_EVT_RESET] = CELLULAR_PPP_FSM_IDLE,
        },
    [CELLULAR_PPP_FSM_NEGOTIATING] =
        {
            [CELLULAR_PPP_EVT_DISABLE] = CELLULAR_PPP_FSM_DISABLED,
            [CELLULAR_PPP_EVT_STOP_REQUEST] = CELLULAR_PPP_FSM_STOPPING,
            [CELLULAR_PPP_EVT_PHASE_INITIALIZE] = CELLULAR_PPP_FSM_STARTING,
            [CELLULAR_PPP_EVT_PHASE_NEGOTIATING] = CELLULAR_PPP_FSM_NEGOTIATING,
            [CELLULAR_PPP_EVT_PHASE_RUNNING] = CELLULAR_PPP_FSM_RUNNING,
            [CELLULAR_PPP_EVT_PHASE_TERMINATE] = CELLULAR_PPP_FSM_STOPPING,
            [CELLULAR_PPP_EVT_IP_LOST] = CELLULAR_PPP_FSM_IDLE,
            [CELLULAR_PPP_EVT_ERROR] = CELLULAR_PPP_FSM_FAILED,
            [CELLULAR_PPP_EVT_RESET] = CELLULAR_PPP_FSM_IDLE,
        },
    [CELLULAR_PPP_FSM_RUNNING] =
        {
            [CELLULAR_PPP_EVT_DISABLE] = CELLULAR_PPP_FSM_DISABLED,
            [CELLULAR_PPP_EVT_STOP_REQUEST] = CELLULAR_PPP_FSM_STOPPING,
            [CELLULAR_PPP_EVT_PHASE_TERMINATE] = CELLULAR_PPP_FSM_STOPPING,
            [CELLULAR_PPP_EVT_PHASE_RUNNING] = CELLULAR_PPP_FSM_RUNNING,
            [CELLULAR_PPP_EVT_IP_LOST] = CELLULAR_PPP_FSM_IDLE,
            [CELLULAR_PPP_EVT_ERROR] = CELLULAR_PPP_FSM_FAILED,
            [CELLULAR_PPP_EVT_RESET] = CELLULAR_PPP_FSM_IDLE,
        },
    [CELLULAR_PPP_FSM_STOPPING] =
        {
            [CELLULAR_PPP_EVT_DISABLE] = CELLULAR_PPP_FSM_DISABLED,
            [CELLULAR_PPP_EVT_STOP_REQUEST] = CELLULAR_PPP_FSM_STOPPING,
            [CELLULAR_PPP_EVT_PHASE_TERMINATE] = CELLULAR_PPP_FSM_STOPPING,
            [CELLULAR_PPP_EVT_PHASE_INITIALIZE] = CELLULAR_PPP_FSM_IDLE,
            [CELLULAR_PPP_EVT_PHASE_NEGOTIATING] = CELLULAR_PPP_FSM_IDLE,
            [CELLULAR_PPP_EVT_PHASE_RUNNING] = CELLULAR_PPP_FSM_RUNNING,
            [CELLULAR_PPP_EVT_IP_LOST] = CELLULAR_PPP_FSM_IDLE,
            [CELLULAR_PPP_EVT_ERROR] = CELLULAR_PPP_FSM_FAILED,
            [CELLULAR_PPP_EVT_RESET] = CELLULAR_PPP_FSM_IDLE,
        },
    [CELLULAR_PPP_FSM_FAILED] =
        {
            [CELLULAR_PPP_EVT_DISABLE] = CELLULAR_PPP_FSM_DISABLED,
            [CELLULAR_PPP_EVT_ENABLE] = CELLULAR_PPP_FSM_IDLE,
            [CELLULAR_PPP_EVT_START_REQUEST] = CELLULAR_PPP_FSM_STARTING,
            [CELLULAR_PPP_EVT_RESET] = CELLULAR_PPP_FSM_IDLE,
        },
};

static const bool s_transition_allowed[CELLULAR_PPP_FSM_COUNT]
                                      [CELLULAR_PPP_EVT_COUNT] = {
    [CELLULAR_PPP_FSM_DISABLED] =
        {
            [CELLULAR_PPP_EVT_ENABLE] = true,
            [CELLULAR_PPP_EVT_DISABLE] = true,
            [CELLULAR_PPP_EVT_RESET] = true,
        },
    [CELLULAR_PPP_FSM_IDLE] =
        {
            [CELLULAR_PPP_EVT_ENABLE] = true,
            [CELLULAR_PPP_EVT_DISABLE] = true,
            [CELLULAR_PPP_EVT_START_REQUEST] = true,
            [CELLULAR_PPP_EVT_STOP_REQUEST] = true,
            [CELLULAR_PPP_EVT_RESET] = true,
        },
    [CELLULAR_PPP_FSM_STARTING] =
        {
            [CELLULAR_PPP_EVT_DISABLE] = true,
            [CELLULAR_PPP_EVT_STOP_REQUEST] = true,
            [CELLULAR_PPP_EVT_PHASE_INITIALIZE] = true,
            [CELLULAR_PPP_EVT_PHASE_NEGOTIATING] = true,
            [CELLULAR_PPP_EVT_PHASE_RUNNING] = true,
            [CELLULAR_PPP_EVT_PHASE_TERMINATE] = true,
            [CELLULAR_PPP_EVT_IP_LOST] = true,
            [CELLULAR_PPP_EVT_ERROR] = true,
            [CELLULAR_PPP_EVT_RESET] = true,
        },
    [CELLULAR_PPP_FSM_NEGOTIATING] =
        {
            [CELLULAR_PPP_EVT_DISABLE] = true,
            [CELLULAR_PPP_EVT_STOP_REQUEST] = true,
            [CELLULAR_PPP_EVT_PHASE_INITIALIZE] = true,
            [CELLULAR_PPP_EVT_PHASE_NEGOTIATING] = true,
            [CELLULAR_PPP_EVT_PHASE_RUNNING] = true,
            [CELLULAR_PPP_EVT_PHASE_TERMINATE] = true,
            [CELLULAR_PPP_EVT_IP_LOST] = true,
            [CELLULAR_PPP_EVT_ERROR] = true,
            [CELLULAR_PPP_EVT_RESET] = true,
        },
    [CELLULAR_PPP_FSM_RUNNING] =
        {
            [CELLULAR_PPP_EVT_DISABLE] = true,
            [CELLULAR_PPP_EVT_STOP_REQUEST] = true,
            [CELLULAR_PPP_EVT_PHASE_TERMINATE] = true,
            [CELLULAR_PPP_EVT_PHASE_RUNNING] = true,
            [CELLULAR_PPP_EVT_IP_LOST] = true,
            [CELLULAR_PPP_EVT_ERROR] = true,
            [CELLULAR_PPP_EVT_RESET] = true,
        },
    [CELLULAR_PPP_FSM_STOPPING] =
        {
            [CELLULAR_PPP_EVT_DISABLE] = true,
            [CELLULAR_PPP_EVT_STOP_REQUEST] = true,
            [CELLULAR_PPP_EVT_PHASE_TERMINATE] = true,
            [CELLULAR_PPP_EVT_PHASE_INITIALIZE] = true,
            [CELLULAR_PPP_EVT_PHASE_NEGOTIATING] = true,
            [CELLULAR_PPP_EVT_PHASE_RUNNING] = true,
            [CELLULAR_PPP_EVT_IP_LOST] = true,
            [CELLULAR_PPP_EVT_ERROR] = true,
            [CELLULAR_PPP_EVT_RESET] = true,
        },
    [CELLULAR_PPP_FSM_FAILED] =
        {
            [CELLULAR_PPP_EVT_DISABLE] = true,
            [CELLULAR_PPP_EVT_ENABLE] = true,
            [CELLULAR_PPP_EVT_START_REQUEST] = true,
            [CELLULAR_PPP_EVT_RESET] = true,
        },
};

void cellular_ppp_failure_counters_reset(cellular_ppp_failure_counters_t *counters) {
  if (counters == NULL) {
    return;
  }
  memset(counters, 0, sizeof(*counters));
  counters->last_code = CELLULAR_PPP_FAIL_NONE;
}

void cellular_ppp_failure_record(cellular_ppp_failure_counters_t *counters,
                                 cellular_ppp_failure_code_t code,
                                 uint32_t timestamp_ms) {
  if (counters == NULL || code <= CELLULAR_PPP_FAIL_NONE ||
      code >= CELLULAR_PPP_FAIL_COUNT) {
    return;
  }
  counters->total++;
  counters->consecutive++;
  counters->per_code[code]++;
  counters->last_code = code;
  counters->last_timestamp_ms = timestamp_ms;
}

void cellular_ppp_failure_mark_recovered(cellular_ppp_failure_counters_t *counters) {
  if (counters == NULL) {
    return;
  }
  counters->consecutive = 0;
}

const char *cellular_ppp_failure_code_to_str(cellular_ppp_failure_code_t code) {
  switch (code) {
  case CELLULAR_PPP_FAIL_NONE:
    return "NONE";
  case CELLULAR_PPP_FAIL_MODEM_NO_RESPONSE:
    return "MODEM_NO_RESPONSE";
  case CELLULAR_PPP_FAIL_MODEM_CREATE:
    return "MODEM_CREATE_FAILED";
  case CELLULAR_PPP_FAIL_SIM_NOT_READY:
    return "SIM_NOT_READY";
  case CELLULAR_PPP_FAIL_NOT_REGISTERED:
    return "NOT_REGISTERED";
  case CELLULAR_PPP_FAIL_NOT_ATTACHED:
    return "NOT_ATTACHED";
  case CELLULAR_PPP_FAIL_APN_CONFIG:
    return "PPP_APN_CONFIG_FAILED";
  case CELLULAR_PPP_FAIL_START:
    return "PPP_START_FAILED";
  case CELLULAR_PPP_FAIL_LOST_IP:
    return "PPP_LOST_IP";
  case CELLULAR_PPP_FAIL_INTERNAL:
    return "PPP_INTERNAL";
  case CELLULAR_PPP_FAIL_COUNT:
  default:
    return "UNKNOWN";
  }
}

cellular_ppp_fsm_transition_t cellular_ppp_fsm_apply(
    cellular_ppp_fsm_state_t current, cellular_ppp_fsm_event_t event) {
  cellular_ppp_fsm_transition_t transition = {
      .valid = false,
      .changed = false,
      .from = current,
      .to = current,
      .event = event,
  };

  if (current >= CELLULAR_PPP_FSM_COUNT || event >= CELLULAR_PPP_EVT_COUNT) {
    return transition;
  }

  if (!s_transition_allowed[current][event]) {
    return transition;
  }

  cellular_ppp_fsm_state_t next = s_transition_table[current][event];
  if (next >= CELLULAR_PPP_FSM_COUNT) {
    return transition;
  }

  transition.valid = true;
  transition.to = next;
  transition.changed = (next != current);
  return transition;
}

const char *cellular_ppp_fsm_state_to_str(cellular_ppp_fsm_state_t state) {
  switch (state) {
  case CELLULAR_PPP_FSM_DISABLED:
    return "disabled";
  case CELLULAR_PPP_FSM_IDLE:
    return "idle";
  case CELLULAR_PPP_FSM_STARTING:
    return "starting";
  case CELLULAR_PPP_FSM_NEGOTIATING:
    return "negotiating";
  case CELLULAR_PPP_FSM_RUNNING:
    return "running";
  case CELLULAR_PPP_FSM_STOPPING:
    return "stopping";
  case CELLULAR_PPP_FSM_FAILED:
    return "failed";
  case CELLULAR_PPP_FSM_COUNT:
  default:
    return "unknown";
  }
}

const char *cellular_ppp_fsm_event_to_str(cellular_ppp_fsm_event_t event) {
  switch (event) {
  case CELLULAR_PPP_EVT_ENABLE:
    return "enable";
  case CELLULAR_PPP_EVT_DISABLE:
    return "disable";
  case CELLULAR_PPP_EVT_START_REQUEST:
    return "start_request";
  case CELLULAR_PPP_EVT_STOP_REQUEST:
    return "stop_request";
  case CELLULAR_PPP_EVT_PHASE_INITIALIZE:
    return "phase_initialize";
  case CELLULAR_PPP_EVT_PHASE_NEGOTIATING:
    return "phase_negotiating";
  case CELLULAR_PPP_EVT_PHASE_RUNNING:
    return "phase_running";
  case CELLULAR_PPP_EVT_PHASE_TERMINATE:
    return "phase_terminate";
  case CELLULAR_PPP_EVT_IP_LOST:
    return "ip_lost";
  case CELLULAR_PPP_EVT_ERROR:
    return "error";
  case CELLULAR_PPP_EVT_RESET:
    return "reset";
  case CELLULAR_PPP_EVT_COUNT:
  default:
    return "unknown";
  }
}

void cellular_ppp_diag_ring_init(cellular_ppp_diag_ring_t *ring,
                                 cellular_ppp_diag_entry_t *storage,
                                 size_t capacity) {
  if (ring == NULL) {
    return;
  }
  ring->storage = storage;
  ring->capacity = capacity;
  ring->next_index = 0;
  ring->size = 0;
  ring->dropped = 0;
  if (storage != NULL && capacity > 0) {
    memset(storage, 0, capacity * sizeof(*storage));
  }
}

bool cellular_ppp_diag_ring_push(cellular_ppp_diag_ring_t *ring,
                                 const cellular_ppp_diag_entry_t *entry) {
  if (ring == NULL || ring->storage == NULL || ring->capacity == 0 ||
      entry == NULL) {
    return false;
  }

  if (ring->size == ring->capacity) {
    ring->dropped++;
  }

  ring->storage[ring->next_index] = *entry;
  ring->next_index = (ring->next_index + 1) % ring->capacity;
  if (ring->size < ring->capacity) {
    ring->size++;
  }
  return true;
}

size_t cellular_ppp_diag_ring_size(const cellular_ppp_diag_ring_t *ring) {
  if (ring == NULL) {
    return 0;
  }
  return ring->size;
}

uint32_t cellular_ppp_diag_ring_dropped(const cellular_ppp_diag_ring_t *ring) {
  if (ring == NULL) {
    return 0;
  }
  return ring->dropped;
}

bool cellular_ppp_diag_ring_get_latest(const cellular_ppp_diag_ring_t *ring,
                                       size_t newest_offset,
                                       cellular_ppp_diag_entry_t *out) {
  if (ring == NULL || out == NULL || newest_offset >= ring->size ||
      ring->storage == NULL || ring->capacity == 0) {
    return false;
  }

  size_t newest_index = (ring->next_index + ring->capacity - 1) % ring->capacity;
  size_t index =
      (newest_index + ring->capacity - (newest_offset % ring->capacity)) %
      ring->capacity;
  *out = ring->storage[index];
  return true;
}
