/* Host tests for main/button/button_logic.c */
#include "button_logic.h"
#include "test_util.h"

#define TICK 50

/* Holds the button for `ms` (in TICK steps), then releases it. Returns the
 * action reported on release; *during gets the first action while held. */
static button_action_t press_for(button_state_t *s, uint32_t ms,
                                 button_action_t *during,
                                 button_feedback_t *last_held_feedback) {
  button_feedback_t fb = BUTTON_FEEDBACK_NONE;
  *during = BUTTON_ACTION_NONE;
  for (uint32_t t = 0; t < ms; t += TICK) {
    button_action_t a = button_logic_update(s, true, TICK, &fb);
    if (a != BUTTON_ACTION_NONE && *during == BUTTON_ACTION_NONE) *during = a;
  }
  if (last_held_feedback) *last_held_feedback = fb;
  return button_logic_update(s, false, TICK, &fb);
}

static void test_short_press_does_nothing(void) {
  button_state_t s;
  button_logic_init(&s);
  button_action_t during;
  button_feedback_t fb;
  CHECK(press_for(&s, 200, &during, &fb) == BUTTON_ACTION_NONE);
  CHECK(during == BUTTON_ACTION_NONE && fb == BUTTON_FEEDBACK_NONE);
  CHECK(press_for(&s, 2950, &during, &fb) == BUTTON_ACTION_NONE);
  CHECK(during == BUTTON_ACTION_NONE && fb == BUTTON_FEEDBACK_NONE);
}

static void test_three_second_hold_toggles_ap_on_release(void) {
  button_state_t s;
  button_logic_init(&s);
  button_action_t during;
  button_feedback_t fb;
  CHECK(press_for(&s, 3000, &during, &fb) == BUTTON_ACTION_TOGGLE_AP);
  CHECK(during == BUTTON_ACTION_NONE);
  CHECK(fb == BUTTON_FEEDBACK_AP_ARMED);
  CHECK(press_for(&s, 9950, &during, &fb) == BUTTON_ACTION_TOGGLE_AP);
  CHECK(during == BUTTON_ACTION_NONE);
}

static void test_ten_second_hold_resets_while_held_once(void) {
  button_state_t s;
  button_logic_init(&s);
  button_action_t during;
  button_feedback_t fb;
  CHECK(press_for(&s, 15000, &during, &fb) == BUTTON_ACTION_NONE);
  CHECK(during == BUTTON_ACTION_FACTORY_RESET);
  CHECK(fb == BUTTON_FEEDBACK_RESET);

  /* the reset is reported exactly once per press */
  button_logic_init(&s);
  int resets = 0;
  for (uint32_t t = 0; t < 20000; t += TICK) {
    if (button_logic_update(&s, true, TICK, NULL) == BUTTON_ACTION_FACTORY_RESET) resets++;
  }
  CHECK(resets == 1);
}

static void test_feedback_follows_hold_time(void) {
  button_state_t s;
  button_logic_init(&s);
  button_feedback_t fb = BUTTON_FEEDBACK_RESET;
  button_logic_update(&s, true, 2999, &fb);
  CHECK(fb == BUTTON_FEEDBACK_NONE);
  button_logic_update(&s, true, 1, &fb);
  CHECK(fb == BUTTON_FEEDBACK_AP_ARMED);
  button_logic_update(&s, false, TICK, &fb);
  CHECK(fb == BUTTON_FEEDBACK_NONE);
}

static void test_state_resets_after_release_and_null_is_safe(void) {
  button_state_t s;
  button_logic_init(&s);
  button_action_t during;
  press_for(&s, 4000, &during, NULL);
  CHECK(s.held_ms == 0 && !s.reset_fired);
  /* release without a press is a no-op */
  CHECK(button_logic_update(&s, false, TICK, NULL) == BUTTON_ACTION_NONE);
  button_feedback_t fb = BUTTON_FEEDBACK_RESET;
  CHECK(button_logic_update(NULL, true, TICK, &fb) == BUTTON_ACTION_NONE);
  CHECK(fb == BUTTON_FEEDBACK_NONE);
}

static void test_toggle_starts_a_stopped_ap_and_stops_a_running_one(void) {
  CHECK(button_logic_ap_command(false) == BUTTON_AP_START);
  CHECK(button_logic_ap_command(true) == BUTTON_AP_STOP);
}

static void test_two_holds_toggle_twice(void) {
  /* each 3-10 s hold reports one toggle; the caller flips the AP state */
  button_state_t s;
  button_logic_init(&s);
  button_action_t during;
  bool ap_active = false;
  for (int i = 0; i < 2; i++) {
    if (press_for(&s, 4000, &during, NULL) == BUTTON_ACTION_TOGGLE_AP) {
      ap_active = button_logic_ap_command(ap_active) == BUTTON_AP_START;
    }
  }
  CHECK(!ap_active);
  CHECK(press_for(&s, 4000, &during, NULL) == BUTTON_ACTION_TOGGLE_AP);
}

static void test_hold_time_saturates(void) {
  button_state_t s;
  button_logic_init(&s);
  s.held_ms = UINT32_MAX - 10;
  s.reset_fired = true;
  button_logic_update(&s, true, 100, NULL);
  CHECK(s.held_ms == UINT32_MAX);
}

int main(void) {
  RUN(test_short_press_does_nothing);
  RUN(test_three_second_hold_toggles_ap_on_release);
  RUN(test_ten_second_hold_resets_while_held_once);
  RUN(test_feedback_follows_hold_time);
  RUN(test_state_resets_after_release_and_null_is_safe);
  RUN(test_toggle_starts_a_stopped_ap_and_stops_a_running_one);
  RUN(test_two_holds_toggle_twice);
  RUN(test_hold_time_saturates);
  TEST_MAIN_END();
}
