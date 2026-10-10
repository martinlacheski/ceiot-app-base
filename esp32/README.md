# CEIoT environmental device firmware (ESP32)

Firmware for the ESP32-WROOM-32 boards (classic ESP32, 4 MB flash, no PSRAM)
that publish environmental readings to the CEIoT backend over MQTT with mTLS.

## Requirements

- ESP-IDF **6.1** (`source ~/.espressif/tools/activate_idf_v6.1.sh`).
- Component registry access on the first build (cJSON, MQTT, mDNS and
  LittleFS are downloaded into `managed_components/`, pinned by
  `dependencies.lock`).

## Build

```sh
source ~/.espressif/tools/activate_idf_v6.1.sh
cd esp32
idf.py set-target esp32   # only once per clone
idf.py build
idf.py -p /dev/ttyUSB0 flash monitor
```

## Device certificates (mTLS)

The broker requires a client certificate per device. The files are **never
committed** (`esp32/cert/` is gitignored):

| File | Content |
| --- | --- |
| `esp32/cert/root.crt` | CA that signed the broker certificate |
| `esp32/cert/client.crt` | device certificate (CN = device serial) |
| `esp32/cert/client.key` | device private key |

See `mqtt/README.md` for how to issue them with the project PKI scripts.

- With the three files present, the build generates `build/storage.bin`
  (LittleFS) and `idf.py flash` writes it to the `storage` partition.
  Only those three files are copied into the image.
- Without them (fresh clone) the build still succeeds and prints a CMake
  warning; the certificates can then be uploaded from the web UI.
- On the first boot with certificates, a copy is kept in the NVS `factory`
  namespace, so a factory reset restores them.

## Partition table (4 MB)

| Name | Type | Offset | Size |
| --- | --- | --- | --- |
| nvs | data/nvs | 0x9000 | 24 KB |
| otadata | data/ota | 0xF000 | 8 KB |
| phy_init | data/phy | 0x11000 | 4 KB |
| storage | data/littlefs | 0x12000 | 56 KB |
| ota_0 | app | 0x20000 | 1920 KB (0x1E0000) |
| ota_1 | app | 0x200000 | 1920 KB (0x1E0000) |
| coredump | data/coredump | 0x3E0000 | 128 KB |

There is no factory app: the first flash writes `ota_0`, OTA updates
alternate between the two slots, and `CONFIG_BOOTLOADER_APP_ROLLBACK_ENABLE`
rolls back an image that does not validate itself. An OTA image must not
exceed **1966080 bytes** (0x1E0000).

## Sensor variant

Each image supports exactly one sensor, chosen in `main/config/config.h`:

```c
#define SENSOR_MODEL SENSOR_DHT22   // SENSOR_DHT11, SENSOR_DHT22, SENSOR_BMP280, SENSOR_BME280
```

| Variant | Wiring (defaults, editable in `config.h`) | Telemetry key | Variables |
| --- | --- | --- | --- |
| DHT11 | data GPIO4 | `dht11` | `temperature`, `relative_humidity` |
| DHT22 / AM2302 | data GPIO4 | `dht22` | `temperature`, `relative_humidity` |
| BMP280 | I2C SDA GPIO21, SCL GPIO22, address 0x76 | `bmp280` | `temperature`, `pressure` |
| BME280 | I2C SDA GPIO21, SCL GPIO22, address 0x76 | `bme280` | `temperature`, `relative_humidity`, `pressure` |

Units: °C, % and hPa. The keys and variables match the backend sensor
catalog (`backend/app/api/sensor_catalog/constants.py`). Drivers come from
esp-idf-lib (`esp-idf-lib/dht`, `esp-idf-lib/bmp280`, which also drives the
BME280). A failed or implausible value (NaN, out of the sensor range, the
all-zero DHT frame) is never published: that variable is left out, and when
nothing valid remains the cycle is skipped.

## MQTT contract

Client id = device serial (`IOT-XXXX-XXXX`, set from the web UI). Topics
follow `tools/emulador-dispositivo.py`:

| Topic | QoS / retain | Payload |
| --- | --- | --- |
| `iot/devices/{serial}/telemetry` | 1 | `{"sensors":{"dht22":{"temperature":23.4,"relative_humidity":51.2}},"uptime":125,"firmware_version":"0.1.0"}` |
| `iot/devices/{serial}/status` | 1, retained | `{"serial":"…","status":"online"}` on every connect; Last Will `"offline"` |

Telemetry is published every `TELEMETRY_INTERVAL_SEC` (60 s by default) and
right after each connection. `firmware_version` is `PROJECT_VER` from
`esp32/CMakeLists.txt`.

## Host tests

The pure logic (sensor rules, payloads, …) is tested on the PC, no board
needed. cJSON is taken from `managed_components/` (run `idf.py build` once):

```sh
cmake -S esp32/tests -B /tmp/ceiot-fw-tests
cmake --build /tmp/ceiot-fw-tests
(cd /tmp/ceiot-fw-tests && ctest --output-on-failure)
```
