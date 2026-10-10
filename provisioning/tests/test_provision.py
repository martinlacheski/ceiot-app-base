"""Unit tests for the pure parts of provision.py and login.py.

Run: python3 -m unittest discover -s provisioning/tests
"""

import argparse
import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import login  # noqa: E402
import provision  # noqa: E402

DHT22_ID, BME280_ID, BMP280_ID = "s-dht22", "s-bme280", "s-bmp280"
CODES = {DHT22_ID: "dht22", BME280_ID: "bme280", BMP280_ID: "bmp280"}


def row(row_id, sensor_id, key, active=True):
    return {"id": row_id, "sensorId": sensor_id, "key": key, "isActive": active}


class ProfileTests(unittest.TestCase):
    def load(self, data):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "profile.json"
            path.write_text(json.dumps(data), encoding="utf-8")
            return provision.load_profile(path)

    def test_local_profile_reads_the_stack_variables(self):
        values = {"LAN_BIND_IP": "192.168.1.100", "MQTT_LISTENER_TLS": "18883"}
        self.assertEqual(provision.load_profile(provision.DEFAULT_PROFILE, values.get),
                         {"mqtt_uri": "192.168.1.100", "mqtt_port": "18883", "mqtt_use_tls": "1"})

    def test_missing_variable_is_an_error(self):
        with self.assertRaises(provision.ProvisioningError):
            provision.load_profile(provision.DEFAULT_PROFILE, {}.get)

    def test_expand_vars_default(self):
        lookup = {"A": "x"}.get
        self.assertEqual(provision.expand_vars("${A}:${B:-8883}", lookup), "x:8883")
        self.assertEqual(provision.expand_vars(provision.DEFAULT_API_BASE_URL, {"BACKEND_PORT": "19000"}.get),
                         "http://localhost:19000")
        self.assertEqual(provision.expand_vars(provision.DEFAULT_API_BASE_URL, {}.get), "http://localhost:18000")

    def test_native_types_are_normalized_to_strings(self):
        self.assertEqual(self.load({"mqtt_uri": " h ", "mqtt_port": 1883, "mqtt_use_tls": False}),
                         {"mqtt_uri": "h", "mqtt_port": "1883", "mqtt_use_tls": "0"})

    def test_invalid_profiles(self):
        for data in (
            {"mqtt_port": "1", "mqtt_use_tls": "1"},
            {"mqtt_uri": "", "mqtt_port": "1", "mqtt_use_tls": "1"},
            {"mqtt_uri": "h", "mqtt_port": "0", "mqtt_use_tls": "1"},
            {"mqtt_uri": "h", "mqtt_port": True, "mqtt_use_tls": "1"},
            {"mqtt_uri": "h", "mqtt_port": "65536", "mqtt_use_tls": "1"},
            {"mqtt_uri": "h", "mqtt_port": "1", "mqtt_use_tls": "maybe"},
            {"mqtt_uri": "h" * 128, "mqtt_port": "1", "mqtt_use_tls": "1"},
            ["not", "an", "object"],
        ):
            with self.subTest(data=data), self.assertRaises(provision.ProvisioningError):
                self.load(data)


class SerialTests(unittest.TestCase):
    def test_normalize(self):
        self.assertEqual(provision.normalize_serial(" iot-dem0-0004 "), "IOT-DEM0-0004")

    def test_reject(self):
        for value in ("IOT-DEM0-004", "XYZ-DEM0-0004", "IOT-DEM0_0004", ""):
            with self.subTest(value=value), self.assertRaises(argparse.ArgumentTypeError):
                provision.normalize_serial(value)


class SensorPlanTests(unittest.TestCase):
    def plan(self, installed, sensor):
        return [(action, r["id"] if r else None)
                for action, r in provision.plan_sensor_changes(installed, CODES, sensor)]

    def test_already_correct(self):
        self.assertEqual(self.plan([row("a", DHT22_ID, "dht22")], "dht22"), [])

    def test_swap_model_deactivates_first(self):
        self.assertEqual(self.plan([row("a", BME280_ID, "bme280")], "dht22"),
                         [("deactivate", "a"), ("install", None)])

    def test_two_sensors_to_one(self):
        installed = [row("a", BMP280_ID, "bmp280"), row("b", DHT22_ID, "dht22")]
        self.assertEqual(self.plan(installed, "bme280"),
                         [("deactivate", "a"), ("deactivate", "b"), ("install", None)])

    def test_inactive_rows_are_left_alone_and_target_reactivated(self):
        installed = [row("a", BME280_ID, "bme280", active=False), row("b", DHT22_ID, "dht22", active=False)]
        self.assertEqual(self.plan(installed, "dht22"), [("reactivate", "b")])

    def test_key_taken_by_another_model(self):
        with self.assertRaises(provision.ProvisioningError):
            provision.plan_sensor_changes([row("a", BMP280_ID, "dht22", active=False)], CODES, "dht22")

    def test_empty_device(self):
        self.assertEqual(self.plan([], "bmp280"), [("install", None)])


class CommandTests(unittest.TestCase):
    def test_build_commands_use_a_build_dir_per_variant(self):
        commands = provision.build_commands("bmp280", "/dev/ttyUSB1")
        self.assertIn("idf.py -B build-bmp280 -DCEIOT_SENSOR=bmp280 reconfigure build", commands)
        self.assertIn("idf.py -B build-bmp280 -p /dev/ttyUSB1 erase-flash flash", commands)


class StageTests(unittest.TestCase):
    def test_stage_and_copy_write_the_five_files(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            certs = tmp / "pki"
            certs.mkdir()
            for name in ("client.crt", "client.key"):
                (certs / name).write_text(name, encoding="utf-8")
            ca = tmp / "ca.crt"
            ca.write_text("ca", encoding="utf-8")
            profile = {"mqtt_uri": "h", "mqtt_port": "18883", "mqtt_use_tls": "1"}
            staged = provision.stage(tmp / "build", "IOT-DEM0-0009", certs, ca, profile)
            provision.copy_to_firmware(staged, tmp / "fw")
            self.assertEqual(sorted(p.name for p in (tmp / "fw").iterdir()), sorted(provision.STAGED_FILES))
            self.assertEqual((tmp / "fw" / "serial.txt").read_text(), "IOT-DEM0-0009\n")
            self.assertEqual((tmp / "fw" / "root.crt").read_text(), "ca")
            self.assertEqual(json.loads((tmp / "fw" / "provisioning.json").read_text()), profile)
            self.assertEqual((staged / "client.key").stat().st_mode & 0o777, 0o600)


class EnvFileTests(unittest.TestCase):
    def test_parse_env_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / ".env.local"
            path.write_text('# c\nexport CEIOT_API_TOKEN="abc"\nCEIOT_API_BASE_URL=http://x\n', encoding="utf-8")
            self.assertEqual(provision.parse_env_file(path),
                             {"CEIOT_API_TOKEN": "abc", "CEIOT_API_BASE_URL": "http://x"})
            self.assertEqual(provision.parse_env_file(Path(tmp) / "missing"), {})

    def test_login_updates_in_place_and_appends(self):
        lines = ["# keep", 'export CEIOT_API_TOKEN="old"', "OTHER=1"]
        self.assertEqual(login.update_env_lines(lines, {"CEIOT_API_TOKEN": "new", "CEIOT_API_BASE_URL": "u"}),
                         ["# keep", 'CEIOT_API_TOKEN="new"', "OTHER=1", 'CEIOT_API_BASE_URL="u"'])
        self.assertEqual(login.env_value(lines, "CEIOT_API_TOKEN"), "old")


if __name__ == "__main__":
    unittest.main()
