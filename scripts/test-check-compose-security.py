from __future__ import annotations

import json
import subprocess
import sys
import unittest
from pathlib import Path
from typing import Any


CHECKER = Path(__file__).with_name("check-compose-security.py")


def compose_config(*, enabled: bool, ports: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "services": {
            "api": {
                "environment": {
                    "DEVELOPMENT_QUICK_LOGIN_ENABLED": str(enabled).lower(),
                }
            },
            "proxy": {"ports": ports},
        }
    }


def run_checker(config: dict[str, Any]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, str(CHECKER)],
        input=json.dumps(config),
        capture_output=True,
        check=False,
        text=True,
    )


class ComposeSecurityCheckTest(unittest.TestCase):
    def test_accepts_loopback_bindings_when_quick_login_is_enabled(self) -> None:
        result = run_checker(
            compose_config(
                enabled=True,
                ports=[
                    {"published": "8080", "host_ip": "127.0.0.1"},
                    {"published": "8443", "host_ip": "::1"},
                ],
            )
        )

        self.assertEqual(result.returncode, 0, result.stderr)

    def test_rejects_unspecified_or_non_loopback_bindings(self) -> None:
        for host_ip in (None, "0.0.0.0", "::", "192.0.2.10"):
            with self.subTest(host_ip=host_ip):
                port = {"published": "8080"}
                if host_ip is not None:
                    port["host_ip"] = host_ip

                result = run_checker(
                    compose_config(enabled=True, ports=[port])
                )

                self.assertEqual(result.returncode, 1)
                self.assertIn("requires every published proxy port", result.stderr)

    def test_does_not_restrict_bindings_when_quick_login_is_disabled(self) -> None:
        result = run_checker(
            compose_config(
                enabled=False,
                ports=[{"published": "8080", "host_ip": "0.0.0.0"}],
            )
        )

        self.assertEqual(result.returncode, 0, result.stderr)


if __name__ == "__main__":
    unittest.main()
