/*
 * button_logic.c
 */

#include "button_logic.h"

#include <stddef.h>

void button_logic_init(button_state_t *state) {
  if (state == NULL) return;
  state->held_ms = 0;
  state->released_ms = 0;
  state->reset_fired = false;
}

static button_feedback_t feedback_for(const button_state_t *state) {
  if (state->reset_fired) return BUTTON_FEEDBACK_RESET;
  if (state->held_ms >= BUTTON_AP_HOLD_MS) return BUTTON_FEEDBACK_AP_ARMED;
  return BUTTON_FEEDBACK_NONE;
}

button_action_t button_logic_update(button_state_t *state, bool pressed,
                                    uint32_t elapsed_ms,
                                    button_feedback_t *feedback) {
  button_action_t action = BUTTON_ACTION_NONE;
  if (state == NULL) {
    if (feedback) *feedback = BUTTON_FEEDBACK_NONE;
    return action;
  }

  if (pressed) {
    // A short drop while held was contact bounce: bridge it into the press.
    uint32_t bridged = state->held_ms > 0 ? state->released_ms : 0;
    state->released_ms = 0;
    uint32_t held = state->held_ms + bridged + elapsed_ms;
    state->held_ms = held < state->held_ms ? UINT32_MAX : held; // saturate
    if (!state->reset_fired && state->held_ms >= BUTTON_RESET_HOLD_MS) {
      state->reset_fired = true;
      action = BUTTON_ACTION_FACTORY_RESET;
    }
    if (feedback) *feedback = feedback_for(state);
    return action;
  }

  // Released: a 3-10 s hold toggles the AP; shorter presses (and contact
  // bounces) and an already-fired reset do nothing.
  if (feedback) *feedback = BUTTON_FEEDBACK_NONE;
  if (state->held_ms == 0) return action; // idle
  state->released_ms += elapsed_ms;
  if (state->released_ms < BUTTON_RELEASE_DEBOUNCE_MS) {
    return action; // maybe bounce: wait before ending the press
  }
  if (!state->reset_fired && state->held_ms >= BUTTON_AP_HOLD_MS) {
    action = BUTTON_ACTION_TOGGLE_AP;
  }
  button_logic_init(state);
  return action;
}

button_ap_command_t button_logic_ap_command(bool ap_active) {
  return ap_active ? BUTTON_AP_STOP : BUTTON_AP_START;
}
