/*
 * web_pages.h
 *
 * Configuration web UI (Spanish UI text). Every view is wrapped by
 * HTML_HEAD + HTML_NAV + <view> + HTML_FOOTER, served by web_server.c.
 * Values coming from the device or the network are inserted with
 * textContent, never as HTML.
 */

#ifndef WEB_PAGES_H
#define WEB_PAGES_H

static const char *HTML_HEAD =
    "<!doctype html><html lang='es'><head><meta charset='utf-8'>"
    "<meta name='viewport' content='width=device-width,initial-scale=1'>"
    "<title>CEIoT - Dispositivo</title><style>"
    ":root{font-family:system-ui,sans-serif;color:#172033;background:#f5f7fb}"
    "body{margin:0}.container,.login{max-width:860px;margin:24px auto;padding:0 16px}"
    ".card{background:#fff;border:1px solid #dbe1ea;border-radius:12px;padding:20px;margin-bottom:16px}"
    ".nav{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:16px}"
    ".nav a,button{background:#1956d1;color:#fff;border:0;border-radius:8px;padding:10px 14px;text-decoration:none;cursor:pointer;margin:4px 4px 0 0}"
    ".nav a{background:#e8eefc;color:#173b82;margin:0}"
    "label{display:block;font-weight:600;margin:12px 0 5px}"
    "input{box-sizing:border-box;width:100%;padding:10px;border:1px solid #c5cedb;border-radius:8px}"
    ".grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px}"
    ".muted{color:#687386}.danger{background:#b42318}.ok{color:#067647}.bad{color:#b42318}"
    "dl{display:grid;grid-template-columns:auto 1fr;gap:6px 12px;margin:0}dt{color:#687386}dd{margin:0;font-weight:600;word-break:break-word}"
    "ul.nets{list-style:none;padding:0}ul.nets li{display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #eef1f5;padding:6px 0}"
    "</style></head><body>";

static const char *HTML_NAV =
    "<div class='container'><div class='nav'>"
    "<a href='/status'>Estado</a><a href='/wifi'>Wi-Fi</a><a href='/mqtt'>MQTT</a>"
    "<a href='/device'>Dispositivo</a><a href='/password'>Seguridad</a>"
    "<button onclick='logout()'>Cerrar sesión</button></div>";

static const char *HTML_LOGIN =
    "<div class='login'><div class='card'><h1>CEIoT</h1>"
    "<p class='muted'>Administración del dispositivo</p>"
    "<form id='login-form'><label>Usuario</label><input id='user' value='admin' required>"
    "<label>Contraseña</label><input id='pass' type='password' required>"
    "<button>Ingresar</button></form></div></div>";

static const char *VIEW_STATUS =
    "<div class='grid'>"
    "<div class='card'><h2>Dispositivo</h2><dl>"
    "<dt>Serial</dt><dd id='st-serial'>-</dd>"
    "<dt>Firmware</dt><dd id='st-fw'>-</dd>"
    "<dt>Sensor</dt><dd id='st-sensor'>-</dd>"
    "<dt>Encendido</dt><dd id='st-uptime'>-</dd>"
    "<dt>Memoria libre</dt><dd id='st-heap'>-</dd>"
    "<dt>Hora</dt><dd id='st-time'>-</dd></dl></div>"
    "<div class='card'><h2>Última lectura</h2><dl id='st-reading'><dt>Estado</dt><dd>Sin lecturas</dd></dl></div>"
    "<div class='card'><h2>Wi-Fi</h2><dl>"
    "<dt>Estado</dt><dd id='st-wifi'>-</dd>"
    "<dt>Red</dt><dd id='st-ssid'>-</dd>"
    "<dt>IP</dt><dd id='st-ip'>-</dd>"
    "<dt>Señal</dt><dd id='st-rssi'>-</dd>"
    "<dt>Punto de acceso</dt><dd id='st-ap'>-</dd></dl>"
    "<button id='ap-stop' style='display:none' onclick='stopAp()'>Desactivar punto de acceso</button></div>"
    "<div class='card'><h2>MQTT</h2><dl>"
    "<dt>Estado</dt><dd id='st-mqtt'>-</dd>"
    "<dt>Broker</dt><dd id='st-broker'>-</dd>"
    "<dt>Último evento</dt><dd id='st-mqtt-event'>-</dd>"
    "<dt>Último error</dt><dd id='st-mqtt-error'>-</dd>"
    "<dt>Certificados</dt><dd id='st-certs'>-</dd></dl></div>"
    "</div>";

static const char *VIEW_WIFI =
    "<div class='card'><h1>Wi-Fi</h1>"
    "<p class='muted'>Red guardada: <strong id='wifi-saved'>-</strong> &middot; Estado: <strong id='wifi-state'>-</strong></p>"
    "<label>Red (SSID)</label><input id='wifi-ssid' maxlength='32'>"
    "<label>Contraseña</label><input id='wifi-pass' type='password' maxlength='64'>"
    "<button onclick='saveWifi()'>Conectar</button><button onclick='scanWifi()'>Buscar redes</button>"
    "<button class='danger' onclick='forgetWifi()'>Olvidar red</button>"
    "<ul class='nets' id='wifi-results'></ul></div>";

static const char *VIEW_MQTT =
    "<div class='card'><h1>Broker MQTT</h1><form id='mqtt-form'>"
    "<div class='grid'><div><label>Host</label><input id='mqtt-uri' required></div>"
    "<div><label>Puerto</label><input id='mqtt-port' type='number' min='1' max='65535' required></div></div>"
    "<label><input id='mqtt-tls' type='checkbox' style='width:auto'> Usar TLS (mTLS)</label>"
    "<label>URL del backend (hora por HTTP)</label><input id='backend-url' placeholder='http://&lt;host del broker&gt;:18000'>"
    "<p class='muted'>Vacío: se usa <code>http://&lt;host del broker&gt;:18000</code>. En uso: <strong id='backend-effective'>-</strong></p>"
    "<p class='muted'>Los cambios se aplican al reiniciar el dispositivo.</p>"
    "<button>Guardar</button><button type='button' onclick='testMqtt()'>Probar publicación</button></form></div>"
    "<div class='card'><h2>Certificados</h2><dl>"
    "<dt>CA (root.crt)</dt><dd id='cert-root'>-</dd>"
    "<dt>Certificado (client.crt)</dt><dd id='cert-crt'>-</dd>"
    "<dt>Clave (client.key)</dt><dd id='cert-key'>-</dd></dl>"
    "<label>Subir root.crt</label><input id='up-root' type='file'>"
    "<label>Subir client.crt</label><input id='up-crt' type='file'>"
    "<label>Subir client.key</label><input id='up-key' type='file'>"
    "<button onclick='uploadCerts()'>Subir certificados</button>"
    "<button class='danger' onclick='resetCerts()'>Borrar certificados</button></div>";

static const char *VIEW_DEVICE =
    "<div class='card'><h1>Dispositivo</h1>"
    "<p>Formato del serial: <strong>IOT-XXXX-XXXX</strong>. Debe coincidir con el CN del certificado del dispositivo y con el alta en la plataforma.</p>"
    "<form id='serial-form'><label>Número de serie</label>"
    "<input id='serial' placeholder='IOT-XXXX-XXXX' pattern='IOT-[A-Za-z0-9]{4}-[A-Za-z0-9]{4}' required>"
    "<button id='save-serial'>Guardar serial</button></form>"
    "<p class='muted'>El serial se guarda una sola vez y se conserva al restaurar los valores de fábrica.</p></div>";

static const char *VIEW_PASSWORD =
    "<div class='card'><h1>Seguridad</h1><form id='password-form'>"
    "<label>Contraseña actual</label><input id='current-pass' type='password' required>"
    "<label>Nueva contraseña</label><input id='new-pass' type='password' minlength='6' required>"
    "<button>Cambiar contraseña</button></form></div>"
    "<div class='card'><h2>Sistema</h2>"
    "<p class='muted'>Restaurar valores de fábrica borra la red Wi-Fi, la configuración MQTT y la contraseña; conserva el serial y los certificados.</p>"
    "<button onclick='restartDevice()'>Reiniciar</button>"
    "<button class='danger' onclick='resetDevice()'>Restaurar valores de fábrica</button></div>";

static const char *HTML_FOOTER =
    "</div><script>"
    "const API='/api';const el=id=>document.getElementById(id);"
    "const set=(id,v)=>{const e=el(id);if(e)e.textContent=(v===undefined||v===null||v==='')?'-':v};"
    "async function request(path,options={}){const r=await fetch(API+path,{headers:{'Content-Type':'application/json'},...options});"
    "if(r.status===401){location.href='/login';throw new Error('unauthorized')}return r}"
    "function toast(m){alert(m)}"
    "function dur(s){s=Math.floor(s||0);const d=Math.floor(s/86400),h=Math.floor(s%86400/3600),m=Math.floor(s%3600/60);return (d?d+' d ':'')+h+' h '+m+' min'}"
    "const LABELS={temperature:['Temperatura','°C'],relative_humidity:['Humedad relativa','%'],pressure:['Presión','hPa']};"
    "function renderReading(s){const dl=el('st-reading');if(!dl)return;dl.textContent='';"
    "const add=(k,v)=>{const dt=document.createElement('dt');dt.textContent=k;const dd=document.createElement('dd');dd.textContent=v;dl.append(dt,dd)};"
    "if(!s||!s.last){add('Estado','Sin lecturas válidas todavía');return}"
    "for(const k in s.last){const l=LABELS[k]||[k,''];add(l[0],s.last[k]+' '+l[1])}add('Antigüedad',dur(s.age_s))}"
    "async function loadStatus(){if(!el('st-serial')&&!el('mqtt-uri')&&!el('serial')&&!el('wifi-saved'))return;"
    "const d=await (await request('/status')).json();"
    "if(el('st-serial')){set('st-serial',d.serial||'Sin asignar');set('st-fw',d.device.firmware_version);"
    "set('st-sensor',d.sensor.model+' ('+d.sensor.key+')');set('st-uptime',dur(d.device.uptime));"
    "set('st-heap',Math.round(d.device.heap_free/1024)+' KB');"
    "const SRC={ntp:'NTP',http:'HTTP',mqtt:'MQTT',rtc:'reloj interno'};"
    "set('st-time',d.time.synced?d.time.iso+' UTC ('+(SRC[d.time.source]||d.time.source)+')':'Sin sincronizar');renderReading(d.sensor);"
    "set('st-wifi',d.wifi.connected?'Conectado':(d.wifi.saved_ssid?'Desconectado'+(d.wifi.last_error?' ('+d.wifi.last_error+')':''):'Sin red configurada'));"
    "set('st-ssid',d.wifi.ssid||d.wifi.saved_ssid);set('st-ip',d.wifi.ip);set('st-rssi',d.wifi.connected?d.wifi.rssi+' dBm':'');"
    "set('st-ap',d.ap.active?'Activo ('+d.ap.ssid+')':'Inactivo');el('ap-stop').style.display=d.ap.active?'':'none';"
    "set('st-mqtt',d.mqtt.connected?'Conectado':'Desconectado');"
    "set('st-broker',(d.mqtt.use_tls?'mqtts://':'mqtt://')+d.mqtt.host+':'+d.mqtt.port);"
    "set('st-mqtt-event',d.mqtt.last_event);set('st-mqtt-error',d.mqtt.last_error);"
    "const c=d.certs;set('st-certs',c.root_crt&&c.client_crt&&c.client_key?'Completos':'Faltan archivos')}"
    "if(el('wifi-saved')){set('wifi-saved',d.wifi.saved_ssid||'ninguna');set('wifi-state',d.wifi.connected?'Conectado a '+d.wifi.ssid:'Desconectado')}"
    "if(el('mqtt-uri')&&!el('mqtt-uri').dataset.loaded){el('mqtt-uri').value=d.mqtt.host||'';el('mqtt-port').value=d.mqtt.port||'18883';"
    "el('mqtt-tls').checked=!!d.mqtt.use_tls;el('backend-url').value=d.mqtt.backend_url_configured||'';el('mqtt-uri').dataset.loaded='1'}"
    "if(el('backend-effective'))set('backend-effective',d.mqtt.backend_url);"
    "if(el('cert-root')){const c=d.certs,y=v=>v?'Presente':'Falta';set('cert-root',y(c.root_crt));set('cert-crt',y(c.client_crt));set('cert-key',y(c.client_key))}"
    "if(el('serial')&&!el('serial').dataset.loaded){el('serial').value=d.serial||'';el('serial').dataset.loaded='1';"
    "if(d.serial){el('serial').disabled=true;el('save-serial').disabled=true}}}"
    "function logout(){document.cookie='iot_session=; Max-Age=0; path=/';location.href='/login'}"
    "if(el('login-form'))el('login-form').onsubmit=async e=>{e.preventDefault();"
    "const r=await fetch(API+'/login',{method:'POST',body:JSON.stringify({username:el('user').value,password:el('pass').value})});"
    "if(r.ok)location.href='/status';else toast('Credenciales inválidas')};"
    "async function stopAp(){await request('/ap/stop',{method:'POST'});toast('Punto de acceso desactivado');loadStatus()}"
    "async function saveWifi(){const ssid=el('wifi-ssid').value.trim();if(!ssid){toast('Ingrese el nombre de la red');return}"
    "const r=await request('/config',{method:'POST',body:JSON.stringify({ssid,password:el('wifi-pass').value})});"
    "toast(r.ok?'Conectando a '+ssid+'. Verifique el estado en unos segundos.':'No se pudo guardar')}"
    "async function scanWifi(){const ul=el('wifi-results');ul.textContent='Buscando...';await request('/scan',{method:'POST'});"
    "setTimeout(async()=>{const nets=await (await request('/scan')).json();ul.textContent='';"
    "nets.sort((a,b)=>b.rssi-a.rssi).forEach(n=>{if(!n.ssid)return;const li=document.createElement('li');const s=document.createElement('span');"
    "s.textContent=n.ssid+' ('+n.rssi+' dBm'+(n.auth?'':', abierta')+')';const b=document.createElement('button');b.textContent='Elegir';"
    "b.onclick=()=>{el('wifi-ssid').value=n.ssid;el('wifi-pass').focus()};li.append(s,b);ul.append(li)});"
    "if(!ul.children.length)ul.textContent='No se encontraron redes'},3000)}"
    "async function forgetWifi(){if(!confirm('¿Olvidar la red guardada?'))return;await request('/config/wifi/forget',{method:'POST'});toast('Red eliminada');loadStatus()}"
    "if(el('mqtt-form'))el('mqtt-form').onsubmit=async e=>{e.preventDefault();"
    "const r=await request('/config/mqtt',{method:'POST',body:JSON.stringify({uri:el('mqtt-uri').value.trim(),port:el('mqtt-port').value,use_tls:el('mqtt-tls').checked,backend_url:el('backend-url').value.trim()})});"
    "toast(r.ok?'MQTT guardado. Reinicie el dispositivo para aplicarlo.':'No se pudo guardar')};"
    "async function testMqtt(){const r=await request('/mqtt/test',{method:'POST'});toast(r.ok?'Publicación enviada':'MQTT no conectado')}"
    "async function uploadCerts(){const files=[['up-root','root.crt'],['up-crt','client.crt'],['up-key','client.key']];let n=0;"
    "for(const [id,name] of files){const f=el(id).files[0];if(!f)continue;"
    "const r=await fetch(API+'/files?path='+name,{method:'POST',body:f});if(!r.ok){toast('Error al subir '+name);return}n++}"
    "toast(n?n+' archivo(s) subido(s). Reinicie el dispositivo para aplicarlos.':'Seleccione al menos un archivo');loadStatus()}"
    "async function resetCerts(){if(!confirm('¿Borrar los certificados del dispositivo?'))return;await request('/mqtt/reset-certs',{method:'POST'});toast('Certificados borrados');loadStatus()}"
    "if(el('serial-form'))el('serial-form').onsubmit=async e=>{e.preventDefault();const serial=el('serial').value.trim().toUpperCase();"
    "if(!/^IOT-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(serial)){toast('Use el formato IOT-XXXX-XXXX');return}"
    "const r=await request('/config/sensor',{method:'POST',body:JSON.stringify({serial})});"
    "toast(r.ok?'Serial guardado. Reinicie el dispositivo para aplicarlo.':await r.text());if(r.ok){el('serial').dataset.loaded='';loadStatus()}};"
    "if(el('password-form'))el('password-form').onsubmit=async e=>{e.preventDefault();"
    "const r=await request('/auth/password',{method:'POST',body:JSON.stringify({current:el('current-pass').value,new:el('new-pass').value})});"
    "toast(r.ok?'Contraseña actualizada':'No se pudo actualizar');if(r.ok)location.href='/login'};"
    "async function restartDevice(){if(!confirm('¿Reiniciar el dispositivo?'))return;await request('/restart',{method:'POST'});toast('Reiniciando...')}"
    "async function resetDevice(){if(confirm('¿Restaurar los valores de fábrica? Se borrará la red Wi-Fi y la configuración.'))"
    "{await request('/reset-factory',{method:'POST'});toast('Restaurando y reiniciando...')}}"
    "if(!el('login-form')){loadStatus();setInterval(loadStatus,5000)}"
    "</script></body></html>";

#endif // WEB_PAGES_H
