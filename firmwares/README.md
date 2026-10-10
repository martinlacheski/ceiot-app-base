# Versionado y publicación de firmware (OTA)

Procedimiento para publicar una versión nueva del firmware de los dispositivos
(`esp32/`, proyecto `iot_device`) y actualizar los equipos por OTA desde la
aplicación web. Todos los comandos se ejecutan desde la raíz del repositorio.

Hay **una sola imagen** para los cuatro sensores (DHT11, DHT22, BMP280 y
BME280): cada equipo usa el sensor configurado o detectado, guardado en su
memoria, que se conserva al actualizar.

## 1. Subir la versión antes de compilar

Cada imagen publicada necesita una versión **nueva y única**. Se define en
`esp32/CMakeLists.txt`:

```cmake
set(PROJECT_VER "0.2.0")
```

El equipo compara esa cadena exacta: si la versión pedida es la que ya corre,
rechaza la actualización (`same_version`). Commitee el cambio de versión junto
con el código de esa versión.

## 2. Compilar

```bash
source ~/.espressif/tools/activate_idf_v6.1.sh
cd esp32
idf.py build
cd ..
```

Resultado: `esp32/build/iot_device.bin` (se reemplaza en cada compilación).

## 3. Archivar

```bash
tools/archive_firmware.sh
# otra imagen: tools/archive_firmware.sh ruta/al/archivo.bin
```

Lee el proyecto y la versión **del propio `.bin`** y guarda:

```
firmwares/iot_device/<versión>.bin
firmwares/iot_device/<versión>.bin.sha256
firmwares/iot_device/<versión>.elf        (no se versiona en git)
```

- Si esa versión ya está archivada con otro contenido, el script se detiene:
  suba `PROJECT_VER` (paso 1).
- Si el archivo es idéntico, no hace nada.
- El `.elf` permite leer los core dumps de esa versión; consérvelo.

Versione en git solo las imágenes que se van a probar o publicar:

```bash
git add firmwares/iot_device/<versión>.bin firmwares/iot_device/<versión>.bin.sha256
git commit -m "chore(firmware): archive <versión>"
```

## 4. Probar en banco

Grabe por cable una placa de prueba (`idf.py -p /dev/ttyUSB0 app-flash monitor`
conserva el Wi-Fi; `erase-flash flash` la deja de fábrica) o actualícela por OTA
(paso 6) antes de publicarla para el resto de los equipos.

## 5. Publicar en la plataforma

1. Aplicación → **Firmware** → **Nuevo firmware** (solo administradores).
2. Elija `firmwares/iot_device/<versión>.bin`. La versión y el proyecto se leen
   del archivo y las notas se precargan con el resumen de la compilación.
3. Complete las notas con qué cambia en esta versión.
4. **Subir firmware**. La versión queda **activa** y, con la casilla marcada,
   se desactivan las anteriores.

Para retirar una versión con problemas, desactívela en el listado: deja de
ofrecerse pero no se borra.

## 6. Actualizar los equipos

1. Aplicación → **Dispositivos** → detalle del equipo → **Actualizar firmware**.
2. Elija la versión y confirme. El equipo tiene que estar **en línea**.
3. El avance se ve en el mismo detalle: aceptado → descargando (NN %) →
   verificando → instalando → reiniciando → **completado**.

La imagen se descarga desde el backend con una URL de un solo uso que vence a
los 10 minutos (`FIRMWARE_DOWNLOAD_BASE_URL` en `backend/.env`, por ejemplo
`http://192.168.1.100:18000`). El equipo verifica el tamaño y el SHA-256
recibidos por MQTT con mTLS antes de instalar.

Qué pasa si algo falla:

| Situación | Resultado |
| --- | --- |
| Corte de conexión o de luz durante la descarga | El equipo sigue en la versión anterior; el intento queda **fallido** (`interrupted`). |
| Imagen corrupta o distinta de la publicada | **Fallido** (`sha256_mismatch` / `size_mismatch`); no se instala. |
| La versión nueva no logra conectarse al broker en 3 minutos | Vuelve sola a la versión anterior; el intento queda en **vuelta atrás** (`rolled_back`). |
| Se pide la versión que ya corre | **Rechazado** (`same_version`). |
