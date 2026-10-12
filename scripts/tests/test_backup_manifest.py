"""Unit tests for scripts/backup_manifest.py (no Docker needed).

Run: python3 -m unittest discover -s scripts/tests
"""

import hashlib
import io
import json
import sys
import tarfile
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import backup_manifest as bm  # noqa: E402


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def make_tar(path: Path, objects: dict, index: dict | None) -> None:
    with tarfile.open(path, "w") as archive:
        for key, data in objects.items():
            info = tarfile.TarInfo("objects/" + key)
            info.size = len(data)
            archive.addfile(info, io.BytesIO(data))
        if index is not None:
            raw = json.dumps(index).encode()
            info = tarfile.TarInfo("index.json")
            info.size = len(raw)
            archive.addfile(info, io.BytesIO(raw))


class QuotingTests(unittest.TestCase):
    def test_identifiers_and_literals_are_escaped(self):
        self.assertEqual(bm.quote_ident('we"ird'), '"we""ird"')
        self.assertEqual(bm.quote_literal("o'neil"), "'o''neil'")

    def test_snapshot_format(self):
        self.assertTrue(bm.is_valid_snapshot("00000008-000005DF-1"))
        self.assertFalse(bm.is_valid_snapshot("x'; DROP TABLE device; --"))
        with self.assertRaises(bm.HelperError):
            bm.Psql("c", "u", "d", snapshot="bad snapshot")


class StatsSqlTests(unittest.TestCase):
    def test_regular_table_orders_by_primary_key(self):
        sql = bm.relation_stats_sql("public.user", "r", ["id"], None)
        self.assertIn('FROM "public"."user" AS t', sql)
        self.assertIn('ORDER BY t."id"', sql)
        self.assertIn("'row_hash_sum'", sql)
        self.assertNotIn("min_time", sql)

    def test_table_without_primary_key_uses_row_hash_order(self):
        sql = bm.relation_stats_sql("public.alembic_version", "r", [], None)
        self.assertIn('ORDER BY md5(t::text) COLLATE "C"', sql)

    def test_hypertable_records_time_range_instead_of_ordered_md5(self):
        sql = bm.relation_stats_sql("public.telemetry", "r", ["id", "time"], "time")
        self.assertIn('min(t."time")', sql)
        self.assertIn('max(t."time")', sql)
        self.assertNotIn("ordered_md5", sql)

    def test_view_only_counts(self):
        sql = bm.relation_stats_sql("ai_read.devices", "v", [], None)
        self.assertIn("count(*)", sql)
        self.assertNotIn("row_hash_sum", sql)


class CompareTests(unittest.TestCase):
    def test_identical_descriptions_have_no_differences(self):
        data = {"stats": {"public.device": {"rows": 5}}, "alembic_version": ["0027"]}
        self.assertEqual(bm.compare(data, json.loads(json.dumps(data))), [])

    def test_reports_changed_count_with_relation_name(self):
        expected = {"stats": {"public.device": {"rows": 5}}}
        actual = {"stats": {"public.device": {"rows": 4}}}
        self.assertEqual(
            bm.compare(expected, actual),
            ["database.stats[public.device].rows: esperado 5, obtenido 4"],
        )

    def test_reports_missing_and_extra_keys(self):
        differences = bm.compare({"a": 1, "b": 2}, {"b": 2, "c": 3})
        self.assertIn("database.a: falta en la base restaurada", differences)
        self.assertIn("database.c: aparece en la base restaurada y no en el manifiesto", differences)

    def test_list_length_change_is_one_difference(self):
        self.assertEqual(len(bm.compare({"x": [1, 2]}, {"x": [1]})), 1)


class RolesTests(unittest.TestCase):
    def test_only_the_bootstrap_create_role_is_dropped(self):
        sql = (
            "CREATE ROLE ai_readonly;\n"
            "ALTER ROLE ai_readonly WITH NOLOGIN;\n"
            "CREATE ROLE iot_app;\n"
            "ALTER ROLE iot_app WITH SUPERUSER LOGIN;\n"
            "GRANT ai_readonly TO iot_app;\n"
        )
        filtered = bm.filter_roles(sql, "iot_app")
        self.assertNotIn("CREATE ROLE iot_app;", filtered)
        self.assertIn("CREATE ROLE ai_readonly;", filtered)
        self.assertIn("ALTER ROLE iot_app WITH SUPERUSER LOGIN;", filtered)
        self.assertIn("GRANT ai_readonly TO iot_app;", filtered)


class SumsTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name)
        (self.dir / "db.dump").write_bytes(b"dump")
        (self.dir / "s3/objects/firmware").mkdir(parents=True)
        (self.dir / "s3/objects/firmware/a.bin").write_bytes(b"fw")
        bm.write_sums(self.dir)

    def tearDown(self):
        self.tmp.cleanup()

    def test_untouched_backup_passes(self):
        self.assertEqual(bm.check_sums(self.dir), [])
        self.assertIn("s3/objects/firmware/a.bin", (self.dir / bm.SUMS_FILE).read_text())

    def test_verification_report_is_not_part_of_the_sums(self):
        (self.dir / bm.VERIFICATION_FILE).write_text("{}")
        self.assertEqual(bm.check_sums(self.dir), [])

    def test_modified_missing_and_extra_files_are_reported(self):
        (self.dir / "db.dump").write_bytes(b"dum")
        (self.dir / "s3/objects/firmware/a.bin").unlink()
        (self.dir / "extra.txt").write_text("x")
        reasons = bm.check_sums(self.dir)
        self.assertTrue(any("Checksum distinto en db.dump" in r for r in reasons))
        self.assertTrue(any("Falta el archivo s3/objects/firmware/a.bin" in r for r in reasons))
        self.assertTrue(any("extra.txt no figura" in r for r in reasons))

    def test_missing_sums_file(self):
        (self.dir / bm.SUMS_FILE).unlink()
        self.assertEqual(bm.check_sums(self.dir), ["Falta SHA256SUMS"])


class S3ExtractTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name)
        self.tar = self.dir / "s3.tar"
        self.dest = self.dir / "objects"

    def tearDown(self):
        self.tmp.cleanup()

    def test_exit_codes_map_to_status(self):
        status = json.dumps({"status": "skipped", "reason": "sin claves"})
        self.assertEqual(bm.extract_s3(self.tar, self.dest, 3, status)["status"], "skipped")
        self.assertEqual(bm.extract_s3(self.tar, self.dest, 4, "")["status"], "unavailable")
        self.assertEqual(bm.extract_s3(self.tar, self.dest, 1, "boom")["status"], "error")

    def test_objects_are_extracted_and_hashed(self):
        data = b"firmware bytes"
        make_tar(self.tar, {"firmware/a.bin": data}, {
            "bucket": "b",
            "objects": {"firmware/a.bin": {"size": len(data), "etag": "e", "metadata_sha256": sha(data)}},
        })
        section = bm.extract_s3(self.tar, self.dest, 0, "")
        self.assertEqual(section["status"], "ok")
        self.assertEqual(section["objects"]["firmware/a.bin"]["sha256"], sha(data))
        self.assertEqual((self.dest / "firmware/a.bin").read_bytes(), data)

    def test_metadata_mismatch_is_an_error(self):
        data = b"abc"
        make_tar(self.tar, {"firmware/a.bin": data}, {
            "objects": {"firmware/a.bin": {"size": 3, "metadata_sha256": sha(b"other")}},
        })
        section = bm.extract_s3(self.tar, self.dest, 0, "")
        self.assertEqual(section["status"], "error")

    def test_unsafe_keys_are_rejected(self):
        make_tar(self.tar, {"../escape": b"x"}, {"objects": {}})
        section = bm.extract_s3(self.tar, self.dest, 0, "")
        self.assertEqual(section["status"], "error")
        self.assertFalse((self.dir / "escape").exists())

    def test_truncated_stream_without_index_is_an_error(self):
        make_tar(self.tar, {"firmware/a.bin": b"abc"}, None)
        section = bm.extract_s3(self.tar, self.dest, 0, "")
        self.assertEqual(section["status"], "error")


class S3CheckTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name)
        self.doc = b"document"
        self.doc_key = f"documents/123/{sha(self.doc)}.md"
        root = self.dir / bm.S3_OBJECTS_DIR
        (root / "documents/123").mkdir(parents=True)
        (root / self.doc_key).write_bytes(self.doc)
        self.manifest = {"s3": {"status": "ok", "objects": {
            self.doc_key: {"size": len(self.doc), "sha256": sha(self.doc)},
        }}}
        self.refs = [{"table": "public.document", "key": self.doc_key, "sha256": sha(self.doc)}]

    def tearDown(self):
        self.tmp.cleanup()

    def test_intact_objects_pass(self):
        reasons, warnings = bm.check_s3(self.dir, self.manifest, self.refs)
        self.assertEqual(reasons, [])
        self.assertEqual(warnings, [])

    def test_tampered_object_fails(self):
        (self.dir / bm.S3_OBJECTS_DIR / self.doc_key).write_bytes(b"documenT")
        reasons, _ = bm.check_s3(self.dir, self.manifest, self.refs)
        self.assertTrue(any("sha256 distinto del manifiesto" in r for r in reasons))
        self.assertTrue(any("sha256 de su clave" in r for r in reasons))

    def test_missing_referenced_object_fails(self):
        refs = self.refs + [{"table": "public.firmware_release", "key": "firmware/x.bin", "sha256": "0" * 64}]
        reasons, _ = bm.check_s3(self.dir, self.manifest, refs)
        self.assertTrue(any("firmware/x.bin" in r for r in reasons))

    def test_unavailable_copy_with_references_fails(self):
        manifest = {"s3": {"status": "unavailable", "reason": "sin conexión"}}
        reasons, _ = bm.check_s3(self.dir, manifest, self.refs)
        self.assertEqual(len(reasons), 1)
        self.assertIn("la base referencia 1 objeto(s)", reasons[0])

    def test_unavailable_copy_without_references_is_a_warning(self):
        manifest = {"s3": {"status": "skipped", "reason": "no configurado"}}
        reasons, warnings = bm.check_s3(self.dir, manifest, [])
        self.assertEqual(reasons, [])
        self.assertEqual(len(warnings), 1)

    def test_explicit_exclusion_is_a_warning(self):
        reasons, warnings = bm.check_s3(self.dir, {"s3": {"status": "excluded"}}, self.refs)
        self.assertEqual(reasons, [])
        self.assertIn("--sin-s3", warnings[0])


class SummaryTests(unittest.TestCase):
    def test_success_and_failure_lines(self):
        ok = bm.summary_text({"ok": True, "backup": "b", "summary": {"tables": 2}, "warnings": []})
        self.assertTrue(ok.startswith("✅ Backup verificado"))
        bad = bm.summary_text({"ok": False, "backup": "b", "reasons": ["uno", "dos"], "warnings": []})
        self.assertTrue(bad.startswith("❌ Backup inválido: uno"))
        self.assertIn("  - dos", bad)


if __name__ == "__main__":
    unittest.main()
