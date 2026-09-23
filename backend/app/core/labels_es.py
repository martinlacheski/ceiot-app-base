"""Spanish copies of frontend labels used by existing server-side enum searches.

Keep these maps in sync with ``frontend/src/utils/status-labels.ts``; the parity
test in ``tests/core/test_labels_es.py`` detects drift.
"""

import re
import unicodedata
from collections.abc import Mapping


DEVICE_STATUS_LABELS: dict[str, str] = {
    "new": "NUEVO",
    "paired": "VINCULADO",
    "active": "ACTIVO",
    "maintenance": "MANTENIMIENTO",
    "unpaired": "DESVINCULADO",
}

OPERATION_TYPE_LABELS: dict[str, str] = {
    "sensor_data": "Datos de sensores",
    "keep_active": "Dispositivo activo",
    "session_request": "Solicitud de sesión",
    "error": "Error",
    "other": "Otro",
}

OPERATION_STATUS_LABELS: dict[str, str] = {
    "success": "Exitoso",
    "failed": "Fallido",
    "pending": "Pendiente",
}


def _normalize(value: str) -> str:
    decomposed = unicodedata.normalize("NFKD", value)
    accent_free = "".join(char for char in decomposed if not unicodedata.combining(char))
    return re.sub(r"\s+", " ", accent_free).strip().casefold()


def codes_matching_label(term: str, mapping: Mapping[str, str]) -> set[str]:
    """Return codes whose Spanish label contains a case/accent-insensitive term."""
    needle = _normalize(term)
    if not needle:
        return set()
    return {code for code, label in mapping.items() if needle in _normalize(label)}
