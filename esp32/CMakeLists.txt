# ESP-IDF project: CEIoT environmental device (classic ESP32, 4 MB flash).

cmake_minimum_required(VERSION 3.16)

# Firmware version reported in telemetry (`firmware_version`) and by the web UI.
# Bump it for every image published for OTA.
set(PROJECT_VER "0.1.0")

include($ENV{IDF_PATH}/tools/cmake/project.cmake)

project(ceiot_env_device)
