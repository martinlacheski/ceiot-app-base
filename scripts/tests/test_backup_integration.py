"""End-to-end test of scripts/backup.sh and scripts/verificar-backup.sh.

Runs against the LIVE development stack (it only reads the real database:
pg_dump and the manifest queries) and restores into disposable containers.
Skipped unless CEIOT_BACKUP_INTEGRATION=1, because it needs Docker and the
stack running (scripts/levantar.sh).

Run: CEIOT_BACKUP_INTEGRATION=1 python3 -m unittest discover -s scripts/tests -p 'test_backup_integration.py' -v
"""

import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "scripts"))

import backup_manifest as bm  # noqa: E402

ENABLED = os.environ.get("CEIOT_BACKUP_INTEGRATION") == "1"


def run(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run(list(args), cwd=REPO, capture_output=True, text=True, check=False)


def verify_containers() -> list[str]:
    proc = run("docker", "ps", "-a", "--filter", "name=ceiot-backup-verify-", "--format", "{{.Names}}")
    return [line for line in proc.stdout.splitlines() if line.strip()]


@unittest.skipUnless(ENABLED, "set CEIOT_BACKUP_INTEGRATION=1 with the stack running")
class BackupIntegrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory(prefix="ceiot-backup-test-")
        cls.root = Path(cls.tmp.name)
        cls.before = verify_containers()
        cls.result = run(str(REPO / "scripts/backup.sh"), "--destino", str(cls.root / "backups"))
        backups = sorted(p for p in (cls.root / "backups").iterdir() if p.is_dir())
        cls.backup = backups[-1] if backups else None

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def copy(self, name: str) -> Path:
        target = self.root / name
        shutil.copytree(self.backup, target)
        (target / bm.VERIFICATION_FILE).unlink(missing_ok=True)
        return target

    def verify(self, backup: Path) -> subprocess.CompletedProcess:
        return run(str(REPO / "scripts/verificar-backup.sh"), str(backup))

    def assertInvalid(self, proc: subprocess.CompletedProcess, fragment: str) -> None:
        self.assertEqual(proc.returncode, 1, proc.stdout + proc.stderr)
        self.assertIn("❌ Backup inválido", proc.stdout)
        self.assertIn(fragment, proc.stdout)

    def test_backup_is_created_and_verified(self):
        self.assertEqual(self.result.returncode, 0, self.result.stdout + self.result.stderr)
        self.assertIn("✅ Backup verificado", self.result.stdout)
        for name in ("db.dump", "roles.sql", "manifest.json", "SHA256SUMS", "verificacion.json"):
            self.assertTrue((self.backup / name).is_file(), name)
        report = json.loads((self.backup / bm.VERIFICATION_FILE).read_text())
        self.assertTrue(report["ok"])
        self.assertEqual(report["differences"], [])
        roles = (self.backup / bm.ROLES_FILE).read_text()
        self.assertNotIn("PASSWORD", roles.upper())

    def test_no_disposable_container_is_left_behind(self):
        self.assertEqual(verify_containers(), self.before)

    def test_corrupted_dump_fails_the_checksum(self):
        backup = self.copy("truncated")
        dump = backup / bm.DUMP_FILE
        dump.write_bytes(dump.read_bytes()[: dump.stat().st_size // 2])
        self.assertInvalid(self.verify(backup), "Checksum distinto en db.dump")

    def test_truncated_dump_with_matching_sums_fails_the_restore(self):
        backup = self.copy("truncated-resummed")
        dump = backup / bm.DUMP_FILE
        dump.write_bytes(dump.read_bytes()[: dump.stat().st_size // 2])
        bm.write_sums(backup)
        self.assertInvalid(self.verify(backup), "pg_restore falló")

    def test_manifest_count_mismatch_fails_the_comparison(self):
        backup = self.copy("tampered-count")
        manifest_path = backup / bm.MANIFEST_FILE
        manifest = json.loads(manifest_path.read_text())
        manifest["database"]["stats"]["public.device"]["rows"] += 1
        manifest_path.write_text(json.dumps(manifest))
        bm.write_sums(backup)
        proc = self.verify(backup)
        self.assertInvalid(proc, "database.stats[public.device].rows")

    def test_tampered_s3_object_fails(self):
        manifest = json.loads((self.backup / bm.MANIFEST_FILE).read_text())
        if manifest["s3"].get("status") != "ok" or not manifest["s3"]["objects"]:
            self.skipTest("the stack has no S3 objects to tamper with")
        backup = self.copy("tampered-s3")
        key = sorted(manifest["s3"]["objects"])[0]
        with (backup / bm.S3_OBJECTS_DIR / key).open("ab") as handle:
            handle.write(b"tampered")
        bm.write_sums(backup)
        self.assertInvalid(self.verify(backup), f"Objeto S3 {key}")


if __name__ == "__main__":
    unittest.main()
