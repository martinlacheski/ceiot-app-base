#include "../cellular_ppp_stability.h"

#include <assert.h>
#include <stdio.h>
#include <string.h>

static void test_failure_schema_and_counters(void) {
  cellular_ppp_failure_counters_t counters;
  cellular_ppp_failure_counters_reset(&counters);

  assert(counters.total == 0);
  assert(counters.consecutive == 0);
  assert(counters.last_code == CELLULAR_PPP_FAIL_NONE);

  cellular_ppp_failure_record(&counters, CELLULAR_PPP_FAIL_MODEM_NO_RESPONSE,
                              1200);
  cellular_ppp_failure_record(&counters, CELLULAR_PPP_FAIL_MODEM_NO_RESPONSE,
                              1600);
  cellular_ppp_failure_record(&counters, CELLULAR_PPP_FAIL_START, 2000);

  assert(counters.total == 3);
  assert(counters.consecutive == 3);
  assert(counters.per_code[CELLULAR_PPP_FAIL_MODEM_NO_RESPONSE] == 2);
  assert(counters.per_code[CELLULAR_PPP_FAIL_START] == 1);
  assert(counters.last_code == CELLULAR_PPP_FAIL_START);
  assert(counters.last_timestamp_ms == 2000);

  cellular_ppp_failure_mark_recovered(&counters);
  assert(counters.consecutive == 0);
  assert(counters.total == 3);
}

static void test_fsm_contract_and_transitions(void) {
  cellular_ppp_fsm_transition_t t =
      cellular_ppp_fsm_apply(CELLULAR_PPP_FSM_IDLE,
                             CELLULAR_PPP_EVT_START_REQUEST);
  assert(t.valid);
  assert(t.changed);
  assert(t.to == CELLULAR_PPP_FSM_STARTING);

  t = cellular_ppp_fsm_apply(CELLULAR_PPP_FSM_STARTING,
                             CELLULAR_PPP_EVT_PHASE_NEGOTIATING);
  assert(t.valid);
  assert(t.to == CELLULAR_PPP_FSM_NEGOTIATING);

  t = cellular_ppp_fsm_apply(CELLULAR_PPP_FSM_NEGOTIATING,
                             CELLULAR_PPP_EVT_PHASE_RUNNING);
  assert(t.valid);
  assert(t.to == CELLULAR_PPP_FSM_RUNNING);

  t = cellular_ppp_fsm_apply(CELLULAR_PPP_FSM_RUNNING,
                             CELLULAR_PPP_EVT_IP_LOST);
  assert(t.valid);
  assert(t.to == CELLULAR_PPP_FSM_IDLE);

  t = cellular_ppp_fsm_apply(CELLULAR_PPP_FSM_IDLE, CELLULAR_PPP_EVT_ERROR);
  assert(!t.valid);
  assert(!t.changed);
  assert(t.to == CELLULAR_PPP_FSM_IDLE);

  t = cellular_ppp_fsm_apply(CELLULAR_PPP_FSM_STARTING, CELLULAR_PPP_EVT_ERROR);
  assert(t.valid);
  assert(t.to == CELLULAR_PPP_FSM_FAILED);
}

static void test_structured_diagnostics_ring_buffer(void) {
  cellular_ppp_diag_entry_t storage[3];
  cellular_ppp_diag_ring_t ring;
  cellular_ppp_diag_ring_init(&ring, storage, 3);

  cellular_ppp_diag_entry_t entry = {0};
  entry.level = CELLULAR_PPP_DIAG_INFO;
  entry.from_state = CELLULAR_PPP_FSM_IDLE;
  entry.to_state = CELLULAR_PPP_FSM_STARTING;
  entry.event = CELLULAR_PPP_EVT_START_REQUEST;

  entry.timestamp_ms = 10;
  strcpy(entry.detail, "a");
  assert(cellular_ppp_diag_ring_push(&ring, &entry));

  entry.timestamp_ms = 20;
  strcpy(entry.detail, "b");
  assert(cellular_ppp_diag_ring_push(&ring, &entry));

  entry.timestamp_ms = 30;
  strcpy(entry.detail, "c");
  assert(cellular_ppp_diag_ring_push(&ring, &entry));

  entry.timestamp_ms = 40;
  entry.level = CELLULAR_PPP_DIAG_ERROR;
  entry.to_state = CELLULAR_PPP_FSM_FAILED;
  entry.event = CELLULAR_PPP_EVT_ERROR;
  entry.failure_code = CELLULAR_PPP_FAIL_START;
  strcpy(entry.detail, "d");
  assert(cellular_ppp_diag_ring_push(&ring, &entry));

  assert(cellular_ppp_diag_ring_size(&ring) == 3);
  assert(cellular_ppp_diag_ring_dropped(&ring) == 1);

  cellular_ppp_diag_entry_t out = {0};
  assert(cellular_ppp_diag_ring_get_latest(&ring, 0, &out));
  assert(out.timestamp_ms == 40);
  assert(strcmp(out.detail, "d") == 0);

  assert(cellular_ppp_diag_ring_get_latest(&ring, 1, &out));
  assert(out.timestamp_ms == 30);
  assert(strcmp(out.detail, "c") == 0);

  assert(cellular_ppp_diag_ring_get_latest(&ring, 2, &out));
  assert(out.timestamp_ms == 20);
  assert(strcmp(out.detail, "b") == 0);

  assert(!cellular_ppp_diag_ring_get_latest(&ring, 3, &out));
}

static void test_timing_profile_defaults(void) {
  const cellular_ppp_timing_profile_t *timing =
      cellular_ppp_timing_profile_default();
  assert(timing != NULL);
  assert(timing->boot_guard_ms == 12000);
  assert(timing->power_on_ready_window_ms == 12000);
  assert(timing->pwrkey_pulse_ms == 1500);
  assert(timing->at_command_timeout_ms == 1500);
  assert(timing->at_retry_interval_ms == 2000);
  assert(timing->at_max_retries == 8);
  assert(timing->status_poll_ms == 5000);
  assert(timing->disabled_poll_ms == 1000);
}

static void test_hw_precheck_contract(void) {
  cellular_ppp_hw_precheck_result_t result = cellular_ppp_hw_precheck(
      1, 42, 41, 48, 47, 115200);
  assert(result == CELLULAR_PPP_HW_PRECHECK_OK);
  assert(strcmp(cellular_ppp_hw_precheck_result_to_str(result), "ok") == 0);

  result = cellular_ppp_hw_precheck(-1, 42, 41, 48, 47, 115200);
  assert(result == CELLULAR_PPP_HW_PRECHECK_UART_PORT_INVALID);

  result = cellular_ppp_hw_precheck(1, -1, 41, 48, 47, 115200);
  assert(result == CELLULAR_PPP_HW_PRECHECK_UART_TX_INVALID);

  result = cellular_ppp_hw_precheck(1, 42, 42, 48, 47, 115200);
  assert(result == CELLULAR_PPP_HW_PRECHECK_UART_PINS_CONFLICT);

  result = cellular_ppp_hw_precheck(1, 42, 41, -1, 47, 115200);
  assert(result == CELLULAR_PPP_HW_PRECHECK_OK);

  result = cellular_ppp_hw_precheck(1, 42, 41, 48, -1, 115200);
  assert(result == CELLULAR_PPP_HW_PRECHECK_OK);

  result = cellular_ppp_hw_precheck(1, 42, 41, -1, -1, 115200);
  assert(result == CELLULAR_PPP_HW_PRECHECK_OK);

  result = cellular_ppp_hw_precheck(1, 42, 41, 42, -1, 115200);
  assert(result == CELLULAR_PPP_HW_PRECHECK_UART_PINS_CONFLICT);

  result = cellular_ppp_hw_precheck(1, 42, 41, 48, 48, 115200);
  assert(result == CELLULAR_PPP_HW_PRECHECK_UART_PINS_CONFLICT);

  result = cellular_ppp_hw_precheck(1, 42, 41, 48, 47, 2000000);
  assert(result == CELLULAR_PPP_HW_PRECHECK_BAUD_INVALID);
}

int main(void) {
  test_failure_schema_and_counters();
  test_fsm_contract_and_transitions();
  test_structured_diagnostics_ring_buffer();
  test_timing_profile_defaults();
  test_hw_precheck_contract();
  puts("test_cellular_ppp_stability: OK");
  return 0;
}
