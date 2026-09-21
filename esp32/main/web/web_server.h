/*
 * web_server.h
 *
 * Servidor Web Básico para configuración y estado.
 */

#ifndef WEB_SERVER_H
#define WEB_SERVER_H

#include "esp_err.h"

// Inicia el servidor web
esp_err_t web_server_start(void);

// Detiene el servidor web
void web_server_stop(void);

// Ejecuta el restablecimiento de fábrica (borra NVS y certificados, reinicia)
void factory_reset_device(void *arg);

#endif // WEB_SERVER_H
