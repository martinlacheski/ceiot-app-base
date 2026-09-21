/*
 * nvs_manager.c
 */

#include "nvs_manager.h"
#include "esp_log.h"
#include "nvs.h"
#include "nvs_flash.h"
#include <fcntl.h>
#include <stdio.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>

static const char *TAG = "NVS_MGR";

static char *read_file_to_buf(const char *path, size_t *out_len) {
  FILE *f = fopen(path, "rb");
  if (!f)
    return NULL;
  fseek(f, 0, SEEK_END);
  long size = ftell(f);
  fseek(f, 0, SEEK_SET);
  if (size <= 0) {
    fclose(f);
    return NULL;
  }

  char *buf = malloc(size);
  if (buf) {
    fread(buf, 1, size, f);
    *out_len = size;
  }
  fclose(f);
  return buf;
}

static esp_err_t write_buf_to_file(const char *path, const char *buf,
                                   size_t len) {
  // Ensure dir exists
  char temp_path[64];
  strncpy(temp_path, path, sizeof(temp_path));
  char *p = strrchr(temp_path, '/');
  if (p) {
    *p = '\0';
    mkdir(temp_path, 0775); // Try to create dir (ignore error if exists)
  }

  FILE *f = fopen(path, "wb");
  if (!f)
    return ESP_FAIL;
  size_t written = fwrite(buf, 1, len, f);
  fclose(f);
  return (written == len) ? ESP_OK : ESP_FAIL;
}

esp_err_t nvs_manager_init(void) {
  esp_err_t ret = nvs_flash_init();
  if (ret == ESP_ERR_NVS_NO_FREE_PAGES ||
      ret == ESP_ERR_NVS_NEW_VERSION_FOUND) {
    ESP_ERROR_CHECK(nvs_flash_erase());
    ret = nvs_flash_init();
  }

  // Migración: copiar sensor_code a serial si existe (one-time migration)
  nvs_handle_t nvs_h;
  if (nvs_open("storage", NVS_READWRITE, &nvs_h) == ESP_OK) {
    char serial[32] = "";
    char sensor_code[32] = "";
    size_t len;

    // Verificar si ya existe serial
    len = sizeof(serial);
    bool has_serial = (nvs_get_str(nvs_h, "serial", serial, &len) == ESP_OK &&
                       serial[0] != '\0');

    // Si no hay serial, buscar en sensor_code
    if (!has_serial) {
      len = sizeof(sensor_code);
      if (nvs_get_str(nvs_h, "sensor_code", sensor_code, &len) == ESP_OK &&
          sensor_code[0] != '\0') {
        // Migrar sensor_code -> serial
        nvs_set_str(nvs_h, "serial", sensor_code);
        nvs_commit(nvs_h);
        ESP_LOGI(TAG, "Migrado sensor_code -> serial: %s", sensor_code);
      }
    }
    nvs_close(nvs_h);
  }

  // También migrar en factory namespace
  if (nvs_open("factory", NVS_READWRITE, &nvs_h) == ESP_OK) {
    char serial[32] = "";
    char sensor_code[32] = "";
    size_t len;

    len = sizeof(serial);
    bool has_serial = (nvs_get_str(nvs_h, "serial", serial, &len) == ESP_OK &&
                       serial[0] != '\0');

    if (!has_serial) {
      len = sizeof(sensor_code);
      if (nvs_get_str(nvs_h, "sensor_code", sensor_code, &len) == ESP_OK &&
          sensor_code[0] != '\0') {
        nvs_set_str(nvs_h, "serial", sensor_code);
        nvs_commit(nvs_h);
        ESP_LOGI(TAG, "Migrado factory sensor_code -> serial: %s", sensor_code);
      }
    }
    nvs_close(nvs_h);
  }

  return ret;
}

static void save_file_to_nvs(nvs_handle_t h, const char *nvs_key,
                             const char *filepath) {
  size_t len = 0;
  char *buf = read_file_to_buf(filepath, &len);
  if (buf) {
    nvs_set_blob(h, nvs_key, buf, len);
    ESP_LOGI(TAG, "Saved %s to NVS key %s (%d bytes)", filepath, nvs_key,
             (int)len);
    free(buf);
  } else {
    ESP_LOGW(TAG, "File %s not found, skipping NVS save", filepath);
  }
}

static void restore_file_from_nvs(nvs_handle_t h, const char *nvs_key,
                                  const char *filepath) {
  size_t len = 0;
  if (nvs_get_blob(h, nvs_key, NULL, &len) == ESP_OK && len > 0) {
    char *buf = malloc(len);
    if (buf) {
      nvs_get_blob(h, nvs_key, buf, &len);
      write_buf_to_file(filepath, buf, len);
      ESP_LOGI(TAG, "Restored %s from NVS key %s", filepath, nvs_key);
      free(buf);
    }
  } else {
    ESP_LOGW(TAG, "NVS key %s not found, skipping restore", nvs_key);
  }
}

static void copy_string_nvs(nvs_handle_t h_src, nvs_handle_t h_dest,
                            const char *key) {
  char buf[128];
  size_t len = sizeof(buf);
  if (nvs_get_str(h_src, key, buf, &len) == ESP_OK) {
    nvs_set_str(h_dest, key, buf);
  }
}

static bool nvs_str_exists(nvs_handle_t h, const char *key) {
  size_t len = 0;
  esp_err_t err = nvs_get_str(h, key, NULL, &len);
  return (err == ESP_OK && len > 1);
}

static bool nvs_blob_exists(nvs_handle_t h, const char *key) {
  size_t len = 0;
  esp_err_t err = nvs_get_blob(h, key, NULL, &len);
  return (err == ESP_OK && len > 0);
}

bool factory_has_serial(void) {
  nvs_handle_t h_factory;
  if (nvs_open("factory", NVS_READONLY, &h_factory) != ESP_OK) {
    return false;
  }
  bool exists = nvs_str_exists(h_factory, "serial");
  nvs_close(h_factory);
  return exists;
}

esp_err_t factory_store_serial_if_missing(const char *serial) {
  if (serial == NULL || serial[0] == '\0') {
    return ESP_ERR_INVALID_ARG;
  }

  nvs_handle_t h_factory;
  esp_err_t err = nvs_open("factory", NVS_READWRITE, &h_factory);
  if (err != ESP_OK) {
    return err;
  }

  if (nvs_str_exists(h_factory, "serial")) {
    nvs_close(h_factory);
    return ESP_OK;
  }

  nvs_set_str(h_factory, "serial", serial);
  nvs_commit(h_factory);
  nvs_close(h_factory);
  ESP_LOGI(TAG, "Factory serial guardado");
  return ESP_OK;
}

esp_err_t factory_store_certs_if_missing(void) {
  nvs_handle_t h_factory;
  esp_err_t err = nvs_open("factory", NVS_READWRITE, &h_factory);
  if (err != ESP_OK) {
    return err;
  }

  if (!nvs_blob_exists(h_factory, "root_crt")) {
    save_file_to_nvs(h_factory, "root_crt", "/littlefs/root.crt");
  }
  if (!nvs_blob_exists(h_factory, "cl_crt")) {
    save_file_to_nvs(h_factory, "cl_crt", "/littlefs/client.crt");
  }
  if (!nvs_blob_exists(h_factory, "cl_key")) {
    save_file_to_nvs(h_factory, "cl_key", "/littlefs/client.key");
  }

  nvs_commit(h_factory);
  nvs_close(h_factory);
  return ESP_OK;
}

esp_err_t factory_store_tls_snapshot(void) {
  nvs_handle_t h_factory;
  esp_err_t err = nvs_open("factory", NVS_READWRITE, &h_factory);
  if (err != ESP_OK) {
    return err;
  }

  save_file_to_nvs(h_factory, "root_crt", "/littlefs/root.crt");
  save_file_to_nvs(h_factory, "cl_crt", "/littlefs/client.crt");
  save_file_to_nvs(h_factory, "cl_key", "/littlefs/client.key");

  nvs_handle_t h_storage;
  if (nvs_open("storage", NVS_READONLY, &h_storage) == ESP_OK) {
    copy_string_nvs(h_storage, h_factory, "mqtt_use_tls");
    nvs_close(h_storage);
  }

  nvs_commit(h_factory);
  nvs_close(h_factory);
  return ESP_OK;
}

esp_err_t restore_factory_defaults(void) {
  nvs_handle_t h_factory;
  esp_err_t err = nvs_open("factory", NVS_READONLY, &h_factory);
  if (err != ESP_OK) {
    return err;
  }

  // Restore serial to storage if missing
  if (nvs_str_exists(h_factory, "serial")) {
    nvs_handle_t h_storage;
    if (nvs_open("storage", NVS_READWRITE, &h_storage) == ESP_OK) {
      char serial[32] = "";
      size_t len = sizeof(serial);
      bool has_active =
          nvs_get_str(h_storage, "serial", serial, &len) == ESP_OK &&
          serial[0] != '\0';
      if (!has_active) {
        len = sizeof(serial);
        if (nvs_get_str(h_factory, "serial", serial, &len) == ESP_OK) {
          nvs_set_str(h_storage, "serial", serial);
          nvs_commit(h_storage);
        }
      }
      nvs_close(h_storage);
    }
  }

  // Restore certs if missing in LittleFS
  struct stat st;
  if (stat("/littlefs/root.crt", &st) != 0 &&
      nvs_blob_exists(h_factory, "root_crt")) {
    restore_file_from_nvs(h_factory, "root_crt", "/littlefs/root.crt");
  }
  if (stat("/littlefs/client.crt", &st) != 0 &&
      nvs_blob_exists(h_factory, "cl_crt")) {
    restore_file_from_nvs(h_factory, "cl_crt", "/littlefs/client.crt");
  }
  if (stat("/littlefs/client.key", &st) != 0 &&
      nvs_blob_exists(h_factory, "cl_key")) {
    restore_file_from_nvs(h_factory, "cl_key", "/littlefs/client.key");
  }

  // Restore TLS flag if missing in storage
  if (nvs_str_exists(h_factory, "mqtt_use_tls")) {
    nvs_handle_t h_storage;
    if (nvs_open("storage", NVS_READWRITE, &h_storage) == ESP_OK) {
      if (!nvs_str_exists(h_storage, "mqtt_use_tls")) {
        copy_string_nvs(h_factory, h_storage, "mqtt_use_tls");
        nvs_commit(h_storage);
      }
      nvs_close(h_storage);
    }
  }

  nvs_close(h_factory);
  return ESP_OK;
}

esp_err_t save_factory_snapshot(void) {
  nvs_handle_t h_factory, h_storage;
  esp_err_t err = nvs_open("factory", NVS_READWRITE, &h_factory);
  if (err != ESP_OK)
    return err;

  uint8_t exists = 0;
  nvs_get_u8(h_factory, "factory_set", &exists);
  if (exists) {
    ESP_LOGI(TAG, "Factory snapshot already exists. Skipping.");
    nvs_close(h_factory);
    return ESP_OK;
  }

  ESP_LOGI(TAG, "Creating Factory Snapshot...");

  // 1. Save Certs
  save_file_to_nvs(h_factory, "root_crt", "/littlefs/root.crt");
  save_file_to_nvs(h_factory, "cl_crt", "/littlefs/client.crt");
  save_file_to_nvs(h_factory, "cl_key", "/littlefs/client.key");

  // 2. Save MQTT Config
  if (nvs_open("storage", NVS_READONLY, &h_storage) == ESP_OK) {
    copy_string_nvs(h_storage, h_factory, "mqtt_uri");
    copy_string_nvs(h_storage, h_factory, "mqtt_port");
    copy_string_nvs(h_storage, h_factory, "mqtt_use_tls");
    nvs_close(h_storage);
  }

  // Mark as set
  nvs_set_u8(h_factory, "factory_set", 1);
  nvs_commit(h_factory);
  nvs_close(h_factory);
  ESP_LOGI(TAG, "Factory snapshot saved successfully.");
  return ESP_OK;
}

esp_err_t restore_factory_snapshot(void) {
  nvs_handle_t h_factory, h_storage;
  esp_err_t err = nvs_open("factory", NVS_READONLY, &h_factory);
  if (err != ESP_OK) {
    ESP_LOGE(TAG, "No factory snapshot found!");
    return err;
  }

  ESP_LOGI(TAG, "Restoring Factory Snapshot...");

  // 1. Restore Certs
  // Ensure clean slate? Optional, write_buf_to_file overwrites.
  restore_file_from_nvs(h_factory, "root_crt", "/littlefs/root.crt");
  restore_file_from_nvs(h_factory, "cl_crt", "/littlefs/client.crt");
  restore_file_from_nvs(h_factory, "cl_key", "/littlefs/client.key");

  // 2. Restore MQTT Config
  if (nvs_open("storage", NVS_READWRITE, &h_storage) == ESP_OK) {
    copy_string_nvs(h_factory, h_storage, "mqtt_uri");
    copy_string_nvs(h_factory, h_storage, "mqtt_port");
    copy_string_nvs(h_factory, h_storage, "mqtt_use_tls");
    nvs_commit(h_storage);
    nvs_close(h_storage);
  }

  nvs_close(h_factory);
  ESP_LOGI(TAG, "Factory snapshot restored.");
  return ESP_OK;
}
