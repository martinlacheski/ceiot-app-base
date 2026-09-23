"""Spanish search labels must stay aligned with the frontend display source."""

import re
import unittest
from pathlib import Path

from app.core import labels_es


FRONTEND_LABELS = Path(__file__).parents[3] / "frontend" / "src" / "utils" / "status-labels.ts"
MAP_NAMES = (
    "DEVICE_STATUS_LABELS",
    "OPERATION_TYPE_LABELS",
    "OPERATION_STATUS_LABELS",
)


def _frontend_map(source: str, name: str) -> dict[str, str]:
    match = re.search(
        rf"export const {name}(?:\s*:\s*Record<string, string>)?\s*=\s*\{{(?P<body>.*?)\}}",
        source,
        re.S,
    )
    assert match is not None, f"missing frontend map {name}"
    entries = re.findall(
        r"^\s*['\"]?([A-Za-z_][A-Za-z_0-9]*)['\"]?\s*:\s*(['\"])(.*?)\2\s*,?\s*$",
        match.group("body"),
        re.M,
    )
    assert entries, f"no entries parsed for {name}"
    return {code: label for code, _, label in entries}


class SpanishLabelTests(unittest.TestCase):
    @unittest.skipUnless(FRONTEND_LABELS.exists(), "frontend sources are not mounted")
    def test_backend_maps_match_frontend(self) -> None:
        source = FRONTEND_LABELS.read_text(encoding="utf-8")
        for name in MAP_NAMES:
            with self.subTest(map=name):
                self.assertEqual(getattr(labels_es, name), _frontend_map(source, name))

    def test_codes_matching_label(self) -> None:
        cases = (
            ("datos", {"sensor_data"}),
            ("DÁTOS", {"sensor_data"}),
            ("  datos   de  sensores ", {"sensor_data"}),
            ("activo", {"keep_active"}),
            ("", set()),
            ("   ", set()),
            ("%", set()),
            ("nonexistent", set()),
        )
        for term, expected in cases:
            with self.subTest(term=term):
                self.assertEqual(
                    labels_es.codes_matching_label(term, labels_es.OPERATION_TYPE_LABELS),
                    expected,
                )

    def test_maps_are_distinct_and_match_substrings(self) -> None:
        self.assertEqual(
            labels_es.codes_matching_label("vinculado", labels_es.DEVICE_STATUS_LABELS),
            {"paired", "unpaired"},
        )
        self.assertEqual(
            labels_es.codes_matching_label("pendiente", labels_es.OPERATION_STATUS_LABELS),
            {"pending"},
        )
