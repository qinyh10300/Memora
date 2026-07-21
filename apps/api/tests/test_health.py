from fastapi.testclient import TestClient
from pytest import MonkeyPatch

from memora.main import create_app
from memora.settings import Settings


def test_health_reports_api_version() -> None:
    app = create_app(Settings(app_env="test"))

    with TestClient(app) as client:
        response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok", "service": "api", "version": "0.1.0"}


def test_ready_checks_database_connection(monkeypatch: MonkeyPatch) -> None:
    app = create_app(Settings(app_env="test"))
    monkeypatch.setattr("memora.api.system.check_database", lambda *_args: None)

    with TestClient(app) as client:
        response = client.get("/ready")

    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_ready_reports_dependency_failure(monkeypatch: MonkeyPatch) -> None:
    app = create_app(Settings(app_env="test"))

    def fail_database_check(*_args: object) -> None:
        raise RuntimeError("database unavailable")

    monkeypatch.setattr("memora.api.system.check_database", fail_database_check)

    with TestClient(app) as client:
        response = client.get("/ready")

    assert response.status_code == 503
    assert response.json() == {"status": "not_ready", "service": "api"}
