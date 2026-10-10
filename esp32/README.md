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

To provision a device (backend record, certificate, serial and broker profile
in LittleFS, build and flash commands) use `provisioning/provision.py`; the
step-by-step guide is `provisioning/README.md`.

The application image is `build/iot_device.bin`: the project name must stay
`iot_device`, the only firmware the backend and the web app accept for OTA
(`FIRMWARE_PROJECT` in `backend/app/api/device/firmware/rules.py`). Bump
`PROJECT_VER` in `esp32/CMakeLists.txt` for every image published for OTA.

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
  `serial.txt` and `provisioning.json` (written there by
  `provisioning/provision.py`) are packed too when present; the configure
  step logs `LittleFS image files: ...`. The list is fixed when CMake runs:
  `idf.py reconfigure` after staging another device.
- At boot, `serial.txt` and `provisioning.json` (`mqtt_uri`, `mqtt_port`,
  `mqtt_use_tls`) fill the NVS `factory` namespace when it does not have those
  values yet (DVEM approach, `main/web/nvs_manager.c`), and from there the
  active `storage` settings: a freshly flashed board connects with no web
  visit. Reprovisioning a used board needs `idf.py erase-flash`.
- Identity check: the client certificate CN must equal the serial (the broker
  maps the CN to the MQTT username). On a mismatch, or an unreadable CN, the
  firmware logs an error, does not start MQTT over TLS, starts the
  configuration AP and the status page shows it (`Identidad`).
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
exceed **1966080 bytes** (0x1E0000): the backend rejects larger uploads
(`MAX_IMAGE_BYTES`) and the device answers `image_too_large`.

## Sensor variant

Each image supports exactly one sensor. The default is set in
`main/config/config.h`:

```c
#define SENSOR_MODEL SENSOR_DHT22   // SENSOR_DHT11, SENSOR_DHT22, SENSOR_BMP280, SENSOR_BME280
```

A build can override it without editing files (`main/CMakeLists.txt` maps
`CEIOT_SENSOR` to `-DSENSOR_MODEL=SENSOR_<VARIANT>`):

```sh
idf.py -B build-dht11 -DCEIOT_SENSOR=dht11 build    # dht11 | dht22 | bmp280 | bme280
```

`CEIOT_SENSOR` is a CMake cache variable, so it sticks to its build
directory: use one directory per variant (`build-<variant>` is gitignored) so
variants never mix, or pass `-DCEIOT_SENSOR=` to return to the `config.h`
default in the same directory.

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
| `iot/devices/{serial}/ota/command` | 1, subscribed | `{"request_id","version","url","sha256","size","force"?}` (see "OTA updates") |
| `iot/devices/{serial}/ota/status` | 1 | `{"request_id","state","progress"?,"error"?:{"code","message"},"running_version","target_version"}` |

Telemetry is published every `TELEMETRY_INTERVAL_SEC` (60 s by default) and
right after each connection. `firmware_version` is `PROJECT_VER` from
`esp32/CMakeLists.txt`.

Broker settings (`main/mqtt/mqtt_config_logic.c`, host-tested): what the MQTT
page saved in NVS `storage`, else the defaults: **mTLS on port 18883 to
`192.168.1.100`**. A freshly flashed board (no `storage` namespace yet) uses
those defaults, so with its certificates in `esp32/cert/` and a serial it
connects without visiting the web UI. The serial comes from `storage`, else
from the `factory` snapshot. Without a serial there is no client id nor topic
identity: the log says so (`No device serial in NVS`), MQTT does not start and
the configuration AP starts so the serial can be set. Saving the serial or the
broker settings from the web UI rebuilds and restarts the MQTT client
(`mqtt_manager_request_reload()`): no restart needed.

The default port matches the development stack, which publishes the broker
TLS listener on `MQTT_LISTENER_TLS` (`18883`) on `LAN_BIND_IP`. For a broker on
the standard port, change it on the MQTT page or in `mqtt_config_logic.h`.

## Time synchronization

Implemented in `main/timesync/` (rules in `time_sync_logic.c`, host-tested),
following `backend/docs/mqtt-time-sync.md`:

1. **NTP**: SNTP (`time.google.com`, `pool.ntp.org`, plus the DHCP-provided
   server) runs from boot; it gets the first 15 s after the station gets an
   IP.
2. **HTTP**: if the clock is still unset, `GET {backend}/api/public/time`
   over plain HTTP (5 s timeout), retried every 60 s while unsynchronized.
   `{backend}` is the "URL del backend" of the MQTT page (NVS `storage` /
   `backend_url`); empty means `http://<MQTT broker host>:18000`, the port
   docker compose publishes for the backend (`LAN_BIND_IP` must expose it to
   the LAN, as for the firmware downloads).
3. **MQTT**: the client starts once the clock is valid, **or** once NTP timed
   out and HTTP was tried, so it is never blocked forever. While the clock is
   still unset it publishes `{"req_id":"t-N"}` to
   `iot/devices/{serial}/time/request` (QoS 1, retried every 30 s) and sets
   the clock from the matching reply on `iot/devices/{serial}/time`
   (`epoch_ms` + half the round trip).

Why MQTT can connect without a valid clock: `CONFIG_MBEDTLS_HAVE_TIME_DATE`
stays disabled (ESP-IDF default), so the mTLS handshake verifies the broker
certificate chain and signatures but not the validity dates. Enabling it would
make step 3 impossible without NTP or HTTP, and an expired certificate would
then also stop the device. Telemetry carries no timestamp (the backend stamps
reception time), so a device without time still reports. The status page
shows the time source (`ntp`, `http`, `mqtt`, or `rtc` when a valid clock
survived a software restart).

## OTA updates

Implemented in `main/ota/` (rules in `ota_logic.c`, host-tested; glue in
`ota_manager.c`), ported from DVEM-App `devices/esp-idf-guition-1r1p` without
its screens, sales and PSRAM. Contract: `tools/emulador-dispositivo.py --ota`
and `backend/app/api/device/firmware/`.

1. `ota/command` is subscribed on every MQTT (re)connection. The device
   answers on `ota/status` (QoS 1) echoing the `request_id`:
   `rejected` with `busy` (another update running, or the new image still
   validating), `invalid_command` (url not `http://`/`https://`, sha256 not 64
   lowercase hex, size not a positive integer, version not 1..32 chars,
   `force` not boolean), `image_too_large` (`size` larger than the OTA slot,
   0x1E0000) or `same_version` (unless `force`); otherwise `accepted`. A
   redelivered `request_id` replays its last status and never runs twice.
2. `downloading` with `progress` every 10 % (or every 5 s with some
   advance): `esp_http_client` streams the image into the other OTA slot
   while computing its SHA-256. Plain http is accepted on the LAN (the
   command arrives over mTLS and carries the SHA-256); https verifies the
   server with the ESP-IDF certificate bundle (common CAs). Redirects are
   refused: the url must be the final one.
3. `verifying`: size and SHA-256 must match the command
   (`size_mismatch` / `sha256_mismatch`), and `esp_ota_end` checks the image;
   the boot partition is never switched before that.
4. `installing`: the marker `{request_id, target_version, previous_version,
   target_slot}` is stored in NVS (`ota`/`marker`), the boot partition is
   switched, `rebooting`, restart.
5. The new image boots in `PENDING_VERIFY` (rollback enabled). It is marked
   valid once Wi-Fi and MQTT are up, within 180 s; otherwise it rolls back.
   Once connected it publishes `succeeded` for the stored `request_id` (or
   `rolled_back` / `rollback` when the bootloader went back to the previous
   image) and only then clears the marker.

Other failures end in `failed` with `download_failed`, `tls_error`,
`flash_error`, `no_ota_partition`, `no_memory` or `internal`; the image in use
does not change.

### Heap budget (no PSRAM; DVEM change 50 adapted)

DVEM moved mbedTLS to PSRAM and disabled hardware AES because its S3 ran out
of internal RAM. Neither applies here: there is no PSRAM, and the classic
ESP32 AES accelerator does not use the DMA bounce buffer that failed on the
S3. Instead everything stays in internal RAM and the budget is checked:

- Static DRAM use (DHT22 build): 45.6 KB of 180.7 KB (`idf.py size`), which
  leaves ~135 KB for the heap before Wi-Fi, lwIP, task stacks and the MQTT
  client. Expected free heap with Wi-Fi, the web server and the MQTT mTLS
  session up: roughly 90-120 KB (to be confirmed on the board).
- MQTT mTLS with `CONFIG_MBEDTLS_DYNAMIC_BUFFER` and freed config data: about
  35 KB at the handshake peak, far less once connected.
- http download: 6 KB task stack + 4 KB chunk + ~3.5 KB HTTP buffers + the
  lwIP receive window, ~20 KB. Required before starting: 32 KB free and a
  12 KB block.
- https download: a second TLS session (handshake peak ~35-40 KB, input
  record up to 16 KB) and a 10 KB stack, ~60 KB. Required: 64 KB free and a
  24 KB block.

Below those thresholds the update ends `failed` / `no_memory` before touching
the flash. The serial log prints the free heap, largest block and minimum ever
before the download, halfway, after it and when the task ends, plus the task
stack high-water mark; the main loop prints the free heap every 5 minutes.

## Configuration AP, BOOT button and status LED

| BOOT button (GPIO0) | Effect |
| --- | --- |
| short press (< 3 s) | nothing |
| hold ≥ 3 s, then release | starts the configuration AP |
| hold ≥ 10 s | factory reset (fires while still held), then reboot |

- AP: SSID `WiFi_CEIoT_APP`, password `ceiotapp` (WPA2), web UI at
  <http://192.168.4.1>. It runs as AP+STA, so the device keeps its Wi-Fi
  connection (and telemetry) while the AP is up. It also starts by itself
  when no Wi-Fi network is saved. It stays up until restart or until
  "Desactivar punto de acceso" on the status page.
- Web login: `admin` / `admin` by default (change it under "Seguridad").
  Pages: status (serial, firmware, sensor and last reading, Wi-Fi, AP, MQTT,
  certificates, time), Wi-Fi scan/connect/forget, MQTT broker + certificate
  upload, device serial, password, restart and factory reset.
- Factory reset (button or web) erases the Wi-Fi network, the MQTT broker
  settings and the web password, and restores the serial, the certificates
  and the TLS flag from the NVS `factory` snapshot.
- Status LED (GPIO2): fast blink = AP active; solid = MQTT connected; slow
  blink = Wi-Fi connected, MQTT not yet; short flash every 2 s = offline.
  While BOOT is held: solid from 3 s (release to start the AP), very fast
  blink once the factory reset fires.

## Host tests

The pure logic (sensor rules, payloads, BOOT button, time fallback, MQTT
settings, OTA rules) is tested on the PC, no board needed. cJSON is taken from `managed_components/` (run `idf.py build` once):

```sh
cmake -S esp32/tests -B /tmp/ceiot-fw-tests
cmake --build /tmp/ceiot-fw-tests
(cd /tmp/ceiot-fw-tests && ctest --output-on-failure)
```
