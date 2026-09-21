"""Standalone checks for the bounded offline access-test runner.

This driver uses only stdlib doubles. It never starts real pytest collection and
is deliberately not named ``test_*.py``.
"""

from __future__ import annotations

import asyncio
import importlib
import pathlib
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

import access_offline_runner as runner
import oauth_offline_runner as oauth_runner


class FakeEmailModule(types.ModuleType):
    EmailService: object
    ConnectionConfig: object
    FastMail: object


class AccessOfflineBootstrapChecks(unittest.TestCase):
    def test_runner_reuses_the_audited_oauth_guard_functions(self) -> None:
        self.assertIs(
            runner._replace_process_environment,
            oauth_runner._replace_process_environment,
        )
        self.assertIs(runner._install_network_denial, oauth_runner._install_network_denial)
        self.assertIs(runner._disable_dotenv_sources, oauth_runner._disable_dotenv_sources)
        self.assertIs(
            runner._install_provider_doubles,
            oauth_runner._install_provider_doubles,
        )

    def test_selection_accepts_each_exact_file_and_nonempty_nodes(self) -> None:
        expected_targets = (
            "tests/api/access/test_service.py",
            "tests/api/access/test_router.py",
            "tests/api/device/test_contextual_access_router.py",
            "tests/api/device/test_operation_service_slim.py",
            "tests/api/environment/test_invitation_service_access.py",
            "tests/api/environment/test_environment_creation_without_mercadopago.py",
            "tests/api/access/test_commission_free_sharing.py",
            "tests/api/test_mp_retirement_surface.py",
            "tests/core/mqtt/test_runtime_retirement.py",
            "tests/core/test_startup_bootstrap.py",
        )
        self.assertEqual(runner._ALLOWED_TARGETS, expected_targets)

        for target in expected_targets:
            with self.subTest(target=target):
                self.assertEqual(runner._selection_args([target]), [target])
                node = f"{target}::TestAccess::test_allowed[param]"
                self.assertEqual(runner._selection_args([node]), [node])

        selections = [
            "tests/api/access/test_service.py::test_first",
            "tests/api/device/test_contextual_access_router.py::TestRead::test_second",
        ]
        self.assertEqual(runner._selection_args(selections), selections)

    def test_selection_accepts_operation_service_slim_file_and_nonempty_node(
        self,
    ) -> None:
        target = "tests/api/device/test_operation_service_slim.py"
        node = f"{target}::test_list_operations_omits_financial_fields"

        self.assertEqual(runner._selection_args([target]), [target])
        self.assertEqual(runner._selection_args([node]), [node])

    def test_selection_rejects_empty_options_aliases_and_lookalikes(self) -> None:
        target = (
            "tests/api/environment/"
            "test_environment_creation_without_mercadopago.py"
        )
        rejected = [
            [],
            [f"{target}::"],
            [f"{target}::::test_name"],
            [f"{target}::TestAccess::"],
            [f"{target}_extra.py"],
            [f"{target}c"],
            [f"{target}/suffix"],
            [f"./{target}"],
            [f"tests/api/access/../access/{target.rsplit('/', 1)[-1]}"],
            ["--collect-only"],
            [target, "tests/api/access/test_repository.py"],
            ["tests/core/test_startup_bootstrap.py_extra"],
            ["tests/core/test_startup_bootstrap.py::"],
            [f"{target}::test_one", "-k", "access"],
        ]

        for arguments in rejected:
            with self.subTest(arguments=arguments), self.assertRaises(SystemExit):
                runner._selection_args(arguments)

    def test_rejection_stops_before_bootstrap_and_pytest_import(self) -> None:
        events: list[str] = []

        def reject_if_called() -> None:
            events.append("unexpected guard")
            raise AssertionError("Invalid selections must stop before every guard.")

        with (
            patch.object(sys, "argv", ["access_offline_runner.py", "-q"]),
            patch.object(
                runner,
                "_replace_process_environment",
                side_effect=reject_if_called,
            ),
            patch.object(
                runner,
                "_install_network_denial",
                side_effect=reject_if_called,
            ),
            patch.object(
                runner,
                "_disable_dotenv_sources",
                side_effect=reject_if_called,
            ),
            patch.object(
                runner,
                "_install_provider_doubles",
                side_effect=reject_if_called,
            ),
            patch.object(
                runner,
                "_install_invitation_email_double",
                side_effect=reject_if_called,
            ),
            patch.object(runner, "_import_pytest", side_effect=AssertionError),
            self.assertRaises(SystemExit),
        ):
            runner.main()

        self.assertEqual(events, [])

    def test_valid_selection_runs_every_guard_before_pytest_and_propagates(self) -> None:
        events: list[str] = []
        fake_pytest = types.SimpleNamespace(
            main=lambda arguments: events.append(f"pytest.main:{arguments!r}") or 23
        )

        def record(name: str, result: object = None):
            def call() -> object:
                events.append(name)
                return result

            return call

        target = "tests/api/access/test_router.py::test_allowed"
        with (
            patch.object(sys, "argv", ["access_offline_runner.py", target]),
            patch.object(
                runner,
                "_replace_process_environment",
                side_effect=record("environment"),
            ),
            patch.object(
                runner,
                "_install_network_denial",
                side_effect=record("network", (object(), object())),
            ),
            patch.object(
                runner,
                "_disable_dotenv_sources",
                side_effect=record("dotenv"),
            ),
            patch.object(
                runner,
                "_install_provider_doubles",
                side_effect=record("providers"),
            ),
            patch.object(
                runner,
                "_install_invitation_email_double",
                side_effect=record("invitation email"),
            ),
            patch.object(
                runner,
                "_import_pytest",
                side_effect=record("pytest.import", fake_pytest),
            ),
        ):
            result = runner.main()

        self.assertEqual(result, 23)
        self.assertEqual(
            events,
            [
                "environment",
                "network",
                "dotenv",
                "providers",
                "invitation email",
                "pytest.import",
                f"pytest.main:{['-q', target]!r}",
            ],
        )

    def test_invitation_email_double_resolves_backend_root_from_runner_file(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            backend_root = pathlib.Path(temporary_directory) / "backend"
            tests_root = backend_root / "tests"
            email_path = backend_root / "app" / "core" / "email.py"
            tests_root.mkdir(parents=True)
            email_path.parent.mkdir(parents=True)
            (backend_root / "app" / "__init__.py").write_text("", encoding="utf-8")
            (email_path.parent / "__init__.py").write_text("", encoding="utf-8")
            email_path.write_text(
                "ORIGIN = 'temporary-inert-email'\n"
                "class EmailService:\n"
                "    pass\n",
                encoding="utf-8",
            )
            synthetic_runner = tests_root / "access_offline_runner.py"
            synthetic_runner.write_text("# synthetic runner path\n", encoding="utf-8")
            isolated_modules = {
                name: module
                for name, module in sys.modules.items()
                if name != "app" and not name.startswith("app.")
            }
            importlib.invalidate_caches()

            with (
                patch.object(runner, "__file__", str(synthetic_runner)),
                patch.object(sys, "path", [str(tests_root)]),
                patch.dict(sys.modules, isolated_modules, clear=True),
            ):
                double_class = runner._install_invitation_email_double()
                imported_email = sys.modules["app.core.email"]

                self.assertEqual(sys.path[0], str(backend_root.resolve()))
                imported_path = imported_email.__file__
                if imported_path is None:
                    self.fail("The temporary email module must have a source path.")
                self.assertEqual(
                    pathlib.Path(imported_path).resolve(), email_path.resolve()
                )
                self.assertEqual(imported_email.ORIGIN, "temporary-inert-email")
                self.assertIs(imported_email.EmailService, double_class)

    def test_invitation_email_double_captures_only_exact_invitation_arguments(self) -> None:
        constructor_calls: list[object] = []

        class OriginalEmailService:
            def __init__(self, *_args: object, **_kwargs: object) -> None:
                constructor_calls.append(object())
                raise AssertionError("The production EmailService must not be constructed.")

        def transport_tripwire(*_args: object, **_kwargs: object) -> None:
            raise AssertionError("Mail configuration and transport must remain unused.")

        email_module = FakeEmailModule("app.core.email")
        email_module.EmailService = OriginalEmailService
        email_module.ConnectionConfig = transport_tripwire
        email_module.FastMail = transport_tripwire

        with (
            patch.object(sys, "path", list(sys.path)),
            patch.object(runner, "_read_module", return_value=email_module) as reader,
        ):
            double_class = runner._install_invitation_email_double()

        reader.assert_called_once_with("app.core.email")
        self.assertIs(email_module.EmailService, double_class)
        service = double_class(config=object())
        result = asyncio.run(
            service.send_invitation_email(
                "guest@example.invalid",
                "Synthetic Environment",
                "owner@example.invalid",
                "synthetic-invitation-id",
            )
        )

        self.assertIsNone(result)
        self.assertEqual(constructor_calls, [])
        self.assertEqual(
            double_class.invitation_calls,
            [
                (
                    "guest@example.invalid",
                    "Synthetic Environment",
                    "owner@example.invalid",
                    "synthetic-invitation-id",
                )
            ],
        )

    def test_invitation_email_double_rejects_all_other_send_methods(self) -> None:
        email_module = FakeEmailModule("app.core.email")
        email_module.EmailService = object

        with (
            patch.object(sys, "path", list(sys.path)),
            patch.object(runner, "_read_module", return_value=email_module),
        ):
            double_class = runner._install_invitation_email_double()

        service = double_class()
        rejected_calls = (
            lambda: service.send_verification_email("user@example.invalid", "token"),
            lambda: service.send_password_reset_email(
                "user@example.invalid", "Synthetic User", "token"
            ),
            lambda: service.send_contact_email(
                name="Synthetic User",
                email_from="user@example.invalid",
                company=None,
                phone=None,
                message_text="Synthetic message",
            ),
        )
        for call in rejected_calls:
            with self.subTest(call=call), self.assertRaises(AssertionError):
                asyncio.run(call())

        with self.assertRaises(AssertionError):
            service.send_unknown_email()
        self.assertEqual(double_class.invitation_calls, [])

    def test_invitation_email_double_rejects_each_preloaded_consumer_before_import(self) -> None:
        for consumer in runner._EMAIL_SERVICE_CONSUMERS:
            with (
                self.subTest(consumer=consumer),
                patch.dict(sys.modules, {consumer: types.ModuleType(consumer)}),
                patch.object(
                    runner,
                    "_read_module",
                    side_effect=AssertionError("Email module import must not run."),
                ) as reader,
                self.assertRaisesRegex(RuntimeError, consumer),
            ):
                runner._install_invitation_email_double()
            reader.assert_not_called()

    def test_existing_oauth_selection_contract_is_unchanged(self) -> None:
        target = "tests/test_google_oauth.py"
        self.assertEqual(oauth_runner._selection_args([]), [target])
        self.assertEqual(
            oauth_runner._selection_args([f"{target}::test_google_login"]),
            [f"{target}::test_google_login"],
        )
        with self.assertRaises(SystemExit):
            oauth_runner._selection_args(["tests/api/access/test_service.py"])


if __name__ == "__main__":
    unittest.main()
