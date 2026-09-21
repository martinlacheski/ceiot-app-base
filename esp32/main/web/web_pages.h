#ifndef WEB_PAGES_H
#define WEB_PAGES_H

static const char *HTML_HEAD =
    "<!doctype html>\n"
    "<html lang=\"es\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">\n"
    "<title>IOT Config</title>\n"
    "<style>\n"
    ":root{font-family:system-ui,sans-serif;color:#172033;background:#f5f7fb}body{margin:0}.container,.login{max-width:860px;margin:32px auto;padding:0 16px}.card{background:white;border:1px solid #dbe1ea;border-radius:12px;padding:24px;margin-bottom:18px}.nav{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:18px}.nav a,button{background:#1956d1;color:white;border:0;border-radius:8px;padding:10px 14px;text-decoration:none;cursor:pointer}.nav a{background:#e8eefc;color:#173b82}label{display:block;font-weight:600;margin:12px 0 5px}input,select{box-sizing:border-box;width:100%;padding:10px;border:1px solid #c5cedb;border-radius:8px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px}.muted{color:#687386}.danger{background:#b42318}.ok{color:#067647}.bad{color:#b42318}pre{white-space:pre-wrap;word-break:break-word;background:#f7f8fa;padding:12px;border-radius:8px}\n"
    "</style></head><body>\n"
;

static const char *HTML_NAV =
    "<div class=\"container\"><div class=\"nav\">\n"
    "<a href=\"/status\">Estado</a><a href=\"/wifi\">Conectividad</a><a href=\"/mqtt\">MQTT</a><a href=\"/device\">Dispositivo</a><a href=\"/password\">Seguridad</a>\n"
    "<button onclick=\"logout()\">Cerrar sesi\u00f3n</button></div>\n"
;

static const char *HTML_LOGIN =
    "<div class=\"login\"><div class=\"card\"><h1>IOT</h1><p class=\"muted\">Administraci\u00f3n del dispositivo</p>\n"
    "<form id=\"login-form\"><label>Usuario</label><input id=\"user\" value=\"admin\" required>\n"
    "<label>Contrase\u00f1a</label><input id=\"pass\" type=\"password\" required><button>Ingresar</button></form></div></div>\n"
;

static const char *VIEW_STATUS =
    "<div class=\"card\"><h1>Estado del dispositivo</h1><div class=\"grid\">\n"
    "<div><h3>Sistema</h3><p>ID: <strong id=\"st-device\">-</strong></p><p>Serial: <strong id=\"st-serial\">-</strong></p><p>Uptime: <strong id=\"st-uptime\">-</strong></p><p>Heap: <strong id=\"st-heap\">-</strong></p></div>\n"
    "<div><h3>Conectividad</h3><p>Wi-Fi: <strong id=\"st-wifi\">-</strong></p><p>IP: <strong id=\"st-ip\">-</strong></p><p>MQTT: <strong id=\"st-mqtt\">-</strong></p><p>Enlace: <strong id=\"st-link\">-</strong></p></div>\n"
    "</div><h3>Diagn\u00f3stico</h3><pre id=\"diagnostics\">Cargando...</pre></div>\n"
;

static const char *VIEW_WIFI =
    "<div class=\"card\"><h1>Conectividad</h1>\n"
    "<label>Modo de red</label><select id=\"network-mode\"><option value=\"wifi_first\">Wi-Fi preferido</option><option value=\"cellular_first\">4G preferido</option><option value=\"wifi_only\">Solo Wi-Fi</option><option value=\"cellular_only\">Solo 4G</option></select>\n"
    "<button onclick=\"saveNetwork()\">Guardar modo</button><hr>\n"
    "<label>SSID</label><input id=\"wifi-ssid\"><label>Contrase\u00f1a</label><input id=\"wifi-pass\" type=\"password\">\n"
    "<button onclick=\"saveWifi()\">Guardar Wi-Fi</button><button onclick=\"scanWifi()\">Escanear</button><button class=\"danger\" onclick=\"forgetWifi()\">Olvidar red</button>\n"
    "<pre id=\"wifi-results\"></pre></div>\n"
;

static const char *VIEW_MQTT =
    "<div class=\"card\"><h1>Broker MQTT</h1><form id=\"mqtt-form\">\n"
    "<div class=\"grid\"><div><label>Host</label><input id=\"mqtt-uri\" required></div><div><label>Puerto</label><input id=\"mqtt-port\" type=\"number\" required></div></div>\n"
    "<label><input id=\"mqtt-tls\" type=\"checkbox\" style=\"width:auto\"> Usar TLS</label>\n"
    "<p class=\"muted\">Telemetr\u00eda: <code>iot/devices/&lt;serial&gt;/telemetry</code><br>OTA: <code>iot/devices/&lt;serial&gt;/ota</code><br>Estado: <code>iot/devices/&lt;serial&gt;/status</code></p>\n"
    "<button>Guardar MQTT</button><button type=\"button\" onclick=\"testMqtt()\">Probar publicaci\u00f3n</button></form></div>\n"
;

static const char *VIEW_DEVICE =
    "<div class=\"card\"><h1>Dispositivo IOT</h1><p>Formato de serial: <strong>IOT-XXXX-XXXX</strong></p>\n"
    "<form id=\"serial-form\"><label>N\u00famero de serie</label><input id=\"serial\" placeholder=\"IOT-XXXX-XXXX\" pattern=\"IOT-[A-Za-z0-9]{4}-[A-Za-z0-9]{4}\" required><button id=\"save-serial\">Guardar serial</button></form>\n"
    "<p class=\"muted\">Las lecturas reales se publican sin reinterpretarlas; la temperatura existente conserva la clave <code>temp_water</code>.</p></div>\n"
;

static const char *VIEW_PASSWORD =
    "<div class=\"card\"><h1>Seguridad</h1>\n"
    "<form id=\"password-form\"><label>Contrase\u00f1a actual</label><input id=\"current-pass\" type=\"password\" required><label>Nueva contrase\u00f1a</label><input id=\"new-pass\" type=\"password\" minlength=\"6\" required><button>Cambiar contrase\u00f1a</button></form>\n"
    "<hr><button onclick=\"restartDevice()\">Reiniciar</button><button class=\"danger\" onclick=\"resetDevice()\">Restaurar f\u00e1brica</button></div>\n"
;

static const char *HTML_FOOTER_START =
    "</div><script>\n"
    "const API=\"/api\"; const el=id=>document.getElementById(id);\n"
    "async function request(path,options={}){const r=await fetch(API+path,{headers:{\"Content-Type\":\"application/json\"},...options});if(r.status===401){location.href=\"/login\";throw new Error(\"unauthorized\")}return r}\n"
    "function toast(message){alert(message)}\n"
    "async function loadStatus(){if(!el(\"st-device\")&&!el(\"mqtt-uri\")&&!el(\"serial\")&&!el(\"network-mode\"))return;const r=await request(\"/status\");const d=await r.json();\n"
    "if(el(\"st-device\")){el(\"st-device\").textContent=d.device||\"IOT-ESP32S3\";el(\"st-serial\").textContent=d.serial||\"Sin asignar\";el(\"st-uptime\").textContent=Math.round(d.uptime||0)+\" s\";el(\"st-heap\").textContent=Math.round((d.heap_free||0)/1024)+\" KB\";el(\"st-wifi\").textContent=d.wifi&&d.wifi.connected?\"Conectado\":\"Desconectado\";el(\"st-ip\").textContent=d.wifi&&d.wifi.ip||\"-\";el(\"st-mqtt\").textContent=d.mqtt&&d.mqtt.connected?\"Conectado\":\"Desconectado\";el(\"st-link\").textContent=d.network_active||\"-\";el(\"diagnostics\").textContent=JSON.stringify(d.diagnostics||{},null,2)}\n"
    "if(el(\"network-mode\"))el(\"network-mode\").value=d.network_mode||\"wifi_first\";\n"
    "if(el(\"mqtt-uri\")){el(\"mqtt-uri\").value=d.mqtt_uri||\"\";el(\"mqtt-port\").value=d.mqtt_port||\"1883\";el(\"mqtt-tls\").checked=!!d.mqtt_use_tls}\n"
    "if(el(\"serial\")){el(\"serial\").value=d.serial||\"\";if(d.serial){el(\"serial\").disabled=true;el(\"save-serial\").disabled=true}}\n"
    "}\n"
    "async function logout(){document.cookie=\"iot_session=; Max-Age=0; path=/\";location.href=\"/login\"}\n"
    "if(el(\"login-form\"))el(\"login-form\").onsubmit=async e=>{e.preventDefault();const r=await fetch(API+\"/login\",{method:\"POST\",body:JSON.stringify({username:el(\"user\").value,password:el(\"pass\").value})});if(r.ok)location.href=\"/status\";else toast(\"Credenciales inv\u00e1lidas\")};\n"
    "async function saveWifi(){const r=await request(\"/config\",{method:\"POST\",body:JSON.stringify({ssid:el(\"wifi-ssid\").value,password:el(\"wifi-pass\").value})});toast(r.ok?\"Wi-Fi guardado\":\"No se pudo guardar\")}\n"
    "async function scanWifi(){await request(\"/scan\",{method:\"POST\"});setTimeout(async()=>{const r=await request(\"/scan\");el(\"wifi-results\").textContent=JSON.stringify(await r.json(),null,2)},1200)}\n"
    "async function forgetWifi(){await request(\"/config/wifi/forget\",{method:\"POST\"});toast(\"Red eliminada\")}\n"
    "async function saveNetwork(){await request(\"/config/network\",{method:\"POST\",body:JSON.stringify({mode:el(\"network-mode\").value})});toast(\"Modo guardado\")}\n"
    "if(el(\"mqtt-form\"))el(\"mqtt-form\").onsubmit=async e=>{e.preventDefault();const r=await request(\"/config/mqtt\",{method:\"POST\",body:JSON.stringify({uri:el(\"mqtt-uri\").value,port:el(\"mqtt-port\").value,use_tls:el(\"mqtt-tls\").checked,qos_pub:0,qos_sub:1})});toast(r.ok?\"MQTT guardado\":\"No se pudo guardar\")};\n"
    "async function testMqtt(){const r=await request(\"/mqtt/test\",{method:\"POST\"});toast(r.ok?\"Publicaci\u00f3n enviada\":\"MQTT no conectado\")}\n"
    "if(el(\"serial-form\"))el(\"serial-form\").onsubmit=async e=>{e.preventDefault();const serial=el(\"serial\").value.trim().toUpperCase();if(!/^IOT-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(serial)){toast(\"Us\u00e1 el formato IOT-XXXX-XXXX\");return}const r=await request(\"/config/sensor\",{method:\"POST\",body:JSON.stringify({serial})});toast(r.ok?\"Serial guardado\":await r.text());if(r.ok)loadStatus()};\n"
    "if(el(\"password-form\"))el(\"password-form\").onsubmit=async e=>{e.preventDefault();const r=await request(\"/auth/password\",{method:\"POST\",body:JSON.stringify({current:el(\"current-pass\").value,new:el(\"new-pass\").value})});toast(r.ok?\"Contrase\u00f1a actualizada\":\"No se pudo actualizar\")};\n"
    "async function restartDevice(){await request(\"/restart\",{method:\"POST\"});toast(\"Reinicio solicitado\")}\n"
    "async function resetDevice(){if(confirm(\"\u00bfRestaurar configuraci\u00f3n de f\u00e1brica?\"))await request(\"/reset-factory\",{method:\"POST\"})}\n"
    "loadStatus();setInterval(loadStatus,5000);\n"
    "</script></body></html>\n"
;

#endif
