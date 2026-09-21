/*
 * cellular_manager.c
 *
 * UART raw + PPPoS directo — sin esp_modem.
 * Regla crítica: UN SOLO uart_driver_install en toda la vida del manager.
 * Guard s_uart_ready previene doble install.
 */

#include "cellular_manager.h"

#include "cJSON.h"
#include "driver/gpio.h"
#include "driver/uart.h"
#include "esp_event.h"
#include "esp_log.h"
#include "esp_netif.h"
#include "esp_netif_defaults.h"
#include "esp_netif_ppp.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "freertos/task.h"
#include "nvs.h"
#include "nvs_flash.h"
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "pins_config.h"

static const char *TAG = "CELL_MGR";

#define CELL_TASK_STACK        6144
#define CELL_TASK_PRIO         5
#define PPP_RX_TASK_STACK      4096
#define PPP_RX_TASK_PRIO       6
#define CELLULAR_DIAG_RING_CAPACITY 32
#define PPP_START_FAIL_THRESHOLD 3
#define PPP_HARD_RECOVERY_COOLDOWN_MS 60000

/* ─── Tipos de estado ─────────────────────────────────────────────────────── */

typedef struct {
  bool enabled;
  bool modem_alive;
  bool at_ready;
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
  cellular_ppp_failure_counters_t failure_counters;
  unsigned int registration_retry_count;
  unsigned int ppp_retry_count;
  char operator_name[32];
  char ip[16];
  char dns_primary[16];
  char dns_secondary[16];
  char last_ppp_event[48];
  char last_error[64];
  char apn[64];
  char user[64];
  char pass[64];
} cellular_state_t;

/* Driver handle para el binding con esp_netif */
typedef struct {
  esp_netif_driver_base_t base;  /* DEBE ser el primer campo */
} ppp_uart_driver_t;

/* ─── Variables globales estáticas ───────────────────────────────────────── */

static TaskHandle_t s_cell_task = NULL;
static TaskHandle_t s_ppp_rx_task = NULL;
static SemaphoreHandle_t s_lock = NULL;
static esp_netif_t *s_ppp_netif = NULL;
static ppp_uart_driver_t s_ppp_driver;
static bool s_ppp_driver_attached = false;
static esp_event_handler_instance_t s_ppp_ip_any_handler;
static esp_event_handler_instance_t s_ppp_status_any_handler;
static bool s_ppp_handlers_registered = false;
static bool s_apn_applied = false;
static bool s_uart_ready = false;   /* guard: solo un uart_driver_install */
static bool s_modem_ready = false;  /* guard: PPP netif creado y handlers OK */
static bool s_ppp_active = false;   /* PPP session en curso */
static cellular_ppp_diag_entry_t s_diag_storage[CELLULAR_DIAG_RING_CAPACITY];
static cellular_ppp_diag_ring_t s_diag_ring;
static const cellular_ppp_timing_profile_t *s_timing = NULL;
static uint8_t s_ppp_start_fail_streak = 0;
static TickType_t s_last_ppp_hard_recovery_tick = 0;

/* ─── Prototipos internos ─────────────────────────────────────────────────── */

static void set_failure_locked(cellular_ppp_failure_code_t code,
                               const char *legacy_message);
static esp_err_t register_ppp_handlers(void);

/* ─── Estado inicial ──────────────────────────────────────────────────────── */

static cellular_state_t s_state = {
    .enabled = true,
    .modem_alive = false,
    .at_ready = false,
    .sim_ready = false,
    .registered = false,
    .attached = false,
    .ppp_up = false,
    .ppp_phase = CELLULAR_PPP_PHASE_IDLE,
    .rssi_dbm = 0,
    .registration_status_code = -1,
    .attach_status_code = -1,
    .last_ppp_event_id = 0,
    .ppp_fsm_state = CELLULAR_PPP_FSM_IDLE,
    .failure_counters = {0},
    .registration_retry_count = 0,
    .ppp_retry_count = 0,
    .operator_name = "",
    .ip = "",
    .dns_primary = "",
    .dns_secondary = "",
    .last_ppp_event = "",
    .last_error = "",
    .apn = "",
    .user = "",
    .pass = "",
};

/* ─── Helpers de timing ───────────────────────────────────────────────────── */

static const cellular_ppp_timing_profile_t *timing_profile(void) {
  if (s_timing == NULL) {
    s_timing = cellular_ppp_timing_profile_default();
  }
  return s_timing;
}

/* ─── Helpers IP/estado ───────────────────────────────────────────────────── */

static bool has_valid_ip(const char *ip) {
  return ip != NULL && ip[0] != '\0' && strcmp(ip, "0.0.0.0") != 0;
}

static void copy_ip4_to_str(const esp_ip4_addr_t *addr, char *out,
                            size_t out_len) {
  if (out == NULL || out_len == 0) {
    return;
  }
  if (addr == NULL) {
    out[0] = '\0';
    return;
  }
  snprintf(out, out_len, IPSTR, IP2STR(addr));
}

static void update_dns_from_netif_locked(void) {
  if (s_ppp_netif == NULL) {
    s_state.dns_primary[0] = '\0';
    s_state.dns_secondary[0] = '\0';
    return;
  }

  esp_netif_dns_info_t dns_info;
  memset(&dns_info, 0, sizeof(dns_info));
  if (esp_netif_get_dns_info(s_ppp_netif, ESP_NETIF_DNS_MAIN, &dns_info) ==
          ESP_OK &&
      dns_info.ip.type == ESP_IPADDR_TYPE_V4) {
    copy_ip4_to_str(&dns_info.ip.u_addr.ip4, s_state.dns_primary,
                    sizeof(s_state.dns_primary));
  } else {
    s_state.dns_primary[0] = '\0';
  }

  memset(&dns_info, 0, sizeof(dns_info));
  if (esp_netif_get_dns_info(s_ppp_netif, ESP_NETIF_DNS_BACKUP, &dns_info) ==
          ESP_OK &&
      dns_info.ip.type == ESP_IPADDR_TYPE_V4) {
    copy_ip4_to_str(&dns_info.ip.u_addr.ip4, s_state.dns_secondary,
                    sizeof(s_state.dns_secondary));
  } else {
    s_state.dns_secondary[0] = '\0';
  }
}

/* ─── Diagnóstico FSM ─────────────────────────────────────────────────────── */

static void reset_ppp_runtime_state_locked(void) {
  s_state.ppp_up = false;
  s_state.ip[0] = '\0';
  s_state.dns_primary[0] = '\0';
  s_state.dns_secondary[0] = '\0';
  s_state.ppp_phase =
      s_state.enabled ? CELLULAR_PPP_PHASE_IDLE : CELLULAR_PPP_PHASE_DISABLED;
  s_state.ppp_fsm_state =
      s_state.enabled ? CELLULAR_PPP_FSM_IDLE : CELLULAR_PPP_FSM_DISABLED;
}

static void set_last_ppp_event_locked(int32_t event_id, const char *event_name) {
  s_state.last_ppp_event_id = (int)event_id;
  strlcpy(s_state.last_ppp_event, event_name ? event_name : "",
          sizeof(s_state.last_ppp_event));
}

static void diag_ring_push_locked(cellular_ppp_diag_level_t level,
                                  cellular_ppp_fsm_event_t event,
                                  cellular_ppp_failure_code_t failure_code,
                                  const char *detail) {
  cellular_ppp_diag_entry_t entry = {
      .timestamp_ms = (uint32_t)(esp_log_timestamp() & 0xFFFFFFFFu),
      .level = level,
      .from_state = s_state.ppp_fsm_state,
      .to_state = s_state.ppp_fsm_state,
      .event = event,
      .failure_code = failure_code,
  };
  if (detail != NULL) {
    strlcpy(entry.detail, detail, sizeof(entry.detail));
  } else {
    entry.detail[0] = '\0';
  }
  (void)cellular_ppp_diag_ring_push(&s_diag_ring, &entry);
}

static void ppp_fsm_apply_locked(cellular_ppp_fsm_event_t event,
                                 cellular_ppp_diag_level_t level,
                                 const char *detail) {
  cellular_ppp_fsm_transition_t transition =
      cellular_ppp_fsm_apply(s_state.ppp_fsm_state, event);
  if (!transition.valid) {
    diag_ring_push_locked(CELLULAR_PPP_DIAG_WARN, event, CELLULAR_PPP_FAIL_NONE,
                          "FSM_EVENT_INVALID");
    return;
  }

  s_state.ppp_fsm_state = transition.to;

  cellular_ppp_diag_entry_t entry = {
      .timestamp_ms = (uint32_t)(esp_log_timestamp() & 0xFFFFFFFFu),
      .level = level,
      .from_state = transition.from,
      .to_state = transition.to,
      .event = event,
      .failure_code = CELLULAR_PPP_FAIL_NONE,
  };
  if (detail != NULL) {
    strlcpy(entry.detail, detail, sizeof(entry.detail));
  }
  (void)cellular_ppp_diag_ring_push(&s_diag_ring, &entry);
}

static void set_failure_locked(cellular_ppp_failure_code_t code,
                               const char *legacy_message) {
  cellular_ppp_failure_record(&s_state.failure_counters, code,
                              (uint32_t)(esp_log_timestamp() & 0xFFFFFFFFu));
  strlcpy(s_state.last_error,
          legacy_message ? legacy_message : cellular_ppp_failure_code_to_str(code),
          sizeof(s_state.last_error));
  diag_ring_push_locked(CELLULAR_PPP_DIAG_ERROR, CELLULAR_PPP_EVT_ERROR, code,
                        s_state.last_error);
}

static void mark_recovered_locked(const char *detail) {
  cellular_ppp_failure_mark_recovered(&s_state.failure_counters);
  diag_ring_push_locked(CELLULAR_PPP_DIAG_INFO, CELLULAR_PPP_EVT_RESET,
                        CELLULAR_PPP_FAIL_NONE, detail);
}

static void set_last_error(const char *msg) {
  if (s_lock == NULL) {
    return;
  }
  xSemaphoreTake(s_lock, portMAX_DELAY);
  set_failure_locked(CELLULAR_PPP_FAIL_INTERNAL, msg);
  xSemaphoreGive(s_lock);
}

/* ─── NVS APN ────────────────────────────────────────────────────────────── */

static void load_apn_from_nvs(void) {
  nvs_handle_t nvs_h;
  esp_err_t open_err = nvs_open("storage", NVS_READONLY, &nvs_h);
  if (open_err != ESP_OK) {
    ESP_LOGW(TAG, "NVS open fallo al leer APN err=%s", esp_err_to_name(open_err));
    return;
  }

  xSemaphoreTake(s_lock, portMAX_DELAY);
  size_t len = sizeof(s_state.apn);
  if (nvs_get_str(nvs_h, "cell_apn", s_state.apn, &len) != ESP_OK) {
    s_state.apn[0] = '\0';
  }
  len = sizeof(s_state.user);
  if (nvs_get_str(nvs_h, "cell_user", s_state.user, &len) != ESP_OK) {
    s_state.user[0] = '\0';
  }
  len = sizeof(s_state.pass);
  if (nvs_get_str(nvs_h, "cell_pass", s_state.pass, &len) != ESP_OK) {
    s_state.pass[0] = '\0';
  }
  xSemaphoreGive(s_lock);

  nvs_close(nvs_h);
}

static esp_err_t save_apn_to_nvs(const char *apn, const char *user,
                                 const char *pass) {
  if (apn == NULL) {
    return ESP_ERR_INVALID_ARG;
  }

  nvs_handle_t nvs_h;
  esp_err_t err = nvs_open("storage", NVS_READWRITE, &nvs_h);
  if (err != ESP_OK) {
    ESP_LOGE(TAG, "NVS open fallo al guardar APN err=%s", esp_err_to_name(err));
    return err;
  }

  if (apn[0] == '\0') {
    err = nvs_erase_key(nvs_h, "cell_apn");
    if (err == ESP_ERR_NVS_NOT_FOUND) {
      err = ESP_OK;
    }
    if (err == ESP_OK) {
      err = nvs_erase_key(nvs_h, "cell_user");
      if (err == ESP_ERR_NVS_NOT_FOUND) {
        err = ESP_OK;
      }
    }
    if (err == ESP_OK) {
      err = nvs_erase_key(nvs_h, "cell_pass");
      if (err == ESP_ERR_NVS_NOT_FOUND) {
        err = ESP_OK;
      }
    }
  } else {
    err = nvs_set_str(nvs_h, "cell_apn", apn);
    if (err == ESP_OK) {
      err = nvs_set_str(nvs_h, "cell_user", user ? user : "");
    }
    if (err == ESP_OK) {
      err = nvs_set_str(nvs_h, "cell_pass", pass ? pass : "");
    }
  }
  if (err == ESP_OK) {
    err = nvs_commit(nvs_h);
  }

  if (err != ESP_OK) {
    ESP_LOGE(TAG, "NVS fallo guardando APN err=%s", esp_err_to_name(err));
  }

  nvs_close(nvs_h);
  return err;
}

/* ─── Strings de eventos PPP ─────────────────────────────────────────────── */

static const char *ppp_error_to_str(int32_t event_id) {
  switch (event_id) {
  case NETIF_PPP_ERRORNONE:
    return "";
  case NETIF_PPP_ERRORPARAM:
    return "PPP_ERROR_PARAM";
  case NETIF_PPP_ERROROPEN:
    return "PPP_ERROR_OPEN";
  case NETIF_PPP_ERRORDEVICE:
    return "PPP_ERROR_DEVICE";
  case NETIF_PPP_ERRORALLOC:
    return "PPP_ERROR_ALLOC";
  case NETIF_PPP_ERRORUSER:
    return "PPP_ERROR_USER";
  case NETIF_PPP_ERRORCONNECT:
    return "PPP_ERROR_CONNECT";
  case NETIF_PPP_ERRORAUTHFAIL:
    return "PPP_ERROR_AUTH";
  case NETIF_PPP_ERRORPROTOCOL:
    return "PPP_ERROR_PROTOCOL";
  case NETIF_PPP_ERRORPEERDEAD:
    return "PPP_ERROR_PEER_DEAD";
  case NETIF_PPP_ERRORIDLETIMEOUT:
    return "PPP_ERROR_IDLE_TIMEOUT";
  case NETIF_PPP_ERRORCONNECTTIME:
    return "PPP_ERROR_CONNECT_TIMEOUT";
  case NETIF_PPP_ERRORLOOPBACK:
    return "PPP_ERROR_LOOPBACK";
  case NETIF_PPP_CONNECT_FAILED:
    return "PPP_CONNECT_FAILED";
  default:
    return "PPP_ERROR_UNKNOWN";
  }
}

static const char *ppp_event_to_str(int32_t event_id) {
  switch (event_id) {
  case IP_EVENT_PPP_GOT_IP:
    return "IP_EVENT_PPP_GOT_IP";
  case IP_EVENT_PPP_LOST_IP:
    return "IP_EVENT_PPP_LOST_IP";
  case NETIF_PPP_PHASE_DEAD:
    return "NETIF_PPP_PHASE_DEAD";
  case NETIF_PPP_PHASE_INITIALIZE:
    return "NETIF_PPP_PHASE_INITIALIZE";
  case NETIF_PPP_PHASE_SERIALCONN:
    return "NETIF_PPP_PHASE_SERIALCONN";
  case NETIF_PPP_PHASE_ESTABLISH:
    return "NETIF_PPP_PHASE_ESTABLISH";
  case NETIF_PPP_PHASE_AUTHENTICATE:
    return "NETIF_PPP_PHASE_AUTHENTICATE";
  case NETIF_PPP_PHASE_CALLBACK:
    return "NETIF_PPP_PHASE_CALLBACK";
  case NETIF_PPP_PHASE_NETWORK:
    return "NETIF_PPP_PHASE_NETWORK";
  case NETIF_PPP_PHASE_RUNNING:
    return "NETIF_PPP_PHASE_RUNNING";
  case NETIF_PPP_PHASE_TERMINATE:
    return "NETIF_PPP_PHASE_TERMINATE";
  case NETIF_PPP_PHASE_DISCONNECT:
    return "NETIF_PPP_PHASE_DISCONNECT";
  case NETIF_PPP_PHASE_HOLDOFF:
    return "NETIF_PPP_PHASE_HOLDOFF";
  case NETIF_PPP_PHASE_MASTER:
    return "NETIF_PPP_PHASE_MASTER";
  default:
    return ppp_error_to_str(event_id);
  }
}

static cellular_ppp_phase_t map_ppp_event_to_phase(int32_t event_id) {
  switch (event_id) {
  case NETIF_PPP_PHASE_INITIALIZE:
  case NETIF_PPP_PHASE_SERIALCONN:
    return CELLULAR_PPP_PHASE_STARTING;
  case NETIF_PPP_PHASE_ESTABLISH:
  case NETIF_PPP_PHASE_AUTHENTICATE:
  case NETIF_PPP_PHASE_CALLBACK:
  case NETIF_PPP_PHASE_NETWORK:
  case NETIF_PPP_PHASE_DORMANT:
  case NETIF_PPP_PHASE_MASTER:
  case NETIF_PPP_PHASE_HOLDOFF:
    return CELLULAR_PPP_PHASE_NEGOTIATING;
  case NETIF_PPP_PHASE_RUNNING:
    return CELLULAR_PPP_PHASE_RUNNING;
  case NETIF_PPP_PHASE_TERMINATE:
  case NETIF_PPP_PHASE_DISCONNECT:
    return CELLULAR_PPP_PHASE_STOPPING;
  case NETIF_PPP_PHASE_DEAD:
  default:
    return CELLULAR_PPP_PHASE_IDLE;
  }
}

/* ─── UART raw ───────────────────────────────────────────────────────────── */

/*
 * modem_uart_init — instala el driver UART UNA SOLA VEZ.
 * Guard s_uart_ready previene doble install y evita el bug de SigOut ID:15
 * que dejaba GPIO43 asignado a UART0 TX y causaba "GPIO not usable".
 */
static esp_err_t modem_uart_init(void) {
  if (s_uart_ready) {
    return ESP_OK;
  }

  uart_config_t cfg = {
      .baud_rate = MODEM_BAUD_RATE,
      .data_bits = UART_DATA_8_BITS,
      .parity = UART_PARITY_DISABLE,
      .stop_bits = UART_STOP_BITS_1,
      .flow_ctrl = UART_HW_FLOWCTRL_DISABLE,
      .source_clk = UART_SCLK_DEFAULT,
  };

  esp_err_t err = uart_driver_install(MODEM_UART_PORT, 4096, 1024, 0, NULL, 0);
  if (err != ESP_OK) {
    ESP_LOGE(TAG, "uart_driver_install UART%d falló: %s",
             MODEM_UART_PORT, esp_err_to_name(err));
    return err;
  }

  err = uart_param_config(MODEM_UART_PORT, &cfg);
  if (err != ESP_OK) {
    ESP_LOGE(TAG, "uart_param_config falló: %s", esp_err_to_name(err));
    return err;
  }

  err = uart_set_pin(MODEM_UART_PORT, MODEM_UART_TX_GPIO, MODEM_UART_RX_GPIO,
                     UART_PIN_NO_CHANGE, UART_PIN_NO_CHANGE);
  if (err != ESP_OK) {
    ESP_LOGE(TAG, "uart_set_pin falló: %s", esp_err_to_name(err));
    return err;
  }

  uart_flush_input(MODEM_UART_PORT);
  s_uart_ready = true;
  ESP_LOGI(TAG, "UART%d inicializado (TX=%d RX=%d BAUD=%d) — permanente",
           MODEM_UART_PORT, MODEM_UART_TX_GPIO, MODEM_UART_RX_GPIO,
           MODEM_BAUD_RATE);
  return ESP_OK;
}

/*
 * at_send_cmd — envía un comando AT y lee la respuesta por UART raw.
 * Reemplaza uart_diag_send_command() + esp_modem_command().
 * NUNCA instala/elimina el driver UART — usa el ya instalado.
 */
static bool at_send_cmd(const char *cmd, uint32_t timeout_ms, char *resp,
                         size_t resp_len, bool require_ok) {
  if (cmd == NULL || resp == NULL || resp_len < 2) {
    return false;
  }

  resp[0] = '\0';
  uart_flush_input(MODEM_UART_PORT);

  char full_cmd[128];
  int written = snprintf(full_cmd, sizeof(full_cmd), "%s\r\n", cmd);
  if (written <= 0 || written >= (int)sizeof(full_cmd)) {
    return false;
  }

  ESP_LOGI(TAG, "[AT] >> %s", cmd);
  if (uart_write_bytes(MODEM_UART_PORT, full_cmd, written) <= 0) {
    ESP_LOGE(TAG, "[AT] FAIL %s: no se pudo escribir por UART", cmd);
    return false;
  }

  TickType_t start = xTaskGetTickCount();
  TickType_t timeout_ticks = pdMS_TO_TICKS(timeout_ms);
  size_t used = 0;
  bool saw_terminal = false;

  while ((xTaskGetTickCount() - start) < timeout_ticks) {
    if (used >= resp_len - 1) {
      break;
    }

    int read = uart_read_bytes(MODEM_UART_PORT, (uint8_t *)(resp + used),
                               resp_len - used - 1, pdMS_TO_TICKS(120));
    if (read > 0) {
      used += (size_t)read;
      resp[used] = '\0';
      if (strstr(resp, "\r\nOK\r\n") != NULL ||
          strstr(resp, "\r\nERROR\r\n") != NULL ||
          strstr(resp, "\r\nCONNECT") != NULL) {
        saw_terminal = true;
        break;
      }
    }
  }

  bool has_ok = strstr(resp, "OK") != NULL;
  bool has_error = strstr(resp, "ERROR") != NULL;

  if (!saw_terminal && !has_ok && !has_error) {
    ESP_LOGE(TAG, "[AT] FAIL %s: timeout sin respuesta terminal", cmd);
    return false;
  }

  ESP_LOGI(TAG, "[AT] << %s", resp[0] != '\0' ? resp : "(vacio)");
  if (require_ok && !has_ok) {
    ESP_LOGE(TAG, "[AT] FAIL %s: respuesta sin OK", cmd);
    return false;
  }
  return true;
}

/* ─── run_modem_command — wrapper de at_send_cmd para compatibilidad interna */

static bool run_modem_command(const char *cmd, char *resp, size_t resp_len,
                              uint32_t timeout_ms) {
  if (!s_uart_ready || cmd == NULL) {
    if (resp != NULL && resp_len > 0) {
      resp[0] = '\0';
    }
    return false;
  }
  return at_send_cmd(cmd, timeout_ms, resp, resp_len, false);
}

/* ─── Parsers de respuesta AT ────────────────────────────────────────────── */

static int parse_creg_stat(const char *resp) {
  if (resp == NULL) {
    return -1;
  }

  const char *p = strstr(resp, "+CREG:");
  if (p == NULL) {
    p = strstr(resp, "+CGREG:");
  }
  if (p == NULL) {
    return -1;
  }

  int n = 0;
  int stat = -1;
  if (sscanf(p, "+CREG: %d,%d", &n, &stat) == 2) {
    return stat;
  }
  if (sscanf(p, "+CGREG: %d,%d", &n, &stat) == 2) {
    return stat;
  }
  if (sscanf(p, "+CREG: %d", &stat) == 1) {
    return stat;
  }
  if (sscanf(p, "+CGREG: %d", &stat) == 1) {
    return stat;
  }
  return -1;
}

static int parse_csq_dbm(const char *resp) {
  if (resp == NULL) {
    return 0;
  }

  const char *p = strstr(resp, "+CSQ:");
  if (p == NULL) {
    return 0;
  }

  int rssi = 99;
  int ber = 0;
  if (sscanf(p, "+CSQ: %d,%d", &rssi, &ber) != 2) {
    return 0;
  }
  if (rssi == 99) {
    return 0;
  }
  if (rssi < 0) {
    rssi = 0;
  }
  if (rssi > 31) {
    rssi = 31;
  }
  return -113 + (2 * rssi);
}

static int parse_cgatt_attached(const char *resp) {
  if (resp == NULL) {
    return -1;
  }

  const char *p = strstr(resp, "+CGATT:");
  if (p == NULL) {
    return -1;
  }

  int attached = -1;
  if (sscanf(p, "+CGATT: %d", &attached) == 1) {
    return attached;
  }
  return -1;
}

static void parse_operator(const char *resp, char *out, size_t out_len) {
  if (out == NULL || out_len == 0) {
    return;
  }
  out[0] = '\0';
  if (resp == NULL) {
    return;
  }

  const char *q1 = strchr(resp, '"');
  if (q1 == NULL) {
    return;
  }
  const char *q2 = strchr(q1 + 1, '"');
  if (q2 == NULL || q2 <= q1) {
    return;
  }

  size_t len = (size_t)(q2 - (q1 + 1));
  if (len >= out_len) {
    len = out_len - 1;
  }
  memcpy(out, q1 + 1, len);
  out[len] = '\0';
}

/* ─── GPIO / hardware ────────────────────────────────────────────────────── */

static esp_err_t validate_modem_hw_config(void) {
  cellular_ppp_hw_precheck_result_t precheck = cellular_ppp_hw_precheck(
      MODEM_UART_PORT, MODEM_UART_TX_GPIO, MODEM_UART_RX_GPIO, MODEM_PWRKEY_GPIO,
      MODEM_SLEEP_GPIO, MODEM_BAUD_RATE);
  if (precheck != CELLULAR_PPP_HW_PRECHECK_OK) {
    ESP_LOGE(TAG, "Precheck UART/pines fallido: %s",
             cellular_ppp_hw_precheck_result_to_str(precheck));
    return ESP_ERR_INVALID_ARG;
  }

  if (!GPIO_IS_VALID_OUTPUT_GPIO(MODEM_UART_TX_GPIO)) {
    ESP_LOGE(TAG, "Precheck TX invalido para salida UART: GPIO%d",
             MODEM_UART_TX_GPIO);
    return ESP_ERR_INVALID_ARG;
  }

  if (!GPIO_IS_VALID_GPIO(MODEM_UART_RX_GPIO)) {
    ESP_LOGE(TAG, "Precheck RX invalido para entrada UART: GPIO%d",
             MODEM_UART_RX_GPIO);
    return ESP_ERR_INVALID_ARG;
  }

  return ESP_OK;
}

static void dump_modem_gpio_state(const char *stage) {
  uint64_t mask = 0;
  if (MODEM_UART_TX_GPIO >= 0) {
    mask |= (1ULL << MODEM_UART_TX_GPIO);
  }
  if (MODEM_UART_RX_GPIO >= 0) {
    mask |= (1ULL << MODEM_UART_RX_GPIO);
  }
  if (MODEM_PWRKEY_GPIO >= 0) {
    mask |= (1ULL << MODEM_PWRKEY_GPIO);
  }
  if (MODEM_SLEEP_GPIO >= 0) {
    mask |= (1ULL << MODEM_SLEEP_GPIO);
  }

  ESP_LOGW(TAG,
           "[GPIO-DIAG] %s | UART%d TX=%d RX=%d PWRKEY=%d SLEEP=%d mask=0x%llx",
           stage ? stage : "sin_etapa", MODEM_UART_PORT, MODEM_UART_TX_GPIO,
           MODEM_UART_RX_GPIO, MODEM_PWRKEY_GPIO, MODEM_SLEEP_GPIO,
           (unsigned long long)mask);
  if (mask != 0) {
    gpio_dump_io_configuration(stdout, mask);
  }
}

static void modem_powerkey_pulse_on(void) {
  const cellular_ppp_timing_profile_t *timing = timing_profile();
  if (MODEM_PWRKEY_GPIO < 0) {
    ESP_LOGW(TAG, "PWRKEY sin control por GPIO en este perfil — omitiendo pulso");
    return;
  }

  ESP_LOGI(TAG, "Modem A7670SA apagado/inestable — enviando pulso PWRKEY");
  ESP_ERROR_CHECK(gpio_set_level(MODEM_PWRKEY_GPIO, 0));
  vTaskDelay(pdMS_TO_TICKS(timing->pwrkey_pulse_ms));
  ESP_ERROR_CHECK(gpio_set_level(MODEM_PWRKEY_GPIO, 1));
  ESP_LOGI(TAG, "Pulso PWRKEY completado — esperando arranque del modem");
}

/*
 * Intenta recuperar AT cuando el modem puede haber quedado en modo datos
 * (por ejemplo, reset del ESP32 con PPP activa en el modem).
 */
static bool try_recover_at_from_data_mode(uint32_t timeout_ms) {
  if (!s_uart_ready) {
    return false;
  }

  char resp[128];
  if (at_send_cmd("AT", timeout_ms, resp, sizeof(resp), true)) {
    return true;
  }

  ESP_LOGW(TAG, "AT sin respuesta; intentando escape de modo datos (+++)");
  uart_flush_input(MODEM_UART_PORT);
  vTaskDelay(pdMS_TO_TICKS(1000));
  uart_write_bytes(MODEM_UART_PORT, "+++", 3);
  vTaskDelay(pdMS_TO_TICKS(1000));

  if (!at_send_cmd("AT", timeout_ms, resp, sizeof(resp), true)) {
    return false;
  }

  at_send_cmd("ATH", 3000, resp, sizeof(resp), false);
  ESP_LOGI(TAG, "Recuperacion AT via escape de datos completada");
  return true;
}

/* ─── PPP netif + driver binding ─────────────────────────────────────────── */

/*
 * ppp_uart_transmit — callback del driver esp_netif para enviar datos PPP
 * al modem. lwIP llama esto cuando tiene datos IP para transmitir.
 */
static esp_err_t ppp_uart_transmit(void *h, void *buffer, size_t len) {
  (void)h;
  if (!s_uart_ready || buffer == NULL || len == 0) {
    return ESP_FAIL;
  }
  int sent = uart_write_bytes(MODEM_UART_PORT, buffer, len);
  return (sent > 0) ? ESP_OK : ESP_FAIL;
}

/*
 * ppp_post_attach — llamado por esp_netif_attach() para configurar el driver.
 * Aquí registramos transmit callback y el handle.
 */
static esp_err_t ppp_post_attach(esp_netif_t *esp_netif, void *args) {
  ppp_uart_driver_t *drv = (ppp_uart_driver_t *)args;
  drv->base.netif = esp_netif;

  esp_netif_driver_ifconfig_t driver_ifconfig = {
      .driver_free_rx_buffer = NULL,
      .transmit = ppp_uart_transmit,
      .handle = drv,
  };

  esp_err_t err = esp_netif_set_driver_config(esp_netif, &driver_ifconfig);
  if (err != ESP_OK) {
    ESP_LOGE(TAG, "esp_netif_set_driver_config falló: %s", esp_err_to_name(err));
    return err;
  }

  return ESP_OK;
}

static esp_err_t create_ppp_netif(void) {
  if (s_ppp_netif != NULL) {
    return ESP_OK;
  }

  esp_netif_config_t ppp_cfg = ESP_NETIF_DEFAULT_PPP();
  s_ppp_netif = esp_netif_new(&ppp_cfg);
  if (s_ppp_netif == NULL) {
    return ESP_ERR_NO_MEM;
  }

  esp_netif_ppp_config_t netif_ppp_cfg = {
      .ppp_phase_event_enabled = true,
      .ppp_error_event_enabled = true,
  };
  esp_err_t err = esp_netif_ppp_set_params(s_ppp_netif, &netif_ppp_cfg);
  if (err != ESP_OK) {
    esp_netif_destroy(s_ppp_netif);
    s_ppp_netif = NULL;
    return err;
  }

  /* Adjuntar el driver UART al netif PPP */
  memset(&s_ppp_driver, 0, sizeof(s_ppp_driver));
  s_ppp_driver.base.post_attach = ppp_post_attach;

  err = esp_netif_attach(s_ppp_netif, &s_ppp_driver);
  if (err != ESP_OK) {
    ESP_LOGE(TAG, "esp_netif_attach falló: %s", esp_err_to_name(err));
    esp_netif_destroy(s_ppp_netif);
    s_ppp_netif = NULL;
    return err;
  }

  s_ppp_driver_attached = true;
  return ESP_OK;
}

static esp_err_t ensure_ppp_stack_ready(void) {
  esp_err_t err = create_ppp_netif();
  if (err != ESP_OK) {
    return err;
  }
  return register_ppp_handlers();
}

/* ─── Handlers de eventos PPP ────────────────────────────────────────────── */

static void on_ppp_ip_event(void *arg, esp_event_base_t event_base,
                            int32_t event_id, void *event_data) {
  (void)arg;
  (void)event_base;

  if (s_lock == NULL || s_ppp_netif == NULL) {
    return;
  }

  if (event_id == IP_EVENT_PPP_GOT_IP) {
    ip_event_got_ip_t *event = (ip_event_got_ip_t *)event_data;
    if (event == NULL || event->esp_netif != s_ppp_netif) {
      return;
    }

    xSemaphoreTake(s_lock, portMAX_DELAY);
    s_state.modem_alive = true;
    s_state.registered = true;
    s_state.attached = true;
    s_state.ppp_up = true;
    s_state.ppp_phase = CELLULAR_PPP_PHASE_RUNNING;
    ppp_fsm_apply_locked(CELLULAR_PPP_EVT_PHASE_RUNNING, CELLULAR_PPP_DIAG_INFO,
                         "ip_asignada");
    set_last_ppp_event_locked(event_id, ppp_event_to_str(event_id));
    copy_ip4_to_str(&event->ip_info.ip, s_state.ip, sizeof(s_state.ip));
    update_dns_from_netif_locked();
    s_state.last_error[0] = '\0';
    mark_recovered_locked("ppp_running");
    xSemaphoreGive(s_lock);

    ESP_LOGI(TAG, "PPP activo. IP: " IPSTR, IP2STR(&event->ip_info.ip));
    return;
  }

  if (event_id == IP_EVENT_PPP_LOST_IP) {
    xSemaphoreTake(s_lock, portMAX_DELAY);
    s_state.ppp_up = false;
    s_state.ip[0] = '\0';
    s_state.dns_primary[0] = '\0';
    s_state.dns_secondary[0] = '\0';
    s_state.ppp_phase = s_state.enabled ? CELLULAR_PPP_PHASE_IDLE
                                        : CELLULAR_PPP_PHASE_DISABLED;
    ppp_fsm_apply_locked(CELLULAR_PPP_EVT_IP_LOST, CELLULAR_PPP_DIAG_WARN,
                         "evento_ip_lost");
    set_last_ppp_event_locked(event_id, ppp_event_to_str(event_id));
    set_failure_locked(CELLULAR_PPP_FAIL_LOST_IP, "PPP_LOST_IP");
    xSemaphoreGive(s_lock);

    ESP_LOGW(TAG, "PPP perdio IP");
  }
}

static void on_ppp_status_event(void *arg, esp_event_base_t event_base,
                                int32_t event_id, void *event_data) {
  (void)arg;
  (void)event_base;
  (void)event_data;

  if (s_lock == NULL) {
    return;
  }

  cellular_ppp_fsm_event_t fsm_event = CELLULAR_PPP_EVT_COUNT;
  switch (event_id) {
  case NETIF_PPP_PHASE_INITIALIZE:
  case NETIF_PPP_PHASE_SERIALCONN:
    fsm_event = CELLULAR_PPP_EVT_PHASE_INITIALIZE;
    break;
  case NETIF_PPP_PHASE_ESTABLISH:
  case NETIF_PPP_PHASE_AUTHENTICATE:
  case NETIF_PPP_PHASE_CALLBACK:
  case NETIF_PPP_PHASE_NETWORK:
  case NETIF_PPP_PHASE_HOLDOFF:
  case NETIF_PPP_PHASE_DORMANT:
  case NETIF_PPP_PHASE_MASTER:
    fsm_event = CELLULAR_PPP_EVT_PHASE_NEGOTIATING;
    break;
  case NETIF_PPP_PHASE_RUNNING:
    fsm_event = CELLULAR_PPP_EVT_PHASE_RUNNING;
    break;
  case NETIF_PPP_PHASE_TERMINATE:
  case NETIF_PPP_PHASE_DISCONNECT:
  case NETIF_PPP_PHASE_DEAD:
    fsm_event = CELLULAR_PPP_EVT_PHASE_TERMINATE;
    break;
  default:
    break;
  }

  xSemaphoreTake(s_lock, portMAX_DELAY);
  set_last_ppp_event_locked(event_id, ppp_event_to_str(event_id));
  if (fsm_event < CELLULAR_PPP_EVT_COUNT) {
    ppp_fsm_apply_locked(fsm_event, CELLULAR_PPP_DIAG_INFO,
                         ppp_event_to_str(event_id));
  }
  if (event_id < NETIF_PP_PHASE_OFFSET || event_id >= NETIF_PPP_INTERNAL_ERR_OFFSET) {
    if (event_id != NETIF_PPP_ERRORNONE) {
      s_state.ppp_up = false;
      s_state.ip[0] = '\0';
      s_state.dns_primary[0] = '\0';
      s_state.dns_secondary[0] = '\0';
      s_state.ppp_phase = CELLULAR_PPP_PHASE_FAILED;
      ppp_fsm_apply_locked(CELLULAR_PPP_EVT_ERROR, CELLULAR_PPP_DIAG_ERROR,
                           ppp_error_to_str(event_id));
      s_state.ppp_retry_count++;
      set_failure_locked(CELLULAR_PPP_FAIL_INTERNAL, ppp_error_to_str(event_id));
    }
  } else {
    cellular_ppp_phase_t mapped = map_ppp_event_to_phase(event_id);
    if (!(mapped == CELLULAR_PPP_PHASE_IDLE && s_state.ppp_up)) {
      s_state.ppp_phase = mapped;
    }
  }
  xSemaphoreGive(s_lock);

  ESP_LOGI(TAG, "PPP evento de estado: %ld", (long)event_id);
}

static esp_err_t register_ppp_handlers(void) {
  if (s_ppp_handlers_registered) {
    return ESP_OK;
  }

  esp_err_t err = esp_event_handler_instance_register(
      IP_EVENT, ESP_EVENT_ANY_ID, &on_ppp_ip_event, NULL, &s_ppp_ip_any_handler);
  if (err != ESP_OK) {
    return err;
  }

  err = esp_event_handler_instance_register(NETIF_PPP_STATUS, ESP_EVENT_ANY_ID,
                                            &on_ppp_status_event, NULL,
                                            &s_ppp_status_any_handler);
  if (err != ESP_OK) {
    esp_event_handler_instance_unregister(IP_EVENT, ESP_EVENT_ANY_ID,
                                          s_ppp_ip_any_handler);
    return err;
  }

  s_ppp_handlers_registered = true;
  return ESP_OK;
}

/* ─── Tarea RX PPPoS ─────────────────────────────────────────────────────── */

/*
 * ppp_rx_task — lee bytes del UART y los alimenta al stack PPP via
 * esp_netif_receive(). Corre solo mientras s_ppp_active == true.
 * Cuando PPP no está activo, duerme para no consumir CPU.
 */
static void ppp_rx_task(void *arg) {
  (void)arg;
  uint8_t buf[512];

  while (1) {
    if (!s_ppp_active || s_ppp_netif == NULL) {
      vTaskDelay(pdMS_TO_TICKS(50));
      continue;
    }

    int len = uart_read_bytes(MODEM_UART_PORT, buf, sizeof(buf),
                              pdMS_TO_TICKS(20));
    if (len > 0 && s_ppp_netif != NULL) {
      esp_netif_receive(s_ppp_netif, buf, (size_t)len, NULL);
    }
  }
}

/* ─── Modem handle (PPP netif + driver) ──────────────────────────────────── */

/*
 * create_modem_handle — crea el PPP netif y registra handlers.
 * No toca UART. Idempotente gracias a s_modem_ready.
 */
static esp_err_t create_modem_handle(void) {
  if (s_modem_ready) {
    return ESP_OK;
  }

  esp_err_t err = validate_modem_hw_config();
  if (err != ESP_OK) {
    return err;
  }

  err = ensure_ppp_stack_ready();
  if (err != ESP_OK) {
    ESP_LOGW(TAG, "PPP stack no disponible: %s", esp_err_to_name(err));
    return err;
  }

  s_modem_ready = true;
  return ESP_OK;
}

/*
 * destroy_modem_handle — SOLO reset de estado.
 * NUNCA toca el driver UART (permanente).
 */
static void destroy_modem_handle(void) {
  s_modem_ready = false;
  s_apn_applied = false;
  /* No tocar s_uart_ready ni el driver UART */
}

/*
 * modem_power_off — apaga el módem A7670SA físicamente.
 * Primero intenta AT+CPOF, si no responde usa pulso de PWRKEY.
 */
static void modem_power_off(void) {
  if (MODEM_PWRKEY_GPIO < 0) {
    ESP_LOGW(TAG, "PWRKEY sin control GPIO — no se puede apagar módem físicamente");
    return;
  }

  const cellular_ppp_timing_profile_t *timing = timing_profile();
  char resp[64];

  /* Intentar apagado por comando AT */
  ESP_LOGI(TAG, "Intentando apagar módem con AT+CPOF...");
  if (at_send_cmd("AT+CPOF", timing->at_command_timeout_ms, resp, sizeof(resp), true)) {
    ESP_LOGI(TAG, "Módem apagado por comando AT");
    vTaskDelay(pdMS_TO_TICKS(500));
    return;
  }

  ESP_LOGW(TAG, "AT+CPOF sin respuesta — usando pulso PWRKEY");

  /* Pulso de PWRKEY: mantener bajo para apagar */
  gpio_set_level(MODEM_PWRKEY_GPIO, 0);
  vTaskDelay(pdMS_TO_TICKS(timing->pwrkey_pulse_ms));
  gpio_set_level(MODEM_PWRKEY_GPIO, 1);
  vTaskDelay(pdMS_TO_TICKS(500));

  ESP_LOGI(TAG, "Módem apagado por PWRKEY");
}

/* ─── APN ────────────────────────────────────────────────────────────────── */

static esp_err_t apply_apn_profile(void) {
  if (s_ppp_netif == NULL) {
    return ESP_ERR_INVALID_STATE;
  }
  if (s_apn_applied) {
    return ESP_OK;
  }

  char apn[64];
  char user[64];
  char pass[64];
  xSemaphoreTake(s_lock, portMAX_DELAY);
  strlcpy(apn, s_state.apn, sizeof(apn));
  strlcpy(user, s_state.user, sizeof(user));
  strlcpy(pass, s_state.pass, sizeof(pass));
  xSemaphoreGive(s_lock);

  /* Configurar PDP context via AT.
   * Si no hay APN configurado, limpiar explícitamente el APN del contexto PDP
   * para permitir provisión automática de red sin arrastrar perfiles viejos. */
  char at_cgdcont[128];
  if (apn[0] != '\0') {
    snprintf(at_cgdcont, sizeof(at_cgdcont), "AT+CGDCONT=1,\"IP\",\"%s\"", apn);
  } else {
    snprintf(at_cgdcont, sizeof(at_cgdcont), "AT+CGDCONT=1,\"IP\",\"\"");
    ESP_LOGI(TAG, "Sin APN configurado — limpiando contexto PDP para APN automático");
  }
  char resp[256];
  if (!at_send_cmd(at_cgdcont, 5000, resp, sizeof(resp), true)) {
    ESP_LOGW(TAG, "AT+CGDCONT falló — continuando con configuración actual del modem");
  }

  /* Configurar auth PPP si hay credenciales */
  esp_netif_auth_type_t auth_type = NETIF_PPP_AUTHTYPE_NONE;
  const char *auth_user = NULL;
  const char *auth_pass = NULL;
  if (user[0] != '\0' || pass[0] != '\0') {
    auth_type = NETIF_PPP_AUTHTYPE_PAP;
    auth_user = user;
    auth_pass = pass;
  }

  esp_err_t err = esp_netif_ppp_set_auth(s_ppp_netif, auth_type, auth_user, auth_pass);
  if (err != ESP_OK) {
    return err;
  }

  s_apn_applied = true;
  ESP_LOGI(TAG, "Perfil APN cargado: %s", apn);
  return ESP_OK;
}

/* ─── Poll de estado del modem ───────────────────────────────────────────── */

static bool poll_modem_status(void) {
  const cellular_ppp_timing_profile_t *timing = timing_profile();
  char resp[256];

  /*
   * Mientras PPP está activo/negociando en UART de datos, NO enviar AT.
   * Sin CMUX, mezclar AT con PPP produce timeouts falsos y recuperaciones
   * innecesarias.
   */
  if (s_lock != NULL) {
    bool ppp_up = false;
    cellular_ppp_phase_t phase = CELLULAR_PPP_PHASE_IDLE;

    xSemaphoreTake(s_lock, portMAX_DELAY);
    ppp_up = s_state.ppp_up;
    phase = s_state.ppp_phase;
    xSemaphoreGive(s_lock);

    if (s_ppp_active || ppp_up || phase == CELLULAR_PPP_PHASE_STARTING ||
        phase == CELLULAR_PPP_PHASE_NEGOTIATING ||
        phase == CELLULAR_PPP_PHASE_RUNNING) {
      return true;
    }
  }

  bool ok = false;
  const uint32_t at_retries = timing->at_max_retries;
  for (uint32_t i = 0; i < at_retries && !ok; i++) {
    if (s_lock != NULL) {
      bool ppp_up = false;
      cellular_ppp_phase_t phase = CELLULAR_PPP_PHASE_IDLE;

      xSemaphoreTake(s_lock, portMAX_DELAY);
      ppp_up = s_state.ppp_up;
      phase = s_state.ppp_phase;
      xSemaphoreGive(s_lock);

      if (s_ppp_active || ppp_up || phase == CELLULAR_PPP_PHASE_STARTING ||
          phase == CELLULAR_PPP_PHASE_NEGOTIATING ||
          phase == CELLULAR_PPP_PHASE_RUNNING) {
        ESP_LOGI(TAG, "Saltando sondeo AT: PPP activo/negociando");
        return true;
      }
    }

    ok = run_modem_command("AT", resp, sizeof(resp), timing->at_command_timeout_ms);
    if (!ok) {
      ESP_LOGW(TAG, "AT intento %lu/%lu sin OK — reintentando...",
               (unsigned long)(i + 1), (unsigned long)at_retries);
      vTaskDelay(pdMS_TO_TICKS(timing->at_retry_interval_ms));
    }
  }

  xSemaphoreTake(s_lock, portMAX_DELAY);
  s_state.modem_alive = ok;
  s_state.at_ready = ok;
  if (!ok) {
    s_state.sim_ready = false;
    s_state.registered = false;
    s_state.attached = false;
    s_state.rssi_dbm = 0;
    s_state.registration_status_code = -1;
    s_state.attach_status_code = -1;
    s_state.operator_name[0] = '\0';
    if (!s_state.ppp_up) {
      reset_ppp_runtime_state_locked();
    }
    set_failure_locked(CELLULAR_PPP_FAIL_MODEM_NO_RESPONSE, "MODEM_NO_RESPONSE");
  }
  xSemaphoreGive(s_lock);

  if (!ok) {
    destroy_modem_handle();

    if (try_recover_at_from_data_mode(timing->at_command_timeout_ms)) {
      ESP_LOGW(TAG, "AT recuperado sin pulsar PWRKEY; reintentando poll");
      return false;
    }

    ESP_LOGW(TAG, "Recuperacion: timeout AT sostenido, reiniciando modem");
    modem_powerkey_pulse_on();
    vTaskDelay(pdMS_TO_TICKS(timing->power_on_ready_window_ms));

    return false;
  }

  /* Deshabilitar eco para respuestas más limpias */
  at_send_cmd("ATE0", timing->at_command_timeout_ms, resp, sizeof(resp), false);

  bool sim_ready = false;
  if (run_modem_command("AT+CPIN?", resp, sizeof(resp),
                        timing->at_command_timeout_ms)) {
    sim_ready = strstr(resp, "READY") != NULL;
  }

  int reg_stat = -1;
  if (run_modem_command("AT+CREG?", resp, sizeof(resp),
                        timing->at_command_timeout_ms)) {
    reg_stat = parse_creg_stat(resp);
  }
  if (reg_stat < 0 &&
      run_modem_command("AT+CGREG?", resp, sizeof(resp),
                        timing->at_command_timeout_ms)) {
    reg_stat = parse_creg_stat(resp);
  }

  int attached_stat = -1;
  if (run_modem_command("AT+CGATT?", resp, sizeof(resp),
                        timing->at_command_timeout_ms)) {
    attached_stat = parse_cgatt_attached(resp);
  }

  /* AT+CEREG? — registro LTE específico (complementa CREG) */
  if (run_modem_command("AT+CEREG?", resp, sizeof(resp), timing->at_command_timeout_ms)) {
    ESP_LOGI(TAG, "[DIAG] CEREG: %s", resp);
    if (reg_stat < 0 || (!( reg_stat == 1 || reg_stat == 5))) {
      /* Intentar extraer stat de CEREG si CREG/CGREG fallaron */
      const char *p = strstr(resp, "+CEREG:");
      if (p) {
        int n = 0, stat = -1;
        if (sscanf(p, "+CEREG: %d,%d", &n, &stat) == 2 && (stat == 1 || stat == 5)) {
          reg_stat = stat;
          ESP_LOGI(TAG, "[DIAG] Registro detectado via CEREG: stat=%d", stat);
        }
      }
    }
  }

  /* AT+CPSI? — info completa del sistema (banda, frecuencia, MCC/MNC) */
  if (run_modem_command("AT+CPSI?", resp, sizeof(resp), 3000)) {
    ESP_LOGI(TAG, "[DIAG] CPSI: %s", resp);
  }

  int rssi = 0;
  if (run_modem_command("AT+CSQ", resp, sizeof(resp), timing->csq_timeout_ms)) {
    rssi = parse_csq_dbm(resp);
  }

  char op_name[32] = "";
  if (run_modem_command("AT+COPS?", resp, sizeof(resp), timing->cops_timeout_ms)) {
    parse_operator(resp, op_name, sizeof(op_name));
  }

  bool registered = (reg_stat == 1 || reg_stat == 5);
  bool attached = attached_stat == 1;

  /* Si está registrado pero no adjunto, intentar AT+CGATT=1 activamente */
  if (registered && !attached) {
    ESP_LOGI(TAG, "Registrado pero PS domain no adjunto — intentando AT+CGATT=1");
    if (run_modem_command("AT+CGATT=1", resp, sizeof(resp), 10000)) {
      ESP_LOGI(TAG, "AT+CGATT=1 OK — re-verificando adjunto");
      vTaskDelay(pdMS_TO_TICKS(2000));
      if (run_modem_command("AT+CGATT?", resp, sizeof(resp), timing->at_command_timeout_ms)) {
        attached_stat = parse_cgatt_attached(resp);
        attached = attached_stat == 1;
      }
    } else {
      ESP_LOGW(TAG, "AT+CGATT=1 falló: %s", resp);
    }
  }

  xSemaphoreTake(s_lock, portMAX_DELAY);
  s_state.sim_ready = sim_ready;
  s_state.registered = registered;
  s_state.attached = attached;
  s_state.rssi_dbm = rssi;
  s_state.registration_status_code = reg_stat;
  s_state.attach_status_code = attached_stat;
  strlcpy(s_state.operator_name, op_name, sizeof(s_state.operator_name));
  if (registered) {
    s_state.registration_retry_count = 0;
  } else {
    s_state.registration_retry_count++;
  }

  if (!sim_ready) {
    set_failure_locked(CELLULAR_PPP_FAIL_SIM_NOT_READY, "SIM_NOT_READY");
  } else if (!registered) {
    set_failure_locked(CELLULAR_PPP_FAIL_NOT_REGISTERED, "NOT_REGISTERED");
  } else if (!attached) {
    set_failure_locked(CELLULAR_PPP_FAIL_NOT_ATTACHED, "NOT_ATTACHED");
  } else if (!s_state.ppp_up) {
    s_state.last_error[0] = '\0';
    mark_recovered_locked("radio_registrado");
  }
  xSemaphoreGive(s_lock);

  return true;
}

static bool dial_ppp_and_wait_connect(const char *dial_cmd, uint32_t timeout_ms,
                                      char *resp, size_t resp_len) {
  if (dial_cmd == NULL || resp == NULL || resp_len < 2) {
    return false;
  }

  resp[0] = '\0';
  ESP_LOGI(TAG, "[AT] >> %s", dial_cmd);
  uart_flush_input(MODEM_UART_PORT);
  if (uart_write_bytes(MODEM_UART_PORT, dial_cmd, strlen(dial_cmd)) <= 0) {
    return false;
  }

  TickType_t start = xTaskGetTickCount();
  TickType_t dial_timeout = pdMS_TO_TICKS(timeout_ms);
  size_t used = 0;

  while ((xTaskGetTickCount() - start) < dial_timeout) {
    if (used >= resp_len - 1) {
      break;
    }

    int read = uart_read_bytes(MODEM_UART_PORT, (uint8_t *)(resp + used),
                               resp_len - used - 1, pdMS_TO_TICKS(200));
    if (read > 0) {
      used += (size_t)read;
      resp[used] = '\0';
      if (strstr(resp, "CONNECT") != NULL) {
        return true;
      }
      if (strstr(resp, "NO CARRIER") != NULL || strstr(resp, "ERROR") != NULL ||
          strstr(resp, "+CME ERROR") != NULL) {
        break;
      }
    }
  }

  return false;
}

/* ─── PPP session ────────────────────────────────────────────────────────── */

/*
 * start_ppp_session — secuencia AT + dial ATD*99***1# + PPPoS via esp_netif.
 *
 * Secuencia:
 *   1. AT+CGDCONT (en apply_apn_profile)
 *   2. AT+CGACT=1,1  (activar contexto PDP)
 *   3. ATD*99***1#\r  (solo \r, sin \n — crítico para A7670)
 *   4. Esperar "CONNECT" en respuesta
 *   5. esp_netif_action_start() → arranca el stack PPPoS
 */
static esp_err_t start_ppp_session(void) {
  if (!s_modem_ready) {
    return ESP_ERR_INVALID_STATE;
  }

  xSemaphoreTake(s_lock, portMAX_DELAY);
  if (!s_state.enabled || s_state.ppp_up ||
      s_state.ppp_phase == CELLULAR_PPP_PHASE_STARTING ||
      s_state.ppp_phase == CELLULAR_PPP_PHASE_NEGOTIATING) {
    xSemaphoreGive(s_lock);
    return ESP_OK;
  }
  if (!s_state.at_ready || !s_state.modem_alive) {
    xSemaphoreGive(s_lock);
    ESP_LOGW(TAG, "PPP bloqueado: modem sin AT listo confirmado");
    return ESP_ERR_INVALID_STATE;
  }
  s_state.ppp_phase = CELLULAR_PPP_PHASE_STARTING;
  ppp_fsm_apply_locked(CELLULAR_PPP_EVT_START_REQUEST, CELLULAR_PPP_DIAG_INFO,
                       "solicitud_inicio_ppp");
  xSemaphoreGive(s_lock);

  esp_err_t err = apply_apn_profile();
  if (err != ESP_OK) {
    xSemaphoreTake(s_lock, portMAX_DELAY);
    s_state.ppp_phase = CELLULAR_PPP_PHASE_FAILED;
    s_state.ppp_retry_count++;
    set_failure_locked(CELLULAR_PPP_FAIL_APN_CONFIG, "PPP_APN_CONFIG_FAILED");
    xSemaphoreGive(s_lock);
    return err;
  }

  /* Activar contexto PDP */
  char resp[256];
  if (!at_send_cmd("AT+CGACT=1,1", 15000, resp, sizeof(resp), true)) {
    ESP_LOGE(TAG, "AT+CGACT=1,1 falló");
    xSemaphoreTake(s_lock, portMAX_DELAY);
    s_state.ppp_phase = CELLULAR_PPP_PHASE_FAILED;
    s_state.ppp_retry_count++;
    set_failure_locked(CELLULAR_PPP_FAIL_START, "CGACT_FAILED");
    xSemaphoreGive(s_lock);
    return ESP_FAIL;
  }

  /* Dial — solo \r, sin \n (crítico para A7670SA) */
  bool got_connect =
      dial_ppp_and_wait_connect("ATD*99***1#\r", 30000, resp, sizeof(resp));

  if (!got_connect) {
    ESP_LOGE(TAG, "Dial ATD*99***1# sin CONNECT. Resp: %s", resp);

    /*
     * En algunos estados de red, A7670 devuelve
     * +CME ERROR: operation not allowed al dial *99.
     * Fallback: reset PDP, luego probar variante *99# y redial clásico.
     */
    if (strstr(resp, "operation not allowed") != NULL ||
        strstr(resp, "+CME ERROR: 3") != NULL) {
      ESP_LOGW(TAG, "Dial rechazado por red/modem; intentando fallback de redial");

      (void)at_send_cmd("AT+CGACT=0,1", 10000, resp, sizeof(resp), false);
      if (at_send_cmd("AT+CGACT=1,1", 15000, resp, sizeof(resp), true)) {
        if (dial_ppp_and_wait_connect("ATD*99#\r", 30000, resp, sizeof(resp)) ||
            dial_ppp_and_wait_connect("ATD*99***1#\r", 30000, resp,
                                      sizeof(resp))) {
          got_connect = true;
          ESP_LOGI(TAG, "CONNECT recibido via fallback de redial");
        }
      }
    }

    if (!got_connect) {
      xSemaphoreTake(s_lock, portMAX_DELAY);
      s_state.ppp_phase = CELLULAR_PPP_PHASE_FAILED;
      s_state.ppp_retry_count++;
      set_failure_locked(CELLULAR_PPP_FAIL_START, "PPP_NO_CONNECT");
      xSemaphoreGive(s_lock);
      return ESP_FAIL;
    }
  }

  ESP_LOGI(TAG, "CONNECT recibido — iniciando PPPoS");

  /* Arrancar tarea RX y el stack PPP */
  s_ppp_active = true;
  esp_netif_action_start(s_ppp_netif, NULL, 0, NULL);

  xSemaphoreTake(s_lock, portMAX_DELAY);
  s_state.ppp_phase = CELLULAR_PPP_PHASE_NEGOTIATING;
  s_state.last_error[0] = '\0';
  ppp_fsm_apply_locked(CELLULAR_PPP_EVT_PHASE_NEGOTIATING,
                       CELLULAR_PPP_DIAG_INFO, "modem_data_mode");
  xSemaphoreGive(s_lock);

  return ESP_OK;
}

/*
 * stop_ppp_session — secuencia de escape +++ y hang-up.
 * NUNCA toca el driver UART.
 */
static void stop_ppp_session(bool disable_manager) {
  if (s_ppp_active) {
    /* Secuencia de escape Hayes: guard time + +++ + guard time */
    vTaskDelay(pdMS_TO_TICKS(1000));
    uart_write_bytes(MODEM_UART_PORT, "+++", 3);
    vTaskDelay(pdMS_TO_TICKS(1000));

    /* Hang-up */
    char resp[64];
    at_send_cmd("ATH", 3000, resp, sizeof(resp), false);

    /* Detener stack PPP */
    s_ppp_active = false;
    if (s_ppp_netif != NULL) {
      esp_netif_action_stop(s_ppp_netif, NULL, 0, NULL);
    }
  }

  xSemaphoreTake(s_lock, portMAX_DELAY);
  ppp_fsm_apply_locked(CELLULAR_PPP_EVT_STOP_REQUEST, CELLULAR_PPP_DIAG_INFO,
                       "stop_ppp_session");
  reset_ppp_runtime_state_locked();
  if (disable_manager) {
    s_state.ppp_phase = CELLULAR_PPP_PHASE_DISABLED;
    ppp_fsm_apply_locked(CELLULAR_PPP_EVT_DISABLE, CELLULAR_PPP_DIAG_INFO,
                         "manager_disabled");
  }
  xSemaphoreGive(s_lock);
}

static void maybe_trigger_ppp_hard_recovery(
    const cellular_ppp_timing_profile_t *timing) {
  if (s_ppp_start_fail_streak < PPP_START_FAIL_THRESHOLD) {
    return;
  }

  TickType_t now = xTaskGetTickCount();
  if (s_last_ppp_hard_recovery_tick != 0 &&
      (now - s_last_ppp_hard_recovery_tick) <
          pdMS_TO_TICKS(PPP_HARD_RECOVERY_COOLDOWN_MS)) {
    ESP_LOGW(TAG,
             "Recovery fuerte diferido por cooldown (fallos consecutivos=%u)",
             (unsigned)s_ppp_start_fail_streak);
    return;
  }

  ESP_LOGW(TAG,
           "Recovery fuerte por fallos PPP consecutivos (%u): stop PPP + "
           "reinicio modem",
           (unsigned)s_ppp_start_fail_streak);

  s_ppp_start_fail_streak = 0;
  s_last_ppp_hard_recovery_tick = now;

  stop_ppp_session(false);
  destroy_modem_handle();
  modem_powerkey_pulse_on();
  vTaskDelay(pdMS_TO_TICKS(timing->power_on_ready_window_ms));

  if (s_lock != NULL) {
    xSemaphoreTake(s_lock, portMAX_DELAY);
    s_state.modem_alive = false;
    s_state.at_ready = false;
    s_state.sim_ready = false;
    s_state.registered = false;
    s_state.attached = false;
    s_state.ppp_up = false;
    s_state.ppp_phase = CELLULAR_PPP_PHASE_IDLE;
    set_failure_locked(CELLULAR_PPP_FAIL_START, "PPP_HARD_RECOVERY");
    xSemaphoreGive(s_lock);
  }
}

/* ─── Tarea principal cellular ───────────────────────────────────────────── */

/*
 * modem_one_time_config — configuración inicial del módulo, ejecutada UNA SOLA VEZ
 * después del boot guard. Fija tecnología LTE y fuerza adjuntar PS domain.
 */
static void modem_one_time_config(void) {
  char resp[256];
  const cellular_ppp_timing_profile_t *timing = timing_profile();

  /* Esperar AT alive */
  bool ok = false;
  for (int i = 0; i < 10 && !ok; i++) {
    ok = run_modem_command("AT", resp, sizeof(resp), timing->at_command_timeout_ms);
    if (!ok) vTaskDelay(pdMS_TO_TICKS(1000));
  }
  if (!ok) {
    ESP_LOGW(TAG, "[INIT] Módulo no responde AT — omitiendo config inicial");
    return;
  }

  /* Deshabilitar eco */
  run_modem_command("ATE0", resp, sizeof(resp), timing->at_command_timeout_ms);

  /* AT+CNMP=38 — preferir LTE solamente (evita saltos a 2G/EDGE)
   * 2=Auto, 13=GSM only, 38=LTE only, 51=GSM+LTE */
  if (run_modem_command("AT+CNMP=38", resp, sizeof(resp), 5000)) {
    ESP_LOGI(TAG, "[INIT] Tecnología fijada a LTE (AT+CNMP=38)");
  } else {
    ESP_LOGW(TAG, "[INIT] AT+CNMP=38 falló (%s) — probando Auto", resp);
    run_modem_command("AT+CNMP=2", resp, sizeof(resp), 5000);
  }

  /* Esperar re-registro después del cambio de banda */
  ESP_LOGI(TAG, "[INIT] Esperando re-registro tras cambio de tecnología...");
  vTaskDelay(pdMS_TO_TICKS(5000));

  /* AT+CGDCONT — configurar contexto PDP con APN correcto */
  char apn[64];
  xSemaphoreTake(s_lock, portMAX_DELAY);
  strlcpy(apn, s_state.apn, sizeof(apn));
  xSemaphoreGive(s_lock);
  {
    char cgdcont[128];
    if (apn[0] != '\0') {
      snprintf(cgdcont, sizeof(cgdcont), "AT+CGDCONT=1,\"IP\",\"%s\"", apn);
    } else {
      snprintf(cgdcont, sizeof(cgdcont), "AT+CGDCONT=1,\"IP\",\"\"");
    }
    run_modem_command(cgdcont, resp, sizeof(resp), timing->at_command_timeout_ms);
  }

  /* AT+CGATT=1 — forzar adjuntar PS domain para datos */
  ESP_LOGI(TAG, "[INIT] Forzando AT+CGATT=1 (PS domain attach)");
  if (run_modem_command("AT+CGATT=1", resp, sizeof(resp), 15000)) {
    ESP_LOGI(TAG, "[INIT] PS domain adjunto OK");
  } else {
    ESP_LOGW(TAG, "[INIT] AT+CGATT=1 falló: %s", resp);
  }

  ESP_LOGI(TAG, "[INIT] Configuración inicial del módulo completada");
}

static void cellular_task(void *arg) {
  (void)arg;

  const cellular_ppp_timing_profile_t *timing = timing_profile();

  vTaskDelay(pdMS_TO_TICKS(timing->boot_guard_ms));

  /* Verificar si el módem está habilitado ANTES de cualquier configuración */
  xSemaphoreTake(s_lock, portMAX_DELAY);
  bool enabled = s_state.enabled;
  xSemaphoreGive(s_lock);

  if (!enabled) {
    ESP_LOGI(TAG, "Módem deshabilitado — tarea en espera silenciosa");
    /* Loop sin actividad: solo esperar */
    while (1) {
      vTaskDelay(pdMS_TO_TICKS(timing->disabled_poll_ms));
      /* Verificar periódicamente si se habilitó */
      xSemaphoreTake(s_lock, portMAX_DELAY);
      enabled = s_state.enabled;
      xSemaphoreGive(s_lock);
      if (enabled) {
        ESP_LOGI(TAG, "Módem habilitado — iniciando configuración");
        break;
      }
    }
  }

  /* Configuración inicial del módulo — una sola vez */
  modem_one_time_config();

  while (1) {
    bool ppp_up;
    bool registered;
    bool attached;

    xSemaphoreTake(s_lock, portMAX_DELAY);
    enabled = s_state.enabled;
    ppp_up = s_state.ppp_up;
    registered = s_state.registered;
    attached = s_state.attached;
    xSemaphoreGive(s_lock);

    if (!enabled) {
      /* Módem deshabilitado en runtime — destruir handle y esperar sin polling */
      destroy_modem_handle();
      xSemaphoreTake(s_lock, portMAX_DELAY);
      s_state.at_ready = false;
      s_state.modem_alive = false;
      s_state.registered = false;
      s_state.attached = false;
      s_state.ppp_up = false;
      xSemaphoreGive(s_lock);
      vTaskDelay(pdMS_TO_TICKS(timing->disabled_poll_ms));

      /* Verificar si se habilitó mientras esperamos */
      xSemaphoreTake(s_lock, portMAX_DELAY);
      enabled = s_state.enabled;
      xSemaphoreGive(s_lock);
      if (enabled) {
        ESP_LOGI(TAG, "Módem habilitado — reiniciando comunicación");
        break;
      }
      continue;
    }

    esp_err_t err = create_modem_handle();
    if (err != ESP_OK) {
      set_last_error("MODEM_CREATE_FAILED");
      ESP_LOGW(TAG, "No se pudo crear modem handle: %s", esp_err_to_name(err));
      vTaskDelay(pdMS_TO_TICKS(timing->status_poll_ms));
      continue;
    }

    if (!ppp_up) {
      if (!poll_modem_status()) {
        vTaskDelay(pdMS_TO_TICKS(timing->status_poll_ms));
        continue;
      }

      xSemaphoreTake(s_lock, portMAX_DELAY);
      registered = s_state.registered;
      attached = s_state.attached;
      xSemaphoreGive(s_lock);

      bool at_ready;
      xSemaphoreTake(s_lock, portMAX_DELAY);
      at_ready = s_state.at_ready;
      xSemaphoreGive(s_lock);

      if (at_ready && registered && attached) {
        err = start_ppp_session();
        if (err != ESP_OK) {
          s_ppp_start_fail_streak++;
          ESP_LOGW(TAG, "Fallo inicio PPP consecutivo #%u",
                   (unsigned)s_ppp_start_fail_streak);
          maybe_trigger_ppp_hard_recovery(timing);
          ESP_LOGW(TAG, "No se pudo iniciar PPP: %s", esp_err_to_name(err));
        } else {
          s_ppp_start_fail_streak = 0;
        }
      } else if (!at_ready) {
        ESP_LOGW(TAG, "PPP no inicia: aun sin confirmacion de AT");
      }
    }

    vTaskDelay(pdMS_TO_TICKS(timing->status_poll_ms));
  }
}

/* ─── API pública ────────────────────────────────────────────────────────── */

const char *cellular_manager_ppp_phase_to_str(cellular_ppp_phase_t phase) {
  switch (phase) {
  case CELLULAR_PPP_PHASE_DISABLED:
    return "disabled";
  case CELLULAR_PPP_PHASE_IDLE:
    return "idle";
  case CELLULAR_PPP_PHASE_STARTING:
    return "starting";
  case CELLULAR_PPP_PHASE_NEGOTIATING:
    return "negotiating";
  case CELLULAR_PPP_PHASE_RUNNING:
    return "running";
  case CELLULAR_PPP_PHASE_STOPPING:
    return "stopping";
  case CELLULAR_PPP_PHASE_FAILED:
    return "failed";
  default:
    return "unknown";
  }
}

esp_err_t cellular_manager_init(void) {
  s_timing = cellular_ppp_timing_profile_default();
  const cellular_ppp_timing_profile_t *timing = timing_profile();

  /* Cargar modo de red desde NVS ANTES de inicializar el módem.
   * Si está deshabilitado, evitaremos toda comunicación AT. */
  {
    nvs_handle_t nvs_h;
    if (nvs_open("storage", NVS_READONLY, &nvs_h) == ESP_OK) {
      char mode_str[24] = "";
      size_t len = sizeof(mode_str);
      if (nvs_get_str(nvs_h, "network_mode", mode_str, &len) == ESP_OK) {
        if (strcmp(mode_str, "wifi_only") == 0) {
          ESP_LOGI(TAG, "Modo wifi_only detectado en NVS — cellular deshabilitado desde inicio");
          s_state.enabled = false;
        }
      }
      nvs_close(nvs_h);
    }
  }

  esp_err_t precheck_err = validate_modem_hw_config();
  if (precheck_err != ESP_OK) {
    return precheck_err;
  }

  if (s_lock == NULL) {
    s_lock = xSemaphoreCreateMutex();
    if (s_lock == NULL) {
      return ESP_ERR_NO_MEM;
    }
  }

  xSemaphoreTake(s_lock, portMAX_DELAY);
  cellular_ppp_failure_counters_reset(&s_state.failure_counters);
  cellular_ppp_diag_ring_init(&s_diag_ring, s_diag_storage,
                              CELLULAR_DIAG_RING_CAPACITY);
  s_state.at_ready = false;
  s_state.ppp_fsm_state = s_state.enabled ? CELLULAR_PPP_FSM_IDLE
                                          : CELLULAR_PPP_FSM_DISABLED;
  xSemaphoreGive(s_lock);

  /* Si está deshabilitado, NO inicializar UART ni enviar comandos AT.
   * Solo crear la tarea que esperará silenciosamente. */
  if (!s_state.enabled) {
    ESP_LOGI(TAG, "Cellular deshabilitado — omitiendo inicialización de modem");
    if (s_cell_task == NULL) {
      xTaskCreate(cellular_task, "cellular_task", CELL_TASK_STACK, NULL,
                  CELL_TASK_PRIO, &s_cell_task);
    }
    ESP_LOGI(TAG, "Cellular manager inicializado (modo deshabilitado)");
    return ESP_OK;
  }

  /* Configurar GPIOs de control de modem */
  uint64_t modem_ctrl_mask = 0;
  if (MODEM_PWRKEY_GPIO >= 0) {
    modem_ctrl_mask |= (1ULL << MODEM_PWRKEY_GPIO);
  }
  if (MODEM_SLEEP_GPIO >= 0) {
    modem_ctrl_mask |= (1ULL << MODEM_SLEEP_GPIO);
  }

  if (modem_ctrl_mask != 0) {
    gpio_config_t pwr_cfg = {
        .pin_bit_mask = modem_ctrl_mask,
        .mode = GPIO_MODE_OUTPUT,
        .pull_up_en = GPIO_PULLUP_DISABLE,
        .pull_down_en = GPIO_PULLDOWN_DISABLE,
        .intr_type = GPIO_INTR_DISABLE,
    };
    ESP_ERROR_CHECK(gpio_config(&pwr_cfg));
  }

  if (MODEM_SLEEP_GPIO >= 0) {
    ESP_ERROR_CHECK(gpio_set_level(MODEM_SLEEP_GPIO, 1));
  }

  if (MODEM_PWRKEY_GPIO >= 0) {
    ESP_ERROR_CHECK(gpio_set_level(MODEM_PWRKEY_GPIO, 1));
  }

  /* Instalar UART driver UNA SOLA VEZ aquí */
  esp_err_t uart_err = modem_uart_init();
  if (uart_err != ESP_OK) {
    ESP_LOGE(TAG, "Fallo inicializacion UART permanente: %s",
             esp_err_to_name(uart_err));
    return uart_err;
  }

  /* Verificar si el módulo ya está vivo ANTES de tocar PWRKEY.
   * En A7670SA el PWRKEY es un TOGGLE — si el módulo ya está encendido
   * y le mandamos pulso, lo APAGAMOS. Solo pulsamos si no responde AT. */
  if (MODEM_PWRKEY_GPIO >= 0) {
    char probe_resp[64];
    bool already_alive = at_send_cmd("AT", 2000, probe_resp, sizeof(probe_resp), true);
    if (already_alive) {
      ESP_LOGI(TAG, "Módulo ya activo — omitiendo pulso PWRKEY");
    } else {
      bool recovered = try_recover_at_from_data_mode(2000);
      if (recovered) {
        ESP_LOGI(TAG, "Módulo recuperado via escape de datos — sin pulso PWRKEY");
      } else {
        ESP_LOGI(TAG, "Módulo sin respuesta — enviando pulso PWRKEY");
        modem_powerkey_pulse_on();
      }
    }
  } else {
    ESP_LOGI(TAG, "Perfil sin PWRKEY GPIO: se asume modem energizado por la placa");
  }

  dump_modem_gpio_state("post_uart_init_permanente");

  ESP_LOGI(TAG, "Ventana de readiness modem: %lu ms",
           (unsigned long)timing->power_on_ready_window_ms);

  load_apn_from_nvs();

  /* Arrancar tarea RX para PPPoS */
  if (s_ppp_rx_task == NULL) {
    xTaskCreate(ppp_rx_task, "ppp_rx_task", PPP_RX_TASK_STACK, NULL,
                PPP_RX_TASK_PRIO, &s_ppp_rx_task);
  }

  /* Modem handle se crea lazy en cellular_task */
  if (s_cell_task == NULL) {
    xTaskCreate(cellular_task, "cellular_task", CELL_TASK_STACK, NULL,
                CELL_TASK_PRIO, &s_cell_task);
  }

  ESP_LOGI(TAG,
           "Cellular manager inicializado (UART%d TX=%d RX=%d, UART raw+PPPoS)",
           MODEM_UART_PORT, MODEM_UART_TX_GPIO, MODEM_UART_RX_GPIO);
  return ESP_OK;
}

void cellular_manager_set_enabled(bool enabled) {
  if (s_lock == NULL) {
    return;
  }

  xSemaphoreTake(s_lock, portMAX_DELAY);
  s_state.enabled = enabled;
  if (!enabled) {
    s_state.modem_alive = false;
    s_state.at_ready = false;
    s_state.sim_ready = false;
    s_state.registered = false;
    s_state.attached = false;
    s_apn_applied = false;
    reset_ppp_runtime_state_locked();
    s_state.ppp_phase = CELLULAR_PPP_PHASE_DISABLED;
    s_ppp_start_fail_streak = 0;
    ppp_fsm_apply_locked(CELLULAR_PPP_EVT_DISABLE, CELLULAR_PPP_DIAG_INFO,
                         "set_enabled_false");

    /* Apagar módem físicamente */
    modem_power_off();
  } else if (s_state.ppp_phase == CELLULAR_PPP_PHASE_DISABLED) {
    s_state.ppp_phase = CELLULAR_PPP_PHASE_IDLE;
    s_state.last_error[0] = '\0';
    s_ppp_start_fail_streak = 0;
    ppp_fsm_apply_locked(CELLULAR_PPP_EVT_ENABLE, CELLULAR_PPP_DIAG_INFO,
                         "set_enabled_true");
  }
  xSemaphoreGive(s_lock);
}

bool cellular_manager_is_enabled(void) {
  bool enabled = false;
  if (s_lock == NULL) {
    return false;
  }
  xSemaphoreTake(s_lock, portMAX_DELAY);
  enabled = s_state.enabled;
  xSemaphoreGive(s_lock);
  return enabled;
}

bool cellular_manager_is_registered(void) {
  bool registered = false;
  if (s_lock == NULL) {
    return false;
  }
  xSemaphoreTake(s_lock, portMAX_DELAY);
  registered = s_state.registered;
  xSemaphoreGive(s_lock);
  return registered;
}

bool cellular_manager_is_modem_alive(void) {
  bool alive = false;
  if (s_lock == NULL) {
    return false;
  }
  xSemaphoreTake(s_lock, portMAX_DELAY);
  alive = s_state.modem_alive;
  xSemaphoreGive(s_lock);
  return alive;
}

bool cellular_manager_is_attached(void) {
  bool attached = false;
  if (s_lock == NULL) {
    return false;
  }
  xSemaphoreTake(s_lock, portMAX_DELAY);
  attached = s_state.attached;
  xSemaphoreGive(s_lock);
  return attached;
}

bool cellular_manager_is_ppp_up(void) {
  bool ppp_up = false;
  if (s_lock == NULL) {
    return false;
  }
  xSemaphoreTake(s_lock, portMAX_DELAY);
  ppp_up = s_state.ppp_up;
  xSemaphoreGive(s_lock);
  return ppp_up;
}

bool cellular_manager_has_data_path(void) {
  bool has_data = false;
  if (s_lock == NULL) {
    return false;
  }
  xSemaphoreTake(s_lock, portMAX_DELAY);
  has_data = s_state.ppp_up && has_valid_ip(s_state.ip);
  xSemaphoreGive(s_lock);
  return has_data;
}

cellular_ppp_phase_t cellular_manager_get_ppp_phase(void) {
  cellular_ppp_phase_t phase = CELLULAR_PPP_PHASE_DISABLED;
  if (s_lock == NULL) {
    return phase;
  }
  xSemaphoreTake(s_lock, portMAX_DELAY);
  phase = s_state.ppp_phase;
  xSemaphoreGive(s_lock);
  return phase;
}

const char *cellular_manager_get_last_error(void) {
  static char last_error[64];

  last_error[0] = '\0';
  if (s_lock == NULL) {
    return last_error;
  }

  xSemaphoreTake(s_lock, portMAX_DELAY);
  strlcpy(last_error, s_state.last_error, sizeof(last_error));
  xSemaphoreGive(s_lock);
  return last_error;
}

esp_err_t cellular_manager_get_status_snapshot(
    cellular_status_snapshot_t *snapshot) {
  if (snapshot == NULL || s_lock == NULL) {
    return ESP_ERR_INVALID_ARG;
  }

  xSemaphoreTake(s_lock, portMAX_DELAY);
  snapshot->enabled = s_state.enabled;
  snapshot->modem_alive = s_state.modem_alive;
  snapshot->sim_ready = s_state.sim_ready;
  snapshot->registered = s_state.registered;
  snapshot->attached = s_state.attached;
  snapshot->ppp_up = s_state.ppp_up;
  snapshot->ppp_phase = s_state.ppp_phase;
  snapshot->rssi_dbm = s_state.rssi_dbm;
  snapshot->registration_status_code = s_state.registration_status_code;
  snapshot->attach_status_code = s_state.attach_status_code;
  snapshot->last_ppp_event_id = s_state.last_ppp_event_id;
  snapshot->ppp_fsm_state = s_state.ppp_fsm_state;
  snapshot->last_failure_code = s_state.failure_counters.last_code;
  snapshot->failure_total_count = s_state.failure_counters.total;
  snapshot->failure_consecutive_count = s_state.failure_counters.consecutive;
  snapshot->diagnostics_dropped_count = cellular_ppp_diag_ring_dropped(&s_diag_ring);
  snapshot->registration_retry_count = s_state.registration_retry_count;
  snapshot->ppp_retry_count = s_state.ppp_retry_count;
  strlcpy(snapshot->operator_name, s_state.operator_name,
          sizeof(snapshot->operator_name));
  strlcpy(snapshot->ip, s_state.ip, sizeof(snapshot->ip));
  strlcpy(snapshot->dns_primary, s_state.dns_primary,
          sizeof(snapshot->dns_primary));
  strlcpy(snapshot->dns_secondary, s_state.dns_secondary,
          sizeof(snapshot->dns_secondary));
  strlcpy(snapshot->last_ppp_event, s_state.last_ppp_event,
          sizeof(snapshot->last_ppp_event));
  strlcpy(snapshot->apn, s_state.apn, sizeof(snapshot->apn));
  strlcpy(snapshot->user, s_state.user, sizeof(snapshot->user));
  strlcpy(snapshot->pass, s_state.pass, sizeof(snapshot->pass));
  strlcpy(snapshot->last_error, s_state.last_error,
          sizeof(snapshot->last_error));
  xSemaphoreGive(s_lock);

  return ESP_OK;
}

int cellular_manager_get_rssi_dbm(void) {
  int rssi = 0;
  if (s_lock == NULL) {
    return 0;
  }
  xSemaphoreTake(s_lock, portMAX_DELAY);
  rssi = s_state.rssi_dbm;
  xSemaphoreGive(s_lock);
  return rssi;
}

const char *cellular_manager_get_operator(void) {
  static char op_name[32];
  op_name[0] = '\0';

  if (s_lock == NULL) {
    return op_name;
  }

  xSemaphoreTake(s_lock, portMAX_DELAY);
  strlcpy(op_name, s_state.operator_name, sizeof(op_name));
  xSemaphoreGive(s_lock);
  return op_name;
}

esp_err_t cellular_manager_set_apn_config(const char *apn, const char *user,
                                          const char *pass) {
  if (apn == NULL) {
    return ESP_ERR_INVALID_ARG;
  }

  esp_err_t err = save_apn_to_nvs(apn, user, pass);
  if (err != ESP_OK) {
    return err;
  }

  if (s_lock == NULL) {
    return ESP_OK;
  }

  xSemaphoreTake(s_lock, portMAX_DELAY);
  strlcpy(s_state.apn, apn, sizeof(s_state.apn));
  strlcpy(s_state.user, user ? user : "", sizeof(s_state.user));
  strlcpy(s_state.pass, pass ? pass : "", sizeof(s_state.pass));
  s_apn_applied = false;
  xSemaphoreGive(s_lock);

  return ESP_OK;
}

esp_err_t cellular_manager_get_apn_config(char *apn, size_t apn_len, char *user,
                                          size_t user_len, char *pass,
                                          size_t pass_len) {
  if (apn == NULL || apn_len == 0 || user == NULL || user_len == 0 ||
      pass == NULL || pass_len == 0 || s_lock == NULL) {
    return ESP_ERR_INVALID_ARG;
  }

  xSemaphoreTake(s_lock, portMAX_DELAY);
  strlcpy(apn, s_state.apn, apn_len);
  strlcpy(user, s_state.user, user_len);
  strlcpy(pass, s_state.pass, pass_len);
  xSemaphoreGive(s_lock);

  return ESP_OK;
}

size_t cellular_manager_get_diagnostics(cellular_ppp_diag_entry_t *entries,
                                        size_t max_entries,
                                        uint32_t *dropped_count) {
  if (s_lock == NULL || entries == NULL || max_entries == 0) {
    if (dropped_count != NULL) {
      *dropped_count = 0;
    }
    return 0;
  }

  xSemaphoreTake(s_lock, portMAX_DELAY);
  if (dropped_count != NULL) {
    *dropped_count = cellular_ppp_diag_ring_dropped(&s_diag_ring);
  }

  size_t available = cellular_ppp_diag_ring_size(&s_diag_ring);
  size_t to_copy = max_entries < available ? max_entries : available;
  for (size_t i = 0; i < to_copy; i++) {
    if (!cellular_ppp_diag_ring_get_latest(&s_diag_ring, i, &entries[i])) {
      to_copy = i;
      break;
    }
  }
  xSemaphoreGive(s_lock);

  return to_copy;
}

char *cellular_manager_get_status_json(void) {
  cJSON *root = cJSON_CreateObject();
  if (root == NULL) {
    return strdup("{}");
  }

  xSemaphoreTake(s_lock, portMAX_DELAY);
  cJSON_AddBoolToObject(root, "enabled", s_state.enabled);
  cJSON_AddBoolToObject(root, "modem_alive", s_state.modem_alive);
  cJSON_AddBoolToObject(root, "sim_ready", s_state.sim_ready);
  cJSON_AddBoolToObject(root, "registered", s_state.registered);
  cJSON_AddBoolToObject(root, "attached", s_state.attached);
  cJSON_AddBoolToObject(root, "ppp_up", s_state.ppp_up);
  cJSON_AddStringToObject(root, "ppp_phase",
                          cellular_manager_ppp_phase_to_str(s_state.ppp_phase));
  cJSON_AddNumberToObject(root, "rssi", s_state.rssi_dbm);
  cJSON_AddNumberToObject(root, "registration_status_code",
                          s_state.registration_status_code);
  cJSON_AddNumberToObject(root, "attach_status_code",
                          s_state.attach_status_code);
  cJSON_AddNumberToObject(root, "last_ppp_event_id",
                          s_state.last_ppp_event_id);
  cJSON_AddStringToObject(root, "ppp_fsm_state",
                          cellular_ppp_fsm_state_to_str(s_state.ppp_fsm_state));
  cJSON_AddStringToObject(
      root, "last_failure_code",
      cellular_ppp_failure_code_to_str(s_state.failure_counters.last_code));
  cJSON_AddNumberToObject(root, "failure_total_count",
                          s_state.failure_counters.total);
  cJSON_AddNumberToObject(root, "failure_consecutive_count",
                          s_state.failure_counters.consecutive);
  cJSON_AddNumberToObject(root, "diagnostics_dropped_count",
                          cellular_ppp_diag_ring_dropped(&s_diag_ring));
  cJSON_AddNumberToObject(root, "registration_retry_count",
                          s_state.registration_retry_count);
  cJSON_AddNumberToObject(root, "ppp_retry_count", s_state.ppp_retry_count);
  cJSON_AddStringToObject(root, "operator", s_state.operator_name);
  cJSON_AddStringToObject(root, "ip", s_state.ip);
  cJSON_AddStringToObject(root, "dns_primary", s_state.dns_primary);
  cJSON_AddStringToObject(root, "dns_secondary", s_state.dns_secondary);
  cJSON_AddStringToObject(root, "last_ppp_event", s_state.last_ppp_event);
  cJSON_AddStringToObject(root, "apn", s_state.apn);
  cJSON_AddStringToObject(root, "last_error", s_state.last_error);
  xSemaphoreGive(s_lock);

  char *json = cJSON_PrintUnformatted(root);
  cJSON_Delete(root);
  if (json == NULL) {
    return strdup("{}");
  }
  return json;
}
