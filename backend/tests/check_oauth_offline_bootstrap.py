"""Standalone source check for the OAuth offline bootstrap.

Run directly so the network and environment guards are installed before importing
pydantic-settings. This file is deliberately not named ``test_*.py``.
"""

from __future__ import annotations

import importlib
import pathlib
import unittest
from unittest.mock import patch

import oauth_offline_runner as runner


class OAuthOfflineBootstrapChecks(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        runner._replace_process_environment()
        runner._install_network_denial()

    def test_dotenv_constructor_never_reaches_file_reader(self) -> None:
        runner._disable_dotenv_sources()

        settings_module = importlib.import_module("pydantic_settings")
        sources_module = importlib.import_module("pydantic_settings.sources")
        BaseSettings = settings_module.BaseSettings
        SettingsConfigDict = settings_module.SettingsConfigDict
        DotEnvSettingsSource = sources_module.DotEnvSettingsSource

        reads: list[object] = []

        def reject_file_read(*args: object, **kwargs: object) -> dict[str, object]:
            reads.append((args, kwargs))
            raise AssertionError("Dotenv constructor attempted a file read")

        class ProbeSettings(BaseSettings):
            model_config = SettingsConfigDict(
                env_file="/synthetic/oauth-offline-probe.env"
            )
            probe_value: str = "safe-default"

        with (
            patch.object(pathlib.Path, "is_file", return_value=True),
            patch.object(
                DotEnvSettingsSource,
                "_read_env_file",
                new=reject_file_read,
            ),
        ):
            settings = ProbeSettings()

        self.assertEqual(settings.probe_value, "safe-default")
        self.assertEqual(reads, [])

    def test_selection_accepts_only_exact_file_or_nonempty_node(self) -> None:
        target = "tests/test_google_oauth.py"
        self.assertEqual(runner._selection_args([]), [target])
        self.assertEqual(runner._selection_args([target]), [target])
        self.assertEqual(
            runner._selection_args([f"{target}::test_disabled_login_stops_before_sso"]),
            [f"{target}::test_disabled_login_stops_before_sso"],
        )
        self.assertEqual(
            runner._selection_args(
                [
                    f"{target}::TestGroup::test_first",
                    f"{target}::test_second[param]",
                ]
            ),
            [
                f"{target}::TestGroup::test_first",
                f"{target}::test_second[param]",
            ],
        )

    def test_selection_rejects_lookalikes_options_and_other_files(self) -> None:
        target = "tests/test_google_oauth.py"
        rejected = [
            [f"{target}::"],
            [f"{target}_extra.py"],
            [f"{target}c"],
            [f"{target}/suffix"],
            [f"./{target}"],
            ["--collect-only"],
            [target, "tests/test_other.py"],
            [f"{target}::test_one", "-k", "oauth"],
        ]

        for arguments in rejected:
            with self.subTest(arguments=arguments), self.assertRaises(SystemExit):
                runner._selection_args(arguments)


if __name__ == "__main__":
    unittest.main()
