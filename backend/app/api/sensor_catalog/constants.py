"""Stable identifiers and seed specifications for environmental catalogs."""

import uuid


VARIABLE_IDS = {
    "temperature": uuid.UUID("e4f70337-4b32-47ba-b6c2-e71c517f0001"),
    "relative_humidity": uuid.UUID("e4f70337-4b32-47ba-b6c2-e71c517f0002"),
    "pressure": uuid.UUID("e4f70337-4b32-47ba-b6c2-e71c517f0003"),
}
SENSOR_IDS = {
    "dht11": uuid.UUID("e4f70337-4b32-47ba-b6c2-e71c517f0011"),
    "dht22": uuid.UUID("e4f70337-4b32-47ba-b6c2-e71c517f0012"),
    "bmp280": uuid.UUID("e4f70337-4b32-47ba-b6c2-e71c517f0013"),
    "bme280": uuid.UUID("e4f70337-4b32-47ba-b6c2-e71c517f0014"),
}
VARIABLE_SEEDS = (
    ("temperature", "Temperatura", "°C", "Ambient temperature"),
    ("relative_humidity", "Humedad relativa", "%", "Relative humidity"),
    ("pressure", "Presión atmosférica", "hPa", "Atmospheric pressure"),
)
SENSOR_SEEDS = (
    ("dht11", "DHT11", "Aosong", "Digital temperature and humidity sensor"),
    ("dht22", "DHT22", "Aosong", "Digital temperature and humidity sensor"),
    ("bmp280", "BMP280", "Bosch", "Temperature and pressure sensor"),
    ("bme280", "BME280", "Bosch", "Temperature, humidity and pressure sensor"),
)
# sensor code, variable code, min, max, accuracy, resolution.
SENSOR_VARIABLE_SPECS = (
    ("dht11", "temperature", 0, 50, "±2 °C", "1 °C"),
    ("dht11", "relative_humidity", 20, 90, "±5 %", "1 %"),
    ("dht22", "temperature", -40, 80, "±0.5 °C", "0.1 °C"),
    ("dht22", "relative_humidity", 0, 100, "±2 %", "0.1 %"),
    ("bmp280", "temperature", -40, 85, "±1 °C", "0.01 °C"),
    ("bmp280", "pressure", 300, 1100, "±1 hPa", "0.01 hPa"),
    ("bme280", "temperature", -40, 85, "±1 °C", "0.01 °C"),
    ("bme280", "relative_humidity", 0, 100, "±3 %", "0.008 %"),
    ("bme280", "pressure", 300, 1100, "±1 hPa", "0.01 hPa"),
)
