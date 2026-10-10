# ESP-IDF project: CEIoT environmental device (classic ESP32, 4 MB flash).

cmake_minimum_required(VERSION 3.16)

# Firmware version reported in telemetry (`firmware_version`) and by the web UI.
# Bump it for every image published for OTA.
set(PROJECT_VER "0.2.0")

include($ENV{IDF_PATH}/tools/cmake/project.cmake)

# The backend and the web app only accept OTA images whose descriptor project
# name is `iot_device` (backend/app/api/device/firmware/rules.py,
# FIRMWARE_PROJECT): keep this name. The image is build/iot_device.bin.
project(iot_device)
