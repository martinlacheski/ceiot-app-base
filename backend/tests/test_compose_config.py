import json
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
COMPONENTS = ("backend", "frontend", "landing", "mailpit", "mqtt", "timescaledb")

DUMMY_ENV = {
    "backend": """\
BACKEND_PORT=18001
BACKEND_HOST_URL=http://localhost
ENVIRONMENT=DEV
EMQX_HOST=emqx
EMQX_PORT=1883
VITE_FRONTEND_URL=http://localhost
VITE_FRONTEND_PORT=15174
BACKEND_CORS_ORIGINS=[\"http://localhost:15174\",\"http://localhost:14322\"]
BACKEND_TRUSTED_HOSTS=[\"localhost\"]
MAIL_TRANSPORT=mailpit
SAFE_BACKEND_SENTINEL=backend-fixture
""",
    "frontend": """\
VITE_FRONTEND_PORT=15174
VITE_API_URL=http://localhost:18001/api
VITE_APP_LOGIN_URL=http://localhost:15174
VITE_LANDING_URL=http://localhost:14322
VITE_GCP_API_KEY=dummy-map-key
VITE_TOKEN_REFRESH=15
VITE_SESSION_TIMEOUT=30
""",
    "landing": """\
LANDING_PORT=14322
PUBLIC_APP_LOGIN_URL=http://localhost:15174
PUBLIC_API_BASE_URL=http://localhost:18001/api
PUBLIC_GCP_MAPS_API_KEY=dummy-map-key
PUBLIC_MAP_LOCATIONS_URL=/map-locations.json
""",
    "mailpit": "",
    "mqtt": """\
MQTT_LISTENER_TCP=11884
MQTT_LISTENER_TLS=18884
MQTT_LISTENER_WS=18084
EMQX_PASSWORD=dummy-dashboard-password
""",
    "timescaledb": """\
DB_PORT=15433
DB_USER=dummy_user
DB_PASSWORD=dummy_password
DB_DATABASE=dummy_database
DATABASE_URL=postgresql+psycopg://wrong:wrong@postgresql:15433/wrong
ALEMBIC_DATABASE_URL=postgresql+psycopg://wrong:wrong@wrong-host:9999/wrong
""",
}


class ComposeConfigTest(unittest.TestCase):
    maxDiff = None

    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.project = Path(self.temp_dir.name)

        shutil.copy2(REPO_ROOT / "docker-compose.yml", self.project / "docker-compose.yml")
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

    @staticmethod
    def published_port(service, target):
        matches = [port for port in service["ports"] if port["target"] == target]
        if len(matches) != 1:
            raise AssertionError(f"expected one publication for container port {target}")
        return matches[0]

    def test_root_include_renders_five_services_on_one_private_network(self):
        config = self.render_config()
        self.assertEqual(
            set(config["services"]),
            {"backend", "frontend", "landing", "emqx", "postgresql"},
        )
        self.assertEqual(set(config["networks"]), {"app-network"})
        self.assertNotIn("external", config["networks"]["app-network"])

        for service in config["services"].values():
            self.assertEqual(set(service["networks"]), {"app-network"})
            self.assertIn("healthcheck", service)
            self.assertNotIn("container_name", service)
            self.assertNotIn("labels", service)

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

        mqtt_ports = {1883: "11884", 8883: "18884", 8083: "18084"}
        for target, published in mqtt_ports.items():
            port = self.published_port(services["emqx"], target)
            self.assertEqual(port["host_ip"], "127.0.0.1")
            self.assertEqual(str(port["published"]), published)
        self.assertEqual(len(services["emqx"]["ports"]), 3)

    def test_database_urls_always_target_internal_dns_and_backend_waits_for_health(self):
        config = self.render_config()
        backend = config["services"]["backend"]
        postgresql = config["services"]["postgresql"]

        expected_url = (
            "postgresql+psycopg://dummy_user:dummy_password"
            "@postgresql:5432/dummy_database"
        )
        self.assertEqual(backend["environment"]["DATABASE_URL"], expected_url)
        self.assertEqual(backend["environment"]["ALEMBIC_DATABASE_URL"], expected_url)
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
        self.assertEqual(frontend_args["VITE_APP_LOGIN_URL"], "http://localhost:15174")
        self.assertEqual(frontend_args["VITE_LANDING_URL"], "http://localhost:14322")
        self.assertFalse(any(key.startswith("VITE_MP_") for key in frontend_args))

        landing_args = services["landing"]["build"]["args"]
        self.assertEqual(landing_args["PUBLIC_API_BASE_URL"], "http://localhost:18001/api")
        self.assertEqual(landing_args["PUBLIC_APP_LOGIN_URL"], "http://localhost:15174")

        emqx_mount_targets = {
            mount["target"] for mount in services["emqx"]["volumes"]
        }
        self.assertEqual(
            emqx_mount_targets,
            {"/opt/emqx/data", "/opt/emqx/log", "/opt/emqx/certs"},
        )

    def test_missing_required_build_url_fails_without_reading_real_env(self):
        frontend_env = self.project / "frontend" / ".env"
        frontend_env.write_text(
            DUMMY_ENV["frontend"].replace(
                "VITE_API_URL=http://localhost:18001/api\n", ""
            ),
            encoding="utf-8",
        )
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
        self.assertIn("VITE_API_URL", result.stderr)


if __name__ == "__main__":
    unittest.main()
