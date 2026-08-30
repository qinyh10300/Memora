from __future__ import annotations

import json
import sys
from typing import Any


LOOPBACK_ADDRESSES = {"127.0.0.1", "::1"}


def main() -> int:
    config: dict[str, Any] = json.load(sys.stdin)
    services = config.get("services", {})
    api_environment = services.get("api", {}).get("environment", {})
    quick_login_enabled = str(
        api_environment.get("DEVELOPMENT_QUICK_LOGIN_ENABLED", "false")
    ).lower() in {"1", "true", "yes", "on"}
    if not quick_login_enabled:
        return 0

    unsafe_bindings = [
        port
        for port in services.get("proxy", {}).get("ports", [])
        if port.get("published") and port.get("host_ip") not in LOOPBACK_ADDRESSES
    ]
    if unsafe_bindings:
        print(
            "development quick login requires every published proxy port to bind loopback",
            file=sys.stderr,
        )
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
