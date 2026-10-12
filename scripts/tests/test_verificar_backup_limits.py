"""scripts/verificar-backup.sh: resource limits of the disposable verification container.

Runs the script against a stub ``docker`` (no Docker, no database) that records the arguments of
``docker run`` and then fails to start, so the script takes its setup-error path and exits 1. The
tests only look at the recorded ``docker run`` call. The real restore is covered by
test_backup_integration.py.

Run: python3 -m unittest discover -s scripts/tests -p 'test_verificar_backup_limits.py' -v
"""

import json
import os
import shlex
import stat
import subprocess
import tempfile
import textwrap
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
SCRIPT = REPO / "scripts/verificar-backup.sh"

STUB_DOCKER = """\
#!/usr/bin/env bash
# Records every call; "docker run" fails so the script stops before restoring.
printf '%s\\n' "$*" >> "$STUB_LOG"
case "$1" in
  run) exit 1 ;;
  compose) exit 1 ;;
  *) exit 0 ;;
esac
"""


class VerifyContainerLimitsTests(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.bin = self.tmp / "bin"
        self.bin.mkdir()
        docker = self.bin / "docker"
        docker.write_text(textwrap.dedent(STUB_DOCKER), encoding="utf-8")
        docker.chmod(docker.stat().st_mode | stat.S_IXUSR)
        self.log = self.tmp / "docker.log"
        self.backup = self.tmp / "20261012T000000Z"
        self.backup.mkdir()
        manifest = {"source": {"user": "iot_app_admin", "image": "timescale/timescaledb:2.30.1-pg16"}}
        (self.backup / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")

    def tearDown(self):
        subprocess.run(["rm", "-rf", str(self.tmp)], check=False)

    def run_script(self, **extra_env):
        env = {"PATH": f"{self.bin}:{os.environ['PATH']}", "HOME": os.environ.get("HOME", ""),
               "STUB_LOG": str(self.log), **extra_env}
        return subprocess.run([str(SCRIPT), str(self.backup)], env=env, capture_output=True, text=True,
                              timeout=60)

    def docker_run_args(self):
        calls = self.log.read_text(encoding="utf-8").splitlines() if self.log.exists() else []
        runs = [shlex.split(line) for line in calls if line.startswith("run ")]
        self.assertEqual(len(runs), 1, calls)
        return runs[0]

    def option(self, args, name):
        self.assertIn(name, args)
        return args[args.index(name) + 1]

    def test_default_limits_are_one_gigabyte_and_one_cpu(self):
        self.run_script()
        args = self.docker_run_args()
        self.assertEqual(self.option(args, "--memory"), "1g")
        self.assertEqual(self.option(args, "--cpus"), "1")
        self.assertEqual(self.option(args, "--network"), "none")

    def test_limits_come_from_the_environment(self):
        self.run_script(BACKUP_VERIFY_MEMORY="512m", BACKUP_VERIFY_CPUS="0.5")
        args = self.docker_run_args()
        self.assertEqual(self.option(args, "--memory"), "512m")
        self.assertEqual(self.option(args, "--cpus"), "0.5")

    def test_invalid_limits_are_rejected_before_starting_a_container(self):
        for env in ({"BACKUP_VERIFY_MEMORY": "mucha"}, {"BACKUP_VERIFY_CPUS": "0"},
                    {"BACKUP_VERIFY_CPUS": "-1"}, {"BACKUP_VERIFY_MEMORY": "1g; rm -rf /"}):
            with self.subTest(env=env):
                self.log.unlink(missing_ok=True)
                result = self.run_script(**env)
                self.assertEqual(result.returncode, 2, result.stderr)
                self.assertIn("BACKUP_VERIFY_", result.stderr)
                calls = self.log.read_text(encoding="utf-8") if self.log.exists() else ""
                self.assertNotIn("run ", calls)


if __name__ == "__main__":
    unittest.main()
