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
