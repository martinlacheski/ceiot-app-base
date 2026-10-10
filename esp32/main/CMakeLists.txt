# Main component. Registry dependencies (cJSON, MQTT, mDNS, LittleFS and the
# esp-idf-lib sensor drivers) come from idf_component.yml and are added to the
# requirements automatically.

idf_component_register(
    SRCS
        "main.c"
        "config/pins_config.c"
        "led/led_manager.c"
        "utils/watchdog.c"
        "wifi/wifi_manager.c"
        "network/network_manager.c"
        "web/web_server.c"
        "web/nvs_manager.c"
        "mqtt/mqtt_manager.c"
        "sensor/sensor.c"
        "sensor/sensor_logic.c"
        "telemetry/telemetry.c"
        "telemetry/telemetry_payload.c"
    INCLUDE_DIRS
        "."
        "config"
        "led"
        "utils"
        "wifi"
        "network"
        "web"
        "mqtt"
        "sensor"
        "telemetry"
    REQUIRES
        "esp_event"
        "esp_http_server"
        "esp_netif"
        "esp_wifi"
        "esp_timer"
        "esp_driver_gpio"
        "esp_app_format"
        "nvs_flash"
        "lwip"
)

# LittleFS image for the `storage` partition with the device mTLS material.
# The certificates are never committed (esp32/cert/ is gitignored): copy
# root.crt, client.crt and client.key into esp32/cert/ before building to
# flash them with `idf.py flash`. Without them the image is skipped and the
# certificates can be uploaded later from the web UI (MQTT page).
set(CERT_SRC_DIR "${CMAKE_CURRENT_LIST_DIR}/../cert")
set(CERT_FILES root.crt client.crt client.key)
set(CERT_IMAGE_DIR "${CMAKE_BINARY_DIR}/littlefs_image")
set(CERTS_PRESENT TRUE)
foreach(cert_file ${CERT_FILES})
    if(NOT EXISTS "${CERT_SRC_DIR}/${cert_file}")
        set(CERTS_PRESENT FALSE)
    endif()
endforeach()

if(CERTS_PRESENT)
    file(REMOVE_RECURSE "${CERT_IMAGE_DIR}")
    foreach(cert_file ${CERT_FILES})
        configure_file("${CERT_SRC_DIR}/${cert_file}"
                       "${CERT_IMAGE_DIR}/${cert_file}" COPYONLY)
    endforeach()
    littlefs_create_partition_image(storage "${CERT_IMAGE_DIR}" FLASH_IN_PROJECT)
else()
    message(WARNING "esp32/cert/{root.crt,client.crt,client.key} not found: "
                    "building without the LittleFS certificate image. Upload "
                    "the certificates from the web UI or add them and rebuild.")
endif()
