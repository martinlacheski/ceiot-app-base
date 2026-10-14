# ===== APROVISIONAMIENTO EN VIVO (desde la raíz del repo) =====
cd ~/Code/ceiot-app-base

# 0. Activar ESP-IDF (una vez por terminal)
source ~/.espressif/tools/activate_idf_v6.1.sh

# 1. Token de la API (solo si venció: provision.py avisa con un error 401)
CEIOT_PROVISIONING_USERNAME=admin python3 provisioning/login.py

# 2. Conectar la placa por USB y ver el puerto
ls /dev/ttyUSB*

# ===== EJEMPLO 1: IOT-DEM0-0005 =====
python3 provisioning/provision.py prepare \
  --serial IOT-DEM0-0005 --sensor <SENSOR> --firmware-sensor auto \
  --name "Demo en vivo 1" \
  --flash /dev/ttyUSB0

cd esp32 && idf.py -p /dev/ttyUSB0 monitor; cd ..     # salir con Ctrl+]

# ===== EJEMPLO 2: IOT-DEM0-0006 (cambiar la placa) =====
python3 provisioning/provision.py prepare \
  --serial IOT-DEM0-0006 --sensor <SENSOR> --firmware-sensor auto \
  --name "Demo en vivo 2" \
  --flash /dev/ttyUSB0

cd esp32 && idf.py -p /dev/ttyUSB0 monitor; cd ..

# ===== WI-FI DE CADA PLACA (celular o PC) =====
# Red: WiFi_CEIoT_APP   Contraseña: ceiotapp
# http://192.168.4.1    usuario: admin   contraseña: admin
# Pestaña Wi-Fi -> "WiFi VM Personal" -> Conectar -> "Desactivar punto de acceso"
# LED fijo = MQTT conectado

# ===== VINCULAR (usuario nuevo, en http://localhost:5173) =====
# 1. Registrarse y verificar el email (el correo llega a http://localhost:8025)
# 2. Crear su establecimiento
# 3. Dispositivos -> Asociar dispositivo -> serial IOT-DEM0-0005 -> elegir establecimiento
# QR del serial en la terminal (opcional):
qrencode -t ANSIUTF8 IOT-DEM0-0005