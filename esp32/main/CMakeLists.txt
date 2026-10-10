# Main component. Registry dependencies (cJSON, MQTT, mDNS, LittleFS and the
# esp-idf-lib sensor drivers) come from idf_component.yml and are added to the
# requirements automatically.

idf_component_register(
    SRCS
        "main.c"
        "button/button_logic.c"
        "config/pins_config.c"
        "led/led_manager.c"
        "utils/watchdog.c"
        "wifi/wifi_manager.c"
        "network/network_manager.c"
        "web/web_server.c"
        "web/nvs_manager.c"
        "mqtt/mqtt_manager.c"
        "mqtt/mqtt_config_logic.c"
        "ota/ota_logic.c"
        "ota/ota_manager.c"
        "provisioning/provisioning_logic.c"
        "sensor/sensor.c"
        "sensor/sensor_logic.c"
        "telemetry/telemetry.c"
        "telemetry/telemetry_payload.c"
        "timesync/time_sync.c"
        "timesync/time_sync_logic.c"
    INCLUDE_DIRS
        "."
        "button"
        "config"
        "led"
        "utils"
        "wifi"
        "network"
        "web"
        "mqtt"
        "ota"
        "provisioning"
        "sensor"
        "telemetry"
        "timesync"
    REQUIRES
        "esp_event"
        "esp_http_server"
        "esp_http_client"
        "esp_netif"
        "esp_wifi"
        "esp_timer"
        "esp_driver_gpio"
        "esp_app_format"
        "app_update"
        "esp_partition"
        "mbedtls"
        "nvs_flash"
        "lwip"
)

# Sensor variant: config/config.h holds the default (SENSOR_MODEL), a build
# can override it without editing files:
#   idf.py -B build-dht11 -DCEIOT_SENSOR=dht11 build
# CEIOT_SENSOR is a CMake cache variable, so it sticks to its build directory:
# use one build directory per variant (or `-DCEIOT_SENSOR=` to go back to the
# config.h default in the same directory).
set(CEIOT_SENSOR "" CACHE STRING "Sensor variant override: dht11, dht22, bmp280 or bme280 (empty = config.h)")
if(CEIOT_SENSOR)
    string(TOUPPER "${CEIOT_SENSOR}" _ceiot_sensor)
    if(NOT _ceiot_sensor MATCHES "^(DHT11|DHT22|BMP280|BME280)$")
        message(FATAL_ERROR "CEIOT_SENSOR=${CEIOT_SENSOR}: expected dht11, dht22, bmp280 or bme280")
    endif()
    target_compile_definitions(${COMPONENT_LIB} PRIVATE SENSOR_MODEL=SENSOR_${_ceiot_sensor})
    message(STATUS "CEIoT sensor variant: ${_ceiot_sensor} (CEIOT_SENSOR override)")
else()
    message(STATUS "CEIoT sensor variant: config/config.h default (SENSOR_MODEL)")
endif()

# LittleFS image for the `storage` partition with the device mTLS material.
# The certificates are never committed (esp32/cert/ is gitignored): copy
# root.crt, client.crt and client.key into esp32/cert/ before building to
# flash them with `idf.py flash`. provisioning/provision.py stages them there
# together with serial.txt and provisioning.json (serial and broker profile,
# read into NVS at the first boot); both are optional. Without the
# certificates the image is skipped and they can be uploaded later from the
# web UI (MQTT page). The file list is fixed at configure time: run
# `idf.py reconfigure` (or use a fresh build directory) after staging another
# device.
set(CERT_SRC_DIR "${CMAKE_CURRENT_LIST_DIR}/../cert")
set(CERT_FILES root.crt client.crt client.key)
set(PROVISIONING_FILES serial.txt provisioning.json)
set(CERT_IMAGE_DIR "${CMAKE_BINARY_DIR}/littlefs_image")
set(CERTS_PRESENT TRUE)
foreach(cert_file ${CERT_FILES})
    if(NOT EXISTS "${CERT_SRC_DIR}/${cert_file}")
        set(CERTS_PRESENT FALSE)
    endif()
endforeach()

if(CERTS_PRESENT)
    file(REMOVE_RECURSE "${CERT_IMAGE_DIR}")
    set(IMAGE_FILES ${CERT_FILES})
    foreach(extra_file ${PROVISIONING_FILES})
        if(EXISTS "${CERT_SRC_DIR}/${extra_file}")
            list(APPEND IMAGE_FILES ${extra_file})
        endif()
    endforeach()
    foreach(image_file ${IMAGE_FILES})
        configure_file("${CERT_SRC_DIR}/${image_file}"
                       "${CERT_IMAGE_DIR}/${image_file}" COPYONLY)
    endforeach()
    message(STATUS "LittleFS image files: ${IMAGE_FILES}")
    littlefs_create_partition_image(storage "${CERT_IMAGE_DIR}" FLASH_IN_PROJECT)
else()
    message(WARNING "esp32/cert/{root.crt,client.crt,client.key} not found: "
                    "building without the LittleFS certificate image. Upload "
                    "the certificates from the web UI or add them and rebuild.")
endif()
