cmake_minimum_required(VERSION 3.10)
project(ceiot_env_host_tests C)
enable_testing()

set(CMAKE_C_STANDARD 99)
set(CMAKE_C_STANDARD_REQUIRED ON)
set(CMAKE_C_EXTENSIONS OFF)
add_compile_options(-Wall -Wextra -Werror -pedantic)

set(FW ${CMAKE_CURRENT_SOURCE_DIR}/../main)

# cJSON is not vendored: reuse the copy the ESP-IDF component manager
# downloads for the firmware build (managed_components/, created by the first
# `idf.py build`). Override with -DCJSON_DIR=<dir with cJSON.c and cJSON.h>.
if(NOT CJSON_DIR)
  set(_cjson ${CMAKE_CURRENT_SOURCE_DIR}/../managed_components/espressif__cjson/cJSON)
  if(EXISTS ${_cjson}/cJSON.c)
    set(CJSON_DIR ${_cjson})
  endif()
endif()
if(NOT CJSON_DIR)
  message(FATAL_ERROR "cJSON not found. Run `idf.py build` once, or pass -DCJSON_DIR=<path to cJSON.c>.")
endif()

# cJSON is third-party code: build it without our strict warnings.
add_library(cjson STATIC ${CJSON_DIR}/cJSON.c)
target_include_directories(cjson PUBLIC ${CJSON_DIR})
target_compile_options(cjson PRIVATE -w)

add_library(sensor_logic STATIC ${FW}/sensor/sensor_logic.c)
target_include_directories(sensor_logic PUBLIC ${FW}/sensor ${FW}/config)
target_link_libraries(sensor_logic PUBLIC m)

add_executable(test_sensor_logic test_sensor_logic.c)
target_link_libraries(test_sensor_logic sensor_logic)
add_test(NAME sensor_logic COMMAND test_sensor_logic)

add_library(telemetry_payload STATIC ${FW}/telemetry/telemetry_payload.c)
target_include_directories(telemetry_payload PUBLIC ${FW}/telemetry)
target_link_libraries(telemetry_payload PUBLIC sensor_logic cjson m)

add_executable(test_telemetry_payload test_telemetry_payload.c)
target_link_libraries(test_telemetry_payload telemetry_payload)
add_test(NAME telemetry_payload COMMAND test_telemetry_payload)

add_library(button_logic STATIC ${FW}/button/button_logic.c)
target_include_directories(button_logic PUBLIC ${FW}/button)

add_executable(test_button_logic test_button_logic.c)
target_link_libraries(test_button_logic button_logic)
add_test(NAME button_logic COMMAND test_button_logic)

add_library(time_sync_logic STATIC ${FW}/timesync/time_sync_logic.c)
target_include_directories(time_sync_logic PUBLIC ${FW}/timesync)
target_link_libraries(time_sync_logic PUBLIC cjson m)

add_executable(test_time_sync_logic test_time_sync_logic.c)
target_link_libraries(test_time_sync_logic time_sync_logic)
add_test(NAME time_sync_logic COMMAND test_time_sync_logic)

add_library(ota_logic STATIC ${FW}/ota/ota_logic.c)
target_include_directories(ota_logic PUBLIC ${FW}/ota)
target_link_libraries(ota_logic PUBLIC cjson)

add_executable(test_ota_logic test_ota_logic.c)
target_link_libraries(test_ota_logic ota_logic)
add_test(NAME ota_logic COMMAND test_ota_logic)

add_library(mqtt_config_logic STATIC ${FW}/mqtt/mqtt_config_logic.c)
target_include_directories(mqtt_config_logic PUBLIC ${FW}/mqtt)

add_executable(test_mqtt_config_logic test_mqtt_config_logic.c)
target_link_libraries(test_mqtt_config_logic mqtt_config_logic)
add_test(NAME mqtt_config_logic COMMAND test_mqtt_config_logic)

add_library(provisioning_logic STATIC ${FW}/provisioning/provisioning_logic.c)
target_include_directories(provisioning_logic PUBLIC ${FW}/provisioning)
target_link_libraries(provisioning_logic PUBLIC cjson m)

add_executable(test_provisioning_logic test_provisioning_logic.c)
target_link_libraries(test_provisioning_logic provisioning_logic)
add_test(NAME provisioning_logic COMMAND test_provisioning_logic)
