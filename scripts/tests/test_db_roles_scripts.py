"""Database role scripts: timescaledb/init/01-create-app-role.sh and scripts/separar-roles-db.sh.

Both run against stub ``psql``/``docker`` executables (no database, no Docker): they check the
validations, that secrets never reach the command line or the output, and that --dry-run changes
nothing. The real behaviour is exercised end to end in disposable containers (see
docs/roles-base-de-datos.md).

Run: python3 -m unittest discover -s scripts/tests -p 'test_db_roles_scripts.py' -v
"""

import os
import shutil
import stat
import subprocess
import tempfile
import textwrap
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
INIT_SCRIPT = REPO / "timescaledb/init/01-create-app-role.sh"
TRANSITION_SCRIPT = REPO / "scripts/separar-roles-db.sh"
APP_SECRET = "app'secret-0123"
ADMIN_SECRET = "admin-secret-4567"


def write_executable(path: Path, body: str) -> None:
    path.write_text(textwrap.dedent(body), encoding="utf-8")
    path.chmod(path.stat().st_mode | stat.S_IXUSR)


class SyntaxTests(unittest.TestCase):
    def test_scripts_parse(self):
        for script in (INIT_SCRIPT, TRANSITION_SCRIPT, REPO / "scripts/levantar.sh"):
            result = subprocess.run(["bash", "-n", str(script)], capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, f"{script}: {result.stderr}")


class InitScriptTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.bin = Path(self.tmp.name)
        # Records argv, the SQL on stdin and the environment psql would see.
        write_executable(self.bin / "psql", f"""\
            #!/bin/bash
            printf '%s\\n' "$@" > {self.bin}/argv
            cat > {self.bin}/stdin
            printf '%s|%s' "$CEIOT_APP_USER" "$CEIOT_APP_PASSWORD" > {self.bin}/env
            """)

    def tearDown(self):
        self.tmp.cleanup()

    def run_init(self, **overrides):
        env = {"PATH": f"{self.bin}:{os.environ['PATH']}", "POSTGRES_USER": "iot_app_admin",
               "POSTGRES_DB": "iot_db", "DB_USER": "iot_app", "DB_PASSWORD": APP_SECRET}
        env.update(overrides)
        env = {key: value for key, value in env.items() if value is not None}
        return subprocess.run(["bash", str(INIT_SCRIPT)], env=env, capture_output=True, text=True)

    def test_creates_an_unprivileged_login_without_exposing_the_password(self):
        result = self.run_init()
        self.assertEqual(result.returncode, 0, result.stderr)
        sql = (self.bin / "stdin").read_text()
        for attribute in ("LOGIN", "NOSUPERUSER", "NOBYPASSRLS", "NOCREATEDB", "NOCREATEROLE"):
            self.assertIn(attribute, sql)
        self.assertIn("GRANT CONNECT ON DATABASE", sql)
        self.assertIn("\\getenv app_password CEIOT_APP_PASSWORD", sql)
        self.assertNotIn(APP_SECRET, sql)
        self.assertNotIn(APP_SECRET, (self.bin / "argv").read_text())
        self.assertNotIn(APP_SECRET, result.stdout + result.stderr)
        self.assertEqual((self.bin / "env").read_text(), f"iot_app|{APP_SECRET}")

    def test_refuses_missing_invalid_or_shared_credentials(self):
        for overrides in ({"DB_PASSWORD": None}, {"DB_USER": None}, {"DB_USER": "Iot-App"},
                          {"DB_USER": "iot_app_admin"}):
            with self.subTest(overrides=overrides):
                result = self.run_init(**overrides)
                self.assertEqual(result.returncode, 1)
                self.assertFalse((self.bin / "stdin").exists())


class TransitionScriptTests(unittest.TestCase):
    """scripts/separar-roles-db.sh in a throwaway repository layout with a stub docker."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        (self.root / "scripts").mkdir()
        (self.root / "timescaledb").mkdir()
        (self.root / "bin").mkdir()
        shutil.copy2(TRANSITION_SCRIPT, self.root / "scripts/separar-roles-db.sh")
        self.log = self.root / "docker.log"
        # `compose ps` returns a container id; `exec ... psql` answers the probe and the state query
        # (STUB_STATE) and logs every SQL statement it receives.
        write_executable(self.root / "bin/docker", f"""\
            #!/bin/bash
            echo "docker $*" >> {self.log}
            if [ "$1" = compose ] && [ "$2" = ps ]; then echo cid; exit 0; fi
            if [ "$1" = exec ]; then
              sql="$(cat)"; printf '%s\\n---\\n' "$sql" >> {self.log}
              case "$sql" in
                "SELECT 1") echo 1 ;;
                *concat_ws*) echo "$STUB_STATE" ;;
              esac
              exit 0
            fi
            exit 0
            """)

    def tearDown(self):
        self.tmp.cleanup()

    def write_env(self, **values):
        base = {"DB_PORT": "5432", "DB_DATABASE": "iot_db", "DB_USER": "iot_app", "DB_PASSWORD": APP_SECRET,
                "ALEMBIC_DB_USER": "iot_app_admin", "ALEMBIC_DB_PASSWORD": ADMIN_SECRET}
        base.update(values)
        lines = [f"{key}={value}" for key, value in base.items() if value is not None]
        (self.root / "timescaledb/.env").write_text("\n".join(lines) + "\n", encoding="utf-8")

    def run_script(self, *args, state="iot_app|privileged|missing|1"):
        env = {"PATH": f"{self.root / 'bin'}:{os.environ['PATH']}", "HOME": os.environ.get("HOME", ""),
               "STUB_STATE": state}
        return subprocess.run([str(self.root / "scripts/separar-roles-db.sh"), *args], cwd=self.root, env=env,
                              capture_output=True, text=True, timeout=60)

    def assert_no_secret(self, result):
        output = result.stdout + result.stderr
        self.assertNotIn(APP_SECRET, output)
        self.assertNotIn(ADMIN_SECRET, output)

    def test_requires_both_roles_in_the_env_file(self):
        self.write_env(ALEMBIC_DB_USER=None, ALEMBIC_DB_PASSWORD=None)
        result = self.run_script("--dry-run")
        self.assertEqual(result.returncode, 2)
        self.assertIn("ALEMBIC_DB_USER ALEMBIC_DB_PASSWORD", result.stderr)
        self.assert_no_secret(result)

    def test_refuses_the_same_user_or_password_for_both_roles(self):
        for values in ({"ALEMBIC_DB_USER": "iot_app"}, {"ALEMBIC_DB_PASSWORD": APP_SECRET},
                       {"DB_USER": "Iot-App"}):
            with self.subTest(values=values):
                self.write_env(**values)
                result = self.run_script("--dry-run")
                self.assertEqual(result.returncode, 2)
                self.assert_no_secret(result)

    def test_dry_run_on_a_legacy_install_plans_the_rename_and_changes_nothing(self):
        self.write_env()
        result = self.run_script("--dry-run")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("Estado: sin separar", result.stdout)
        self.assertIn("renombrar iot_app a iot_app_admin", result.stdout)
        self.assertIn("ejecutar scripts/backup.sh", result.stdout)
        self.assert_no_secret(result)
        log = self.log.read_text()
        for statement in ("ALTER ROLE", "CREATE ROLE", "DROP ROLE", "GRANT", "compose stop", "compose build"):
            self.assertNotIn(statement, log)

    def test_dry_run_on_a_separated_install_only_reconciles(self):
        self.write_env()
        result = self.run_script("--dry-run", "--sin-backup", state="iot_app_admin|plain|super|1")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("Estado: ya separado", result.stdout)
        self.assertIn("reasegurar atributos", result.stdout)
        self.assertIn("sin backup previo", result.stdout)

    def test_unknown_state_changes_nothing(self):
        self.write_env()
        # The application role is a superuser but not the bootstrap one: not a layout this script converts.
        result = self.run_script(state="iot_app_admin|privileged|super|1")
        self.assertEqual(result.returncode, 1)
        self.assertIn("estado no reconocido", result.stderr)
        self.assertNotIn("ALTER ROLE", self.log.read_text())


if __name__ == "__main__":
    unittest.main()
