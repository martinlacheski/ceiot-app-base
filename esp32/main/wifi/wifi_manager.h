/*
 * wifi_manager.h
 *
 * Módulo de gestión de WiFi, mDNS y NTP.
 */

#ifndef WIFI_MANAGER_H
#define WIFI_MANAGER_H

#include "esp_err.h"
#include <stdbool.h>
#include <stddef.h>

typedef struct {
  bool connected;
  bool ap_active;
  int rssi_dbm;
  int last_disconnect_reason;
  char ssid[33];
  char ip[16];
  char saved_ssid[33];
  char last_error[32];
} wifi_status_snapshot_t;

// Inicializa el subsistema WiFi (STA y/o AP según configuración)
esp_err_t wifi_manager_init(void);

// Verifica si estamos conectados a una red WiFi (STA)
bool wifi_manager_is_connected(void);

// Fuerza el modo AP (por ejemplo, al pulsar el botón de configuración)
void wifi_manager_start_ap(void);

// Detiene el modo AP
void wifi_manager_stop_ap(void);

// Verifica si el modo AP está activo
bool wifi_manager_is_ap_active(void);

// Inicia un escaneo de redes WiFi (asíncrono, resultados por log por ahora)
void wifi_manager_scan(void);

// Obtiene los resultados del último escaneo en formato JSON string
// El caller es responsable de liberar la memoria (free)
char *wifi_manager_get_scan_results_json(void);

// Obtiene el estado actual de la conexión (SSID, IP, RSSI) en JSON
char *wifi_manager_get_status_json(void);

// Obtiene el último error de conexión/desconexión (ej: AUTH_FAIL)
const char *wifi_manager_get_last_error(void);
int wifi_manager_get_last_disconnect_reason(void);
const char *wifi_manager_disconnect_reason_to_str(int reason);
esp_err_t wifi_manager_get_status_snapshot(wifi_status_snapshot_t *snapshot);

// Configura las credenciales WiFi y reinicia la conexión
esp_err_t wifi_manager_set_config(const char *ssid, const char *password);

// Borra la configuración WiFi almacenada y desconecta (regresa a modo AP si es
// necesario)
esp_err_t wifi_manager_clear_config(void);

// Obtiene la configuración guardada (principalmente el SSID)
// Retorna ESP_OK si hay configuración, ESP_FAIL si no
esp_err_t wifi_manager_get_saved_config(char *ssid, size_t max_len);

// Obtiene el RSSI actual del AP conectado (en dBm)
int wifi_manager_get_rssi(void);

// Obtiene el SSID actual del AP conectado
const char *wifi_manager_get_ssid(void);

// Obtiene la IP actual del STA conectado
const char *wifi_manager_get_ip(void);

#endif // WIFI_MANAGER_H
