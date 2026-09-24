import asyncio
import json
import logging
import random
import re
from typing import Callable, Any, Dict
import paho.mqtt.client as mqtt
from app.core.config import settings

logger = logging.getLogger(__name__)


def _topic_matches(pattern: str, topic: str) -> bool:
    """Match MQTT topic against a pattern with + and # wildcards."""
    if pattern == topic:
        return True
    regex = re.escape(pattern).replace(r'\+', '[^/]+').replace(r'\#', '.+')
    return bool(re.fullmatch(regex, topic))


class MQTTClient:
    def __init__(self):
        self.client = mqtt.Client(client_id=settings.MQTT_CLIENT_ID)
        self.connected = False
        self.loop = None
        self._reconnect_task = None
        self._stop_requested = False

        # Backoff config from settings
        self._initial_delay = settings.MQTT_RETRY_INITIAL_DELAY
        self._max_delay = settings.MQTT_RETRY_MAX_DELAY
        self._max_attempts = settings.MQTT_RETRY_MAX_ATTEMPTS  # 0 = infinito

        self.client.username_pw_set(
            username=settings.EMQX_USER, password=settings.EMQX_PASSWORD
        )

        self.client.on_connect = self.on_connect
        self.client.on_disconnect = self.on_disconnect
        self.client.on_message = self.on_message
        self.client.on_publish = self.on_publish
        self.client.on_subscribe = self.on_subscribe

        # Callbacks registry: {topic: (callback_function, qos)}
        self.callbacks: Dict[str, tuple] = {}

    def _calculate_backoff(self, attempt: int) -> float:
        """Calcula delay con backoff exponencial + jitter aleatorio."""
        delay = min(self._initial_delay * (2**attempt), self._max_delay)
        # Añadir jitter aleatorio (±20%) para evitar thundering herd
        jitter = delay * 0.2 * (random.random() * 2 - 1)
        return max(1, delay + jitter)

    def on_connect(self, client, userdata, flags, rc):
        if rc == 0:
            logger.info(f"✅ MQTT Connected! RC={rc}")
            self.connected = True
            # Resubscribe to topics if reconnected
            for topic, (callback, qos) in self.callbacks.items():
                client.subscribe(topic, qos=qos)
                logger.info(f"📡 Resubscribed to {topic} (QoS={qos})")
        else:
            logger.error(f"❌ MQTT Connection failed with code {rc}")

    def on_subscribe(self, client, userdata, mid, granted_qos):
        logger.debug(f"📝 Subscribed: mid={mid}, qos={granted_qos}")

    def on_disconnect(self, client, userdata, rc):
        logger.warning(f"⚠️ MQTT Disconnected (rc={rc})")
        self.connected = False

        # Iniciar reconexión automática si no fue stop manual
        if not self._stop_requested and self.loop and self.loop.is_running():
            if self._reconnect_task is None or self._reconnect_task.done():
                self._reconnect_task = asyncio.run_coroutine_threadsafe(
                    self._reconnect_loop(), self.loop
                )

    def on_message(self, client, userdata, msg):
        topic = msg.topic
        payload_size = len(msg.payload or b"")
        try:
            payload = msg.payload.decode()
        except:
            payload = str(msg.payload)

        logger.info(
            "📩 MQTT Message topic=%s qos=%s payload_bytes=%s",
            topic,
            msg.qos,
            payload_size,
        )

        matched = False
        for pattern, (callback, qos) in self.callbacks.items():
            if _topic_matches(pattern, topic):
                matched = True
                if self.loop and self.loop.is_running():
                    asyncio.run_coroutine_threadsafe(callback(topic, payload), self.loop)
                else:
                    logger.error("❌ Event loop is not running, cannot schedule callback")
        if not matched:
            logger.debug("📭 No callback registered for topic=%s", topic)

    def on_publish(self, client, userdata, mid):
        logger.debug(f"📤 Message Published (mid={mid})")

    async def _reconnect_loop(self):
        """Loop de reconexión con backoff exponencial."""
        attempt = 0
        host = settings.EMQX_HOST
        port = settings.EMQX_PORT

        while not self._stop_requested:
            if self.connected:
                return  # Ya conectado, salir

            # Verificar límite de intentos (0 = infinito)
            if self._max_attempts > 0 and attempt >= self._max_attempts:
                logger.error(
                    f"❌ MQTT: Máximo de {self._max_attempts} intentos alcanzado. Deteniendo reconexión."
                )
                return

            delay = self._calculate_backoff(attempt)
            logger.info(
                f"🔄 MQTT Reconexión en {delay:.1f}s (intento {attempt + 1}{'/' + str(self._max_attempts) if self._max_attempts > 0 else '/∞'})"
            )

            await asyncio.sleep(delay)

            if self._stop_requested:
                return

            try:
                self.client.reconnect()
                logger.info(f"✅ MQTT Reconexión exitosa")
                return
            except Exception as e:
                logger.warning(f"⚠️ MQTT Reconexión fallida: {e}")
                attempt += 1

    def start(self):
        """Inicia conexión MQTT en background sin bloquear FastAPI."""
        self._stop_requested = False

        try:
            self.loop = asyncio.get_running_loop()
            logger.info("✅ Captured event loop in MQTTClient.start")
        except RuntimeError:
            logger.error("❌ No running event loop in MQTTClient.start")
            return

        host = settings.EMQX_HOST
        port = settings.EMQX_PORT
        logger.info(
            f"🔌 MQTT Config: Host={host}, Port={port}, User={settings.EMQX_USER}"
        )
        logger.info(
            f"🔌 MQTT Backoff: initial={self._initial_delay}s, max={self._max_delay}s, attempts={'∞' if self._max_attempts == 0 else self._max_attempts}"
        )

        # Intentar conexión inicial síncrona (rápida)
        try:
            logger.info(f"🔌 Connecting to MQTT Broker at {host}:{port}")
            self.client.connect(host, port, 60)
            self.client.loop_start()
            return
        except Exception as e:
            logger.warning(f"⚠️ Conexión inicial MQTT fallida: {e}")
            # Iniciar reconexión en background
            self.client.loop_start()  # Necesario para que on_disconnect funcione
            self._reconnect_task = asyncio.run_coroutine_threadsafe(
                self._reconnect_loop(), self.loop
            )

    def stop(self):
        """Detiene el cliente MQTT de forma limpia."""
        self._stop_requested = True
        if self._reconnect_task:
            self._reconnect_task.cancel()
        self.client.loop_stop()
        self.client.disconnect()
        logger.info("🛑 MQTT Client detenido")

    def subscribe(self, topic: str, callback: Callable, qos: int = 0):
        self.callbacks[topic] = (callback, qos)
        if self.connected:
            self.client.subscribe(topic, qos=qos)
            logger.info(f"📡 Subscribed to {topic} (QoS={qos})")

    def publish(self, topic: str, message: Dict[str, Any], qos: int = 1, retain: bool = False):
        try:
            payload = json.dumps(message)
            self.client.publish(topic, payload, qos=qos, retain=retain)
            logger.info(
                "📤 MQTT Publish topic=%s qos=%s retain=%s payload_bytes=%s serial=%s",
                topic,
                qos,
                retain,
                len(payload.encode("utf-8")),
                message.get("serial"),
            )
        except Exception as e:
            logger.error(f"❌ Error publishing to {topic}: {e}")


# Global instance
mqtt_client = MQTTClient()


def get_mqtt_client() -> MQTTClient:
    return mqtt_client
