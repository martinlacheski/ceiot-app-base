import json
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
COMPONENTS = ("backend", "embeddings", "frontend", "landing", "mailpit", "mqtt", "pgadmin", "redis", "redisinsight", "seaweedfs", "timescaledb")

# Values shared by several services live in the root .env; every service
# derives its URLs from them.
ROOT_ENV = """\
PUBLIC_SCHEME=http
PUBLIC_HOST=localhost
BACKEND_PORT=18001
FRONTEND_PORT=15174
LANDING_PORT=14322
LAN_BIND_IP=
GOOGLE_MAPS_API_KEY=dummy-map-key
"""

DUMMY_ENV = {
    "backend": """\
ENVIRONMENT=DEV
MAIL_TRANSPORT=mailpit
SAFE_BACKEND_SENTINEL=backend-fixture
""",
    "frontend": """\
VITE_TOKEN_REFRESH=15
VITE_SESSION_TIMEOUT=30
""",
    "landing": """\
PUBLIC_MAP_LOCATIONS_URL=/map-locations.json
""",
    "embeddings": "",
    "mailpit": "",
    "pgadmin": "",
    "redis": "",
    "redisinsight": "",
    # Intentionally no S3 credentials: the stack must render and start without them.
    "seaweedfs": "",
    "mqtt": """\
MQTT_LISTENER_TCP=11884
MQTT_LISTENER_TLS=18884
MQTT_LISTENER_WS=18084
EMQX_PASSWORD=dummy-dashboard-password
EMQX_BACKEND_PASSWORD=dummy-backend-password
""",
    "timescaledb": """\
DB_PORT=15433
DB_USER=dummy_user
DB_PASSWORD=dummy_password
ALEMBIC_DB_USER=dummy_admin
ALEMBIC_DB_PASSWORD=dummy_admin_password
DB_DATABASE=dummy_database
DATABASE_URL=postgresql+psycopg://wrong:wrong@postgresql:15433/wrong
ALEMBIC_DATABASE_URL=postgresql+psycopg://wrong:wrong@wrong-host:9999/wrong
""",
}


@unittest.skipUnless(
    (REPO_ROOT / "docker-compose.yml").is_file() and shutil.which("docker"),
    "Needs the repository root docker-compose.yml and the docker CLI; run on the host.",
)
class ComposeConfigTest(unittest.TestCase):
    maxDiff = None

    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.project = Path(self.temp_dir.name)

        shutil.copy2(REPO_ROOT / "docker-compose.yml", self.project / "docker-compose.yml")
        (self.project / ".env").write_text(ROOT_ENV, encoding="utf-8")
        for component in COMPONENTS:
            destination = self.project / component
            destination.mkdir()
            shutil.copy2(
                REPO_ROOT / component / "docker-compose.yml",
                destination / "docker-compose.yml",
            )
            (destination / ".env").write_text(DUMMY_ENV[component], encoding="utf-8")

    def tearDown(self):
        self.temp_dir.cleanup()

    def render_config(self, *, profile=None, environment_override=None):
        environment = {
            "PATH": os.environ.get("PATH", ""),
            "HOME": os.environ.get("HOME", ""),
        }
        if environment_override:
            environment.update(environment_override)
        command = [
            "docker",
            "compose",
            "-p",
            "compose-contract-test",
            "-f",
            str(self.project / "docker-compose.yml"),
        ]
        if profile:
            command.extend(["--profile", profile])
        command.extend(["config", "--format", "json"])
        result = subprocess.run(
            command,
            cwd=self.project,
            env=environment,
            text=True,
            capture_output=True,
            timeout=30,
            check=False,
        )
        self.assertEqual(
            result.returncode,
            0,
            msg=f"Compose fixture failed without exposing rendered config: {result.stderr}",
        )
        return json.loads(result.stdout)

    def write_env(self, component, text):
        path = self.project / component / ".env" if component else self.project / ".env"
        path.write_text(text, encoding="utf-8")

    @staticmethod
    def published_port(service, target, host_ip="127.0.0.1"):
        matches = [
            port
            for port in service["ports"]
            if port["target"] == target and port.get("host_ip") == host_ip
        ]
        if len(matches) != 1:
            raise AssertionError(f"expected one publication for container port {target} on {host_ip}")
        return matches[0]

    def test_root_include_renders_default_services_on_one_private_network(self):
        config = self.render_config()
        self.assertEqual(
            set(config["services"]),
            {
                "backend",
                "mqtt-runtime",
                "frontend",
                "landing",
                "emqx",
                "postgresql",
                "redis",
                "seaweedfs",
                "pgadmin",
                "redisinsight",
            },
        )
        self.assertEqual(set(config["networks"]), {"app-network"})
        self.assertNotIn("external", config["networks"]["app-network"])

        for service in config["services"].values():
            self.assertEqual(set(service["networks"]), {"app-network"})
            self.assertIn("healthcheck", service)
            self.assertNotIn("container_name", service)
            self.assertNotIn("labels", service)

    def test_mqtt_runtime_consumes_device_topics_from_the_backend_image(self):
        services = self.render_config()["services"]
        runtime = services["mqtt-runtime"]
        backend = services["backend"]

        self.assertEqual(runtime["build"]["context"], backend["build"]["context"])
        self.assertIn("app.main_runtime:app", " ".join(runtime["command"]))
        self.assertNotIn("ports", runtime)
        self.assertNotEqual(
            runtime["environment"]["MQTT_CLIENT_ID"],
            backend["environment"]["MQTT_CLIENT_ID"],
        )
        self.assertEqual(runtime["environment"]["MAIL_TRANSPORT"], "mailpit")
        self.assertIn("postgresql", runtime["depends_on"])
        self.assertIn("emqx", runtime["depends_on"])

    def test_emqx_requires_mtls_for_devices_and_credentials_for_backend_clients(self):
        services = self.render_config()["services"]
        emqx = services["emqx"]
        backend = services["backend"]
        runtime = services["mqtt-runtime"]
        env = emqx["environment"]

        # SSL (device-facing) listener: client cert mandatory, no separate
        # username/password authenticator, identity comes from the cert CN.
        self.assertEqual(env["EMQX_LISTENERS__SSL__DEFAULT__SSL_OPTIONS__VERIFY"], "verify_peer")
        self.assertEqual(env["EMQX_LISTENERS__SSL__DEFAULT__SSL_OPTIONS__FAIL_IF_NO_PEER_CERT"], "true")
        self.assertEqual(env["EMQX_LISTENERS__SSL__DEFAULT__ENABLE_AUTHN"], "false")
        self.assertEqual(env["EMQX_MQTT__PEER_CERT_AS_USERNAME"], "cn")

        # TCP (backend-facing) listener: built-in-database username/password,
        # anonymous rejected by default once an authenticator is configured.
        self.assertEqual(env["EMQX_AUTHENTICATION__1__MECHANISM"], "password_based")
        self.assertEqual(env["EMQX_AUTHENTICATION__1__BACKEND"], "built_in_database")
        self.assertEqual(env["EMQX_AUTHENTICATION__1__USER_ID_TYPE"], "username")

        # File-based ACL, closed by default.
        self.assertEqual(env["EMQX_AUTHORIZATION__NO_MATCH"], "deny")
        self.assertEqual(env["EMQX_AUTHORIZATION__SOURCES__1__TYPE"], "file")
        self.assertEqual(env["EMQX_AUTHORIZATION__SOURCES__1__PATH"], "/opt/emqx/etc/acl.conf")

        # The wrapper entrypoint renders the bootstrap CSV before emqx boots;
        # compose must spell out the image CMD explicitly (entrypoint-only
        # overrides drop it) or the wrapper execs with no arguments.
        self.assertEqual(emqx["entrypoint"], ["/opt/emqx/docker-entrypoint-wrapper.sh"])
        self.assertEqual(emqx["command"], ["emqx", "foreground"])

        # backend and mqtt-runtime authenticate as the same built-in-database
        # user, with the password sourced from mqtt/.env (never duplicated
        # into backend/.env), so they can never silently drift apart.
        for service in (backend, runtime):
            self.assertEqual(service["environment"]["EMQX_USER"], "backend-services")
            self.assertEqual(service["environment"]["EMQX_PASSWORD"], "dummy-backend-password")

    def test_redis_is_internal_only_persistent_and_wired_to_backend_and_runtime(self):
        services = self.render_config()["services"]
        redis = services["redis"]

        self.assertEqual(redis["image"], "redis:7-alpine")
        # Internal network only: no host publication, no password to leak.
        self.assertNotIn("ports", redis)
        self.assertEqual(set(redis["networks"]), {"app-network"})
        self.assertIn("healthcheck", redis)
        self.assertIn("--appendonly", redis["command"])
        self.assertEqual(redis["command"][redis["command"].index("--appendonly") + 1], "yes")
        data_mounts = [m for m in redis["volumes"] if m["target"] == "/data"]
        self.assertEqual(len(data_mounts), 1)
        self.assertEqual(data_mounts[0]["type"], "bind")
        self.assertTrue(data_mounts[0]["source"].endswith("/redis/data"))

        for name in ("backend", "mqtt-runtime"):
            service = services[name]
            self.assertEqual(service["environment"]["REDIS_URL"], "redis://redis:6379/0")
            self.assertIn("redis", service["depends_on"])

    def test_emqx_internal_addresses_are_fixed_by_compose(self):
        services = self.render_config()["services"]

        # Internal Docker DNS and container ports: not user configuration, so
        # backend/.env does not need them (the fixture above omits them).
        for name in ("backend", "mqtt-runtime"):
            environment = services[name]["environment"]
            self.assertEqual(environment["EMQX_HOST"], "emqx", name)
            self.assertEqual(environment["EMQX_PORT"], "1883", name)
            self.assertEqual(environment["EMQX_API_BASE_URL"], "http://emqx:18083", name)

    def test_backend_geocoding_key_defaults_to_the_shared_google_maps_key(self):
        services = self.render_config()["services"]

        # location/service.py geocodes with GCP_API_KEY; the root .env holds the
        # single Google Maps key unless backend/.env overrides it.
        for name in ("backend", "mqtt-runtime"):
            self.assertEqual(services[name]["environment"]["GCP_API_KEY"], "dummy-map-key", name)

        self.write_env("backend", DUMMY_ENV["backend"] + "GCP_API_KEY=server-only-key\n")
        services = self.render_config()["services"]
        self.assertEqual(services["backend"]["environment"]["GCP_API_KEY"], "server-only-key")

    def test_seaweedfs_is_internal_only_persistent_and_optional_for_the_backend(self):
        services = self.render_config()["services"]
        seaweedfs = services["seaweedfs"]

        self.assertTrue(seaweedfs["image"].startswith("chrislusf/seaweedfs:"))
        self.assertNotEqual(seaweedfs["image"].split(":")[-1], "latest")
        # Internal network only: the browser never talks to object storage.
        self.assertNotIn("ports", seaweedfs)
        self.assertIn("healthcheck", seaweedfs)
        self.assertEqual(seaweedfs["entrypoint"], ["/usr/local/bin/seaweedfs-entrypoint.sh"])
        self.assertEqual(seaweedfs["command"][0], "server")
        self.assertIn("-s3", seaweedfs["command"])
        data_mounts = [m for m in seaweedfs["volumes"] if m["target"] == "/data"]
        self.assertEqual(len(data_mounts), 1)
        self.assertEqual(data_mounts[0]["type"], "bind")
        self.assertTrue(data_mounts[0]["source"].endswith("/seaweedfs/data"))

        for name in ("backend", "mqtt-runtime"):
            environment = services[name]["environment"]
            self.assertEqual(environment["S3_ENDPOINT_URL"], "http://seaweedfs:8333")
            self.assertEqual(environment["S3_BUCKET"], "ceiot-documents")
            # Credentials are optional: the stack must not hard-fail without them,
            # and the backend must not wait for (or require) the storage service.
            self.assertNotIn("seaweedfs", services[name]["depends_on"])

    def test_s3_credentials_come_from_the_optional_seaweedfs_env_file(self):
        (self.project / "seaweedfs" / ".env").write_text(
            "S3_ACCESS_KEY=dummy-access\nS3_SECRET_KEY=dummy-secret\n", encoding="utf-8"
        )
        services = self.render_config()["services"]
        for name in ("seaweedfs", "backend", "mqtt-runtime"):
            self.assertIn("S3_ACCESS_KEY", services[name]["environment"], name)
            self.assertEqual(services[name]["environment"]["S3_ACCESS_KEY"], "dummy-access")
            self.assertEqual(services[name]["environment"]["S3_SECRET_KEY"], "dummy-secret")

    def test_stack_renders_without_a_seaweedfs_env_file(self):
        (self.project / "seaweedfs" / ".env").unlink()
        services = self.render_config()["services"]
        for name in ("seaweedfs", "backend", "mqtt-runtime"):
            self.assertNotIn("S3_SECRET_KEY", services[name].get("environment", {}), name)

    def test_mailpit_profile_is_optional_and_transport_is_explicit(self):
        default_services = self.render_config()["services"]
        self.assertNotIn("mailpit", default_services)
        self.assertEqual(default_services["backend"]["environment"]["MAIL_TRANSPORT"], "mailpit")
        self.assertNotIn("mailpit", default_services["backend"].get("depends_on", {}))

        profiled_services = self.render_config(profile="local-mail")["services"]
        mailpit = profiled_services["mailpit"]
        self.assertEqual(mailpit["image"], "axllent/mailpit:v1.27.4")
        self.assertEqual(set(mailpit["networks"]), {"app-network"})
        self.assertNotIn("container_name", mailpit)
        self.assertNotIn("volumes", mailpit)
        self.assertNotIn("healthcheck", mailpit)  # The pinned image provides /mailpit readyz.
        ui_port = self.published_port(mailpit, 8025)
        self.assertEqual(ui_port["host_ip"], "127.0.0.1")
        self.assertEqual(str(ui_port["published"]), "8025")
        self.assertEqual(len(mailpit["ports"]), 1)

        overridden = self.render_config(environment_override={"MAIL_TRANSPORT": "smtp"})
        self.assertEqual(overridden["services"]["backend"]["environment"]["MAIL_TRANSPORT"], "smtp")
        self.assertEqual(
            overridden["services"]["backend"]["environment"]["SAFE_BACKEND_SENTINEL"],
            "backend-fixture",
        )

    def test_pgadmin_and_redisinsight_start_by_default_on_loopback(self):
        services = self.render_config()["services"]
        for name, image_prefix, target, published in (
            ("pgadmin", "dpage/pgadmin4:", 80, "15050"),
            ("redisinsight", "redis/redisinsight:", 5540, "15540"),
        ):
            service = services[name]
            self.assertTrue(service["image"].startswith(image_prefix), name)
            self.assertNotIn(":latest", service["image"])
            self.assertEqual(set(service["networks"]), {"app-network"}, name)
            self.assertNotIn("container_name", service)
            self.assertNotIn("labels", service)
            self.assertIn("healthcheck", service)
            self.assertEqual(len(service["ports"]), 1)
            port = self.published_port(service, target)
            self.assertEqual(port["host_ip"], "127.0.0.1")
            self.assertEqual(str(port["published"]), published)
        self.assertEqual(
            services["pgadmin"]["depends_on"]["postgresql"]["condition"], "service_healthy"
        )
        self.assertEqual(
            services["redisinsight"]["depends_on"]["redis"]["condition"], "service_healthy"
        )
        # Server preconfiguration comes from the timescaledb variables.
        env = services["pgadmin"]["environment"]
        self.assertEqual(env["PGADMIN_DB_NAME"], "dummy_database")
        # pgAdmin administers the database: it connects as the migration superuser.
        self.assertEqual(env["PGADMIN_DB_USER"], "dummy_admin")
        self.assertEqual(env["PGADMIN_SERVER_JSON_FILE"], "/tmp/servers.json")
        self.assertNotIn("RI_REDIS_HOST", services["redisinsight"].get("environment", {}))

    def test_embeddings_local_profile_adds_an_internal_pinned_tei_service(self):
        default = self.render_config()["services"]
        self.assertNotIn("embeddings", default)
        # The backend knows where the local server would be, but never waits for it.
        for name in ("backend", "mqtt-runtime"):
            self.assertEqual(default[name]["environment"]["EMBEDDING_LOCAL_URL"], "http://embeddings:80")
            self.assertNotIn("embeddings", default[name]["depends_on"])

        config = self.render_config(profile="embeddings-local")
        service = config["services"]["embeddings"]
        self.assertTrue(
            service["image"].startswith("ghcr.io/huggingface/text-embeddings-inference:cpu-"), service["image"]
        )
        self.assertNotIn(":latest", service["image"])
        self.assertNotRegex(service["image"], r":cpu-?$")
        self.assertEqual(service["command"][:2], ["--model-id", "BAAI/bge-m3"])
        self.assertNotIn("ports", service)  # internal network only
        self.assertEqual(set(service["networks"]), {"app-network"})
        self.assertIn("healthcheck", service)
        self.assertNotIn("container_name", service)
        self.assertNotIn("labels", service)
        cache = [m for m in service["volumes"] if m["target"] == "/data"]
        self.assertEqual(len(cache), 1)
        self.assertEqual(cache[0]["type"], "volume")  # model cache survives recreation
        self.assertIn("embeddings-data", config["volumes"])

    def test_tools_ports_can_be_overridden(self):
        services = self.render_config(
            environment_override={"PGADMIN_PORT": "25050", "REDISINSIGHT_PORT": "25540"},
        )["services"]
        self.assertEqual(str(self.published_port(services["pgadmin"], 80)["published"]), "25050")
        self.assertEqual(
            str(self.published_port(services["redisinsight"], 5540)["published"]), "25540"
        )

    def test_ports_use_component_fixture_values_and_loopback_only(self):
        services = self.render_config()["services"]
        expected = {
            "backend": (8000, "18001"),
            "frontend": (80, "15174"),
            "landing": (80, "14322"),
            "postgresql": (5432, "15433"),
        }
        for service_name, (target, published) in expected.items():
            port = self.published_port(services[service_name], target)
            self.assertEqual(port["host_ip"], "127.0.0.1")
            self.assertEqual(str(port["published"]), published)

        mqtt_ports = {1883: "11884", 8883: "18884", 8083: "18084", 18083: "18083"}
        for target, published in mqtt_ports.items():
            port = self.published_port(services["emqx"], target)
            self.assertEqual(port["host_ip"], "127.0.0.1")
            self.assertEqual(str(port["published"]), published)
        # The fifth publication is the mTLS port on LAN_BIND_IP (unset: 127.0.0.2).
        self.assertEqual(len(services["emqx"]["ports"]), 5)
        self.assertEqual(str(self.published_port(services["emqx"], 8883, "127.0.0.2")["published"]), "18884")
        self.assertEqual(str(self.published_port(services["backend"], 8000, "127.0.0.2")["published"]), "18001")

    def test_database_urls_always_target_internal_dns_and_backend_waits_for_health(self):
        config = self.render_config()
        backend = config["services"]["backend"]
        postgresql = config["services"]["postgresql"]

        app_url = (
            "postgresql+psycopg://dummy_user:dummy_password"
            "@postgresql:5432/dummy_database"
        )
        admin_url = (
            "postgresql+psycopg://dummy_admin:dummy_admin_password"
            "@postgresql:5432/dummy_database"
        )
        # The application logs in as the unprivileged DB_USER; migrations as the superuser.
        for name in ("backend", "mqtt-runtime"):
            environment = config["services"][name]["environment"]
            self.assertEqual(environment["DATABASE_URL"], app_url, name)
            self.assertEqual(environment["ALEMBIC_DATABASE_URL"], admin_url, name)
            self.assertEqual(environment["DB_APP_ROLE"], "dummy_user", name)
        self.assertEqual(
            backend["depends_on"]["postgresql"]["condition"], "service_healthy"
        )
        self.assertIn("healthcheck", postgresql)

        db_mounts = [
            mount
            for mount in postgresql["volumes"]
            if mount["target"] == "/var/lib/postgresql/data"
        ]
        self.assertEqual(len(db_mounts), 1)
        self.assertEqual(db_mounts[0]["type"], "volume")
        self.assertEqual(db_mounts[0]["source"], "postgres-data")
        self.assertIn("postgres-data", config["volumes"])

    def test_postgresql_superuser_is_the_migration_role_and_creates_the_app_login(self):
        postgresql = self.render_config()["services"]["postgresql"]
        environment = postgresql["environment"]
        self.assertEqual(environment["POSTGRES_USER"], "dummy_admin")
        self.assertEqual(environment["POSTGRES_PASSWORD"], "dummy_admin_password")
        self.assertEqual(environment["DB_USER"], "dummy_user")
        self.assertEqual(environment["DB_PASSWORD"], "dummy_password")
        init_mounts = [
            mount for mount in postgresql["volumes"]
            if mount["target"].startswith("/docker-entrypoint-initdb.d")
        ]
        # A single file, never the whole folder (the image's own init scripts must stay visible).
        self.assertEqual(len(init_mounts), 1)
        self.assertEqual(init_mounts[0]["target"], "/docker-entrypoint-initdb.d/01-create-app-role.sh")
        self.assertTrue(init_mounts[0]["read_only"])
        self.assertTrue(init_mounts[0]["source"].endswith("timescaledb/init/01-create-app-role.sh"))

    def test_missing_migration_superuser_fails_without_reading_real_env(self):
        env_path = self.project / "timescaledb" / ".env"
        env_path.write_text(
            DUMMY_ENV["timescaledb"].replace("ALEMBIC_DB_USER=dummy_admin\n", ""), encoding="utf-8"
        )
        result = subprocess.run(
            ["docker", "compose", "-p", "compose-contract-test", "-f",
             str(self.project / "docker-compose.yml"), "config", "--quiet"],
            cwd=self.project,
            env={"PATH": os.environ.get("PATH", ""), "HOME": os.environ.get("HOME", "")},
            text=True, capture_output=True, timeout=30, check=False,
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("ALEMBIC_DB_USER", result.stderr)

    def test_healthchecks_use_working_container_loopback_hosts(self):
        services = self.render_config()["services"]
        backend_probe = services["backend"]["healthcheck"]["test"][-1]
        frontend_probe = services["frontend"]["healthcheck"]["test"][-1]
        landing_probe = services["landing"]["healthcheck"]["test"][-1]

        self.assertIn("http://localhost:8000/health", backend_probe)
        self.assertNotIn("127.0.0.1", backend_probe)
        self.assertEqual(frontend_probe, "http://127.0.0.1/")
        self.assertEqual(landing_probe, "http://127.0.0.1/")

    def test_child_paths_and_build_time_public_urls_remain_component_relative(self):
        services = self.render_config()["services"]
        for component in ("backend", "frontend", "landing"):
            self.assertEqual(
                Path(services[component]["build"]["context"]),
                self.project / component,
            )

        frontend_args = services["frontend"]["build"]["args"]
        self.assertEqual(frontend_args["VITE_API_URL"], "http://localhost:18001/api")
        self.assertEqual(frontend_args["VITE_APP_LOGIN_URL"], "http://localhost:15174/auth/login")
        self.assertEqual(frontend_args["VITE_LANDING_URL"], "http://localhost:14322")
        self.assertFalse(any(key.startswith("VITE_MP_") for key in frontend_args))

        landing_args = services["landing"]["build"]["args"]
        self.assertEqual(landing_args["PUBLIC_API_BASE_URL"], "http://localhost:18001/api")
        self.assertEqual(landing_args["PUBLIC_APP_LOGIN_URL"], "http://localhost:15174/auth/login")

        emqx_mount_targets = {
            mount["target"] for mount in services["emqx"]["volumes"]
        }
        self.assertEqual(
            emqx_mount_targets,
            {
                "/opt/emqx/data",
                "/opt/emqx/log",
                "/opt/emqx/certs",
                "/opt/emqx/etc/acl.conf",
                "/opt/emqx/docker-entrypoint-wrapper.sh",
            },
        )

    def test_map_locations_override_is_optional_so_the_landing_uses_the_api(self):
        landing_env = self.project / "landing" / ".env"
        landing_env.write_text(
            DUMMY_ENV["landing"].replace("PUBLIC_MAP_LOCATIONS_URL=/map-locations.json\n", ""),
            encoding="utf-8",
        )
        landing_args = self.render_config()["services"]["landing"]["build"]["args"]
        self.assertEqual(landing_args["PUBLIC_MAP_LOCATIONS_URL"], "")

    def test_shared_values_derive_every_service_url(self):
        services = self.render_config()["services"]
        frontend_args = services["frontend"]["build"]["args"]
        self.assertEqual(frontend_args["VITE_GCP_API_KEY"], "dummy-map-key")
        landing_args = services["landing"]["build"]["args"]
        self.assertEqual(landing_args["PUBLIC_GCP_MAPS_API_KEY"], "dummy-map-key")

        for name in ("backend", "mqtt-runtime"):
            environment = services[name]["environment"]
            self.assertEqual(environment["BACKEND_PORT"], "18001", name)
            self.assertEqual(environment["BACKEND_HOST_URL"], "http://localhost", name)
            self.assertEqual(environment["VITE_FRONTEND_URL"], "http://localhost", name)
            self.assertEqual(environment["VITE_FRONTEND_PORT"], "15174", name)
            self.assertEqual(environment["LANDING_URL"], "http://localhost:14322", name)
            self.assertEqual(environment["LAN_BIND_IP"], "", name)
            self.assertEqual(environment["EMQX_API_KEY"], "", name)

    def test_a_shared_port_is_written_once(self):
        self.write_env("", ROOT_ENV.replace("BACKEND_PORT=18001", "BACKEND_PORT=19000")
                       .replace("PUBLIC_HOST=localhost", "PUBLIC_HOST=iot.example.test")
                       .replace("PUBLIC_SCHEME=http", "PUBLIC_SCHEME=https"))
        services = self.render_config()["services"]
        self.assertEqual(str(self.published_port(services["backend"], 8000)["published"]), "19000")
        self.assertEqual(
            services["frontend"]["build"]["args"]["VITE_API_URL"], "https://iot.example.test:19000/api"
        )
        self.assertEqual(
            services["landing"]["build"]["args"]["PUBLIC_API_BASE_URL"], "https://iot.example.test:19000/api"
        )
        backend = services["backend"]["environment"]
        self.assertEqual(backend["BACKEND_PORT"], "19000")
        self.assertEqual(backend["BACKEND_HOST_URL"], "https://iot.example.test")
        self.assertEqual(backend["LANDING_URL"], "https://iot.example.test:14322")

    def test_service_env_files_override_the_derived_values(self):
        self.write_env("frontend", DUMMY_ENV["frontend"] + "VITE_API_URL=https://api.example.test/api\n"
                       "VITE_FRONTEND_PORT=25174\nVITE_GCP_API_KEY=frontend-key\n")
        self.write_env("landing", DUMMY_ENV["landing"] + "PUBLIC_API_BASE_URL=https://api.example.test/api\n")
        self.write_env("backend", DUMMY_ENV["backend"] + "BACKEND_HOST_URL=https://api.example.test\n"
                       "LANDING_URL=https://www.example.test\n")
        services = self.render_config()["services"]
        frontend = services["frontend"]
        self.assertEqual(frontend["build"]["args"]["VITE_API_URL"], "https://api.example.test/api")
        self.assertEqual(frontend["build"]["args"]["VITE_GCP_API_KEY"], "frontend-key")
        self.assertEqual(str(self.published_port(frontend, 80)["published"]), "25174")
        self.assertEqual(
            services["landing"]["build"]["args"]["PUBLIC_API_BASE_URL"], "https://api.example.test/api"
        )
        backend = services["backend"]["environment"]
        self.assertEqual(backend["BACKEND_HOST_URL"], "https://api.example.test")
        self.assertEqual(backend["LANDING_URL"], "https://www.example.test")

    def test_lan_ip_and_emqx_api_key_come_from_the_root_env(self):
        self.write_env("", ROOT_ENV.replace("LAN_BIND_IP=", "LAN_BIND_IP=192.168.1.50")
                       + "EMQX_API_KEY=dummy-key\nEMQX_API_SECRET=dummy-secret\n")
        services = self.render_config()["services"]
        self.assertEqual(str(self.published_port(services["backend"], 8000, "192.168.1.50")["published"]), "18001")
        self.assertEqual(str(self.published_port(services["emqx"], 8883, "192.168.1.50")["published"]), "18884")
        for name in ("backend", "mqtt-runtime", "emqx"):
            environment = services[name]["environment"]
            self.assertEqual(environment["EMQX_API_KEY"], "dummy-key", name)
            self.assertEqual(environment["EMQX_API_SECRET"], "dummy-secret", name)
        self.assertEqual(services["backend"]["environment"]["LAN_BIND_IP"], "192.168.1.50")

    def test_missing_shared_port_fails_without_reading_real_env(self):
        self.write_env("", ROOT_ENV.replace("BACKEND_PORT=18001\n", ""))
        result = subprocess.run(
            [
                "docker",
                "compose",
                "-p",
                "compose-contract-test",
                "-f",
                str(self.project / "docker-compose.yml"),
                "config",
                "--quiet",
            ],
            cwd=self.project,
            env={
                "PATH": os.environ.get("PATH", ""),
                "HOME": os.environ.get("HOME", ""),
            },
            text=True,
            capture_output=True,
            timeout=30,
            check=False,
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("BACKEND_PORT", result.stderr)


if __name__ == "__main__":
    unittest.main()
