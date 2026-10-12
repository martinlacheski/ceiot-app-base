"""Tests for the scheduled backup: retention, the cron wrapper and the installer.

No Docker and no real crontab: the installer runs against a stub crontab
(CRONTAB_CMD), the wrapper against stub backup and notifier scripts
(BACKUP_SCRIPT, BACKUP_NOTIFY_CMD) and retention against a temporary tree
(scripts/backup.sh --solo-retencion --destino <tmp>).

Run: python3 -m unittest discover -s scripts/tests
"""

import fcntl
import importlib.util
import json
import os
import stat
import subprocess
import tempfile
import time
import unittest
from argparse import Namespace
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
BACKUP = REPO / "scripts/backup.sh"
WRAPPER = REPO / "scripts/backup-cron.sh"
INSTALLER = REPO / "scripts/instalar-backup-cron.sh"
NOTIFIER = REPO / "scripts/notificar-backup.py"
MARKER = "# ceiot-app-base backup"

STUB_CRONTAB = """#!/bin/sh
if [ "$1" = "-l" ]; then
  [ -n "$CRONTAB_FAIL" ] && { echo "crontab: permission denied" >&2; exit 1; }
  [ -f "$CRONTAB_FILE" ] || { echo "no crontab for tester" >&2; exit 1; }
  cat "$CRONTAB_FILE"; exit 0
fi
if [ "$1" = "-" ]; then cat >"$CRONTAB_FILE"; echo write >>"$CRONTAB_FILE.writes"; exit 0; fi
exit 9
"""


def write_exec(path: Path, content: str) -> Path:
    path.write_text(content)
    path.chmod(path.stat().st_mode | stat.S_IXUSR)
    return path


def run(cmd, env=None, **kwargs) -> subprocess.CompletedProcess:
    full_env = dict(os.environ)
    full_env.update(env or {})
    return subprocess.run([str(c) for c in cmd], cwd=REPO, env=full_env, capture_output=True,
                          text=True, check=False, timeout=60, **kwargs)


class InstallerTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="ceiot-cron-test-")
        root = Path(self.tmp.name)
        self.file = root / "crontab.txt"
        self.env = {
            "CRONTAB_CMD": str(write_exec(root / "crontab", STUB_CRONTAB)),
            "CRONTAB_FILE": str(self.file),
            "BACKUP_DEST": str(root / "backups"),
        }

    def tearDown(self):
        self.tmp.cleanup()

    def installer(self, *args, **env):
        merged = dict(self.env, **env)
        full_env = {k: v for k, v in os.environ.items()
                    if k not in ("COMPOSE_PROJECT_NAME", "BACKUP_NOTIFY_EMAIL")}
        full_env.update(merged)
        return subprocess.run([str(INSTALLER), *args], cwd=REPO, env=full_env, capture_output=True,
                              text=True, check=False, timeout=60)

    def ours(self) -> list[str]:
        return [line for line in self.file.read_text().splitlines() if MARKER in line]

    def test_install_writes_one_tagged_line_with_absolute_path(self):
        proc = self.installer("instalar", "--hora", "02:30", "--conservar", "5")
        self.assertEqual(proc.returncode, 0, proc.stderr)
        expected = f"30 2 * * * '{REPO}/scripts/backup-cron.sh' --conservar 5 {MARKER}"
        self.assertEqual(self.ours(), [expected])
        self.assertIn(expected, proc.stdout)
        self.assertNotIn("MAIL_TRANSPORT", self.file.read_text())

    def test_default_is_daily_at_three_keeping_seven(self):
        self.assertEqual(self.installer("instalar").returncode, 0)
        self.assertTrue(self.ours()[0].startswith("0 3 * * * "))
        self.assertIn("--conservar 7 ", self.ours()[0])

    def test_reinstall_replaces_the_line_and_keeps_other_entries(self):
        self.file.write_text('MAILTO=""\n15 * * * * echo otro\n')
        self.installer("instalar", "--hora", "01:00")
        self.installer("instalar", "--hora", "04:45", "--conservar", "3")
        lines = self.file.read_text().splitlines()
        self.assertEqual(lines[:2], ['MAILTO=""', "15 * * * * echo otro"])
        self.assertEqual(len(self.ours()), 1)
        self.assertTrue(self.ours()[0].startswith("45 4 * * * "))

    def test_same_configuration_is_not_rewritten(self):
        self.installer("instalar")
        proc = self.installer("instalar")
        self.assertIn("ya estaba instalado", proc.stdout)
        writes = Path(str(self.file) + ".writes").read_text().splitlines()
        self.assertEqual(len(writes), 1)

    def test_compose_project_name_is_kept(self):
        self.installer("instalar", COMPOSE_PROJECT_NAME="otro-proyecto")
        self.assertIn("COMPOSE_PROJECT_NAME=otro-proyecto '", self.ours()[0])

    def test_notify_email_is_kept_and_validated(self):
        self.installer("instalar", BACKUP_NOTIFY_EMAIL="ops@example.com")
        self.assertIn("BACKUP_NOTIFY_EMAIL=ops@example.com '", self.ours()[0])
        proc = self.installer("instalar", BACKUP_NOTIFY_EMAIL="x; rm -rf /")
        self.assertEqual(proc.returncode, 2)
        self.assertIn("BACKUP_NOTIFY_EMAIL=ops@example.com '", self.ours()[0])

    def test_remove_only_drops_our_line(self):
        self.file.write_text("15 * * * * echo otro\n")
        self.installer("instalar")
        proc = self.installer("quitar")
        self.assertEqual(proc.returncode, 0)
        self.assertEqual(self.file.read_text(), "15 * * * * echo otro\n")
        self.assertIn("No había", self.installer("quitar").stdout)

    def test_invalid_options_write_nothing(self):
        for args in (["--hora", "24:00"], ["--hora", "3"], ["--conservar", "-1"], ["--otra"]):
            proc = self.installer("instalar", *args)
            self.assertEqual(proc.returncode, 2, args)
        self.assertFalse(self.file.exists())

    def test_unreadable_crontab_is_never_replaced(self):
        self.file.write_text("15 * * * * echo otro\n")
        proc = self.installer("instalar", CRONTAB_FAIL="1")
        self.assertNotEqual(proc.returncode, 0)
        self.assertEqual(self.file.read_text(), "15 * * * * echo otro\n")

    def test_status_shows_line_and_last_result(self):
        self.installer("instalar")
        dest = Path(self.env["BACKUP_DEST"])
        dest.mkdir()
        (dest / "ultimo-resultado.json").write_text(json.dumps({"status": "failed", "summary": "algo"}))
        out = self.installer("estado").stdout
        self.assertIn(MARKER, out)
        self.assertIn('"status": "failed"', out)


class RetentionTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="ceiot-retention-test-")
        self.root = Path(self.tmp.name) / "backups"
        self.root.mkdir()

    def tearDown(self):
        self.tmp.cleanup()

    def backup(self, name: str, ok: bool | None) -> None:
        path = self.root / name
        path.mkdir()
        if ok is not None:
            (path / "verificacion.json").write_text(json.dumps({"ok": ok}))

    def retention(self, keep: str) -> subprocess.CompletedProcess:
        return run([BACKUP, "--solo-retencion", "--destino", self.root, "--conservar", keep])

    def names(self) -> set[str]:
        return {p.name for p in self.root.iterdir()}

    def test_keeps_newest_verified_and_newest_unverified(self):
        for day in range(1, 6):
            self.backup(f"2026100{day}T030000Z", True)
        self.backup("20261001T120000Z", False)        # failed verification
        self.backup("20261003T120000Z", None)         # never verified
        self.backup("20261004T120000Z.incompleto", None)  # interrupted
        (self.root / "logs").mkdir()
        (self.root / "mi-copia").mkdir()
        (self.root / "ultimo-resultado.json").write_text("{}")
        proc = self.retention("2")
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertEqual(self.names(), {
            "20261005T030000Z", "20261004T030000Z",   # 2 newest verified
            "20261004T120000Z.incompleto",            # newest unverified
            "logs", "mi-copia", "ultimo-resultado.json", ".lock",
        })
        self.assertIn("5 borrado(s)", proc.stdout)

    def test_zero_disables_retention(self):
        for day in range(1, 4):
            self.backup(f"2026100{day}T030000Z", True)
        self.backup("20261001T120000Z", False)
        self.retention("0")
        self.assertEqual(len([n for n in self.names() if n.startswith("2026")]), 4)

    def test_unverified_are_kept_without_any_verified_backup(self):
        self.backup("20261001T030000Z", False)
        self.backup("20261002T030000Z", False)
        self.retention("1")
        self.assertEqual({n for n in self.names() if n.startswith("2026")},
                         {"20261001T030000Z", "20261002T030000Z"})

    def test_invalid_keep_is_rejected(self):
        self.assertEqual(self.retention("x").returncode, 2)

    def test_locked_destination_exits_75_and_deletes_nothing(self):
        for day in range(1, 4):
            self.backup(f"2026100{day}T030000Z", True)
        with open(self.root / ".lock", "w") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            proc = self.retention("1")
        self.assertEqual(proc.returncode, 75)
        self.assertIn("en curso", proc.stderr)
        self.assertEqual(len([n for n in self.names() if n.startswith("2026")]), 3)


STUB_OK = """#!/bin/sh
echo "args: $*" >"$STUB_ARGS"
dest="$2"; dir="$dest/20261012T030000Z"
mkdir -p "$dir"
printf '{"ok": true, "resumen": "OK: Backup verificado: todo bien\\\\n  Aviso: algo"}' >"$dir/verificacion.json"
echo "Destino: $dir"
echo "Backup verificado"
"""

STUB_FAIL = """#!/bin/sh
echo "args: $*" >"$STUB_ARGS"
echo "Destino: $2/20261012T030000Z"
echo "Error: el servicio postgresql no está corriendo." >&2
exit 1
"""

STUB_LOCKED = """#!/bin/sh
echo "Otro backup está en curso" >&2
exit 75
"""

STUB_NOTIFIER = """#!/bin/sh
printf '%s\\n' "$@" >"$NOTIFY_ARGS"
echo "Notificación enviada a admin@example.com (MAIL_TRANSPORT=mailpit)."
exit "${NOTIFY_EXIT:-0}"
"""


class WrapperTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="ceiot-wrapper-test-")
        root = Path(self.tmp.name)
        self.root = root
        self.dest = root / "backups"
        self.notify_args = root / "notify-args"
        self.env = {
            "BACKUP_DEST": str(self.dest),
            "BACKUP_NOTIFY_CMD": str(write_exec(root / "notifier", STUB_NOTIFIER)),
            "NOTIFY_ARGS": str(self.notify_args),
            "STUB_ARGS": str(root / "stub-args"),
        }

    def tearDown(self):
        self.tmp.cleanup()

    def wrapper(self, stub: str, *args, **env) -> subprocess.CompletedProcess:
        script = write_exec(self.root / "backup-stub", stub)
        return run([WRAPPER, *args], env=dict(self.env, BACKUP_SCRIPT=str(script), **env))

    def status(self) -> dict:
        return json.loads((self.dest / "ultimo-resultado.json").read_text())

    def test_success_records_status_without_notification(self):
        proc = self.wrapper(STUB_OK, "--conservar", "3")
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertEqual(proc.stdout, "")  # cron would mail any output
        status = self.status()
        self.assertEqual(status["status"], "ok")
        self.assertTrue(status["ok"])
        self.assertEqual(status["backup_dir"], str(self.dest / "20261012T030000Z"))
        self.assertEqual(status["summary"], "OK: Backup verificado: todo bien")
        self.assertEqual(status["notification"], "not needed")
        self.assertFalse(self.notify_args.exists())
        self.assertIn(f"--destino {self.dest} --conservar 3",
                      Path(self.env["STUB_ARGS"]).read_text())
        log = Path(status["log"])
        self.assertTrue(log.is_file())
        self.assertIn("Backup verificado", log.read_text())

    def test_failure_records_status_and_notifies(self):
        proc = self.wrapper(STUB_FAIL)
        self.assertEqual(proc.returncode, 1)
        status = self.status()
        self.assertEqual(status["status"], "failed")
        self.assertFalse(status["ok"])
        self.assertEqual(status["exit_code"], 1)
        self.assertIsNone(status["backup_dir"])  # never renamed into place
        self.assertEqual(status["summary"], "Error: el servicio postgresql no está corriendo.")
        self.assertTrue(status["notification"].startswith("sent: Notificación enviada"))
        args = self.notify_args.read_text().splitlines()
        self.assertEqual(args[args.index("--estado") + 1], "failed")
        self.assertEqual(args[args.index("--codigo") + 1], "1")
        self.assertEqual(args[args.index("--log") + 1], status["log"])
        self.assertIn("Notificación enviada", Path(status["log"]).read_text())

    def test_notification_failure_is_recorded(self):
        proc = self.wrapper(STUB_FAIL, NOTIFY_EXIT="3")
        self.assertEqual(proc.returncode, 1)
        self.assertTrue(self.status()["notification"].startswith("not sent (código 3)"))

    def test_locked_run_is_skipped_and_notified(self):
        proc = self.wrapper(STUB_LOCKED)
        self.assertEqual(proc.returncode, 75)
        self.assertEqual(self.status()["status"], "skipped")
        self.assertTrue(self.notify_args.exists())

    def test_old_logs_are_pruned(self):
        logs = self.dest / "logs"
        logs.mkdir(parents=True)
        old, recent, other = logs / "backup-20260101T030000Z.log", logs / "backup-20261001T030000Z.log", logs / "nota.txt"
        for path in (old, recent, other):
            path.write_text("x")
        forty_days_ago = time.time() - 40 * 86400
        os.utime(old, (forty_days_ago, forty_days_ago))
        os.utime(other, (forty_days_ago, forty_days_ago))
        self.wrapper(STUB_OK)
        self.assertFalse(old.exists())
        self.assertTrue(recent.exists())
        self.assertTrue(other.exists())


def load_notifier():
    spec = importlib.util.spec_from_file_location("notificar_backup", NOTIFIER)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class NotifierTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="ceiot-notifier-test-")
        self.root = Path(self.tmp.name)
        self.mod = load_notifier()

    def tearDown(self):
        self.tmp.cleanup()

    def test_message_has_summary_and_log_tail(self):
        log = self.root / "backup.log"
        log.write_text("\n".join(f"línea {i}" for i in range(100)))
        args = Namespace(estado="failed", codigo="1", resumen="Error: algo", backup="", log=str(log))
        subject, body = self.mod.build_message(args, "servidor")
        self.assertEqual(subject, "Backup programado: falló en servidor")
        self.assertIn("Resumen: Error: algo", body)
        self.assertIn("(no se generó)", body)
        self.assertIn("línea 99", body)
        self.assertNotIn("línea 59\n", body)  # only the last 40 lines

    def test_payload_is_embedded_as_a_literal(self):
        script = self.mod.container_script({"recipient": "", "subject": "a'\"b", "body": "x\n'''y"})
        namespace = {}
        literal = script.split("payload = json.loads(", 1)[1].split(")\n", 1)[0]
        exec("value = " + literal, namespace)
        self.assertEqual(json.loads(namespace["value"])["body"], "x\n'''y")

    def test_backend_down_is_reported(self):
        bin_dir = self.root / "bin"
        bin_dir.mkdir()
        write_exec(bin_dir / "docker", "#!/bin/sh\nexit 0\n")  # compose ps: nothing running
        proc = run(["python3", NOTIFIER, "--estado", "failed", "--log", self.root / "none.log"],
                   env={"PATH": f"{bin_dir}:{os.environ['PATH']}"})
        self.assertEqual(proc.returncode, 3)
        self.assertIn("backend no está corriendo", proc.stdout)


if __name__ == "__main__":
    unittest.main()
