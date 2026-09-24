"""The standalone MQTT runtime must load every ORM model it can touch.

``app.main_runtime`` runs in its own process (compose service ``mqtt-runtime``)
and never imports the API routers, so string relationships such as
``Environment.invitations`` only resolve if the runtime imports their models.
"""

import os
import subprocess
import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[3]


def test_runtime_process_configures_all_mappers() -> None:
    result = subprocess.run(
        [
            sys.executable,
            "-c",
            "import app.main_runtime\n"
            "from sqlalchemy.orm import configure_mappers\n"
            "configure_mappers()\n",
        ],
        cwd=BACKEND_ROOT,
        env=os.environ.copy(),
        capture_output=True,
        text=True,
        timeout=60,
        check=False,
    )

    assert result.returncode == 0, result.stderr[-2000:]
