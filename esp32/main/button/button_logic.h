/*
 * button_logic.h
 *
 * BOOT button hold classification. Pure C (host-tested in esp32/tests/).
 *
 *   press < 3 s            -> nothing
 *   hold >= 3 s, release   -> toggle the configuration AP (start it when
 *                             it is off, stop it when it is on)
 *   hold reaches 10 s      -> factory reset (fires while still held)
 */

#ifndef BUTTON_LOGIC_H
#define BUTTON_LOGIC_H

#include <stdbool.h>
#include <stdint.h>

#define BUTTON_AP_HOLD_MS 3000
#define BUTTON_RESET_HOLD_MS 10000

typedef enum {
  BUTTON_ACTION_NONE = 0,
  BUTTON_ACTION_TOGGLE_AP,
  BUTTON_ACTION_FACTORY_RESET,
} button_action_t;

// What the status LED should show while the button is held.
typedef enum {
  BUTTON_FEEDBACK_NONE = 0,  // not held, or held < 3 s
  BUTTON_FEEDBACK_AP_ARMED,  // releasing now toggles the AP
  BUTTON_FEEDBACK_RESET,     // factory reset triggered
} button_feedback_t;

// What a BOOT toggle does to the configuration AP.
typedef enum {
  BUTTON_AP_START = 0,
  BUTTON_AP_STOP,
} button_ap_command_t;

typedef struct {
  uint32_t held_ms;  // continuous time the button has been down
  bool reset_fired;  // reset already reported for this press
} button_state_t;

void button_logic_init(button_state_t *state);

// Advances the state by `elapsed_ms` with the current level, sampled by the
// caller's polling loop (the poll period also debounces the contact).
// Returns the action to run now, if any, and the LED feedback in `*feedback`
// (nullable).
button_action_t button_logic_update(button_state_t *state, bool pressed,
                                    uint32_t elapsed_ms,
                                    button_feedback_t *feedback);

// BUTTON_ACTION_TOGGLE_AP resolved against the current AP state.
button_ap_command_t button_logic_ap_command(bool ap_active);

#endif // BUTTON_LOGIC_H
