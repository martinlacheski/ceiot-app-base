#ifndef MQTT_MANAGER_H
#define MQTT_MANAGER_H

#include "esp_err.h"
#include <stdbool.h>

typedef struct {
  bool client_initialized;
  bool connected;
  bool start_task_running;
  bool network_ready;
  bool time_ready;
  bool test_pending;
  bool test_success;
  int last_error_type;
  int transport_sock_errno;
  int tls_stack_err;
  int esp_tls_last_err;
  char last_event[32];
  char last_error[96];
} mqtt_status_snapshot_t;

esp_err_t mqtt_manager_init(void);
esp_err_t mqtt_manager_start(void);
esp_err_t mqtt_manager_stop(void);
bool mqtt_manager_is_connected(void);
esp_err_t mqtt_manager_get_status_snapshot(mqtt_status_snapshot_t *snapshot);
char *mqtt_manager_get_status_json(void);
int mqtt_manager_get_qos_pub(void);
int mqtt_manager_get_qos_sub(void);
esp_err_t mqtt_manager_publish(const char *topic, const char *data, int qos);
bool mqtt_manager_start_test(void);
void mqtt_manager_get_test_status(bool *pending, bool *success,
                                  int *elapsed_ms);

#endif
