import argparse
import json
from pathlib import Path

from memora.main import create_app
from memora.settings import Settings

DEFAULT_OUTPUT = Path(__file__).resolve().parents[4] / "packages" / "api-contract" / "openapi.json"


def export_openapi(output: Path) -> None:
    app = create_app(
        Settings(
            app_env="test",
            seed_development_data_enabled=False,
            development_quick_login_enabled=False,
        )
    )
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(
        json.dumps(app.openapi(), ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="Export the Memora OpenAPI contract")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()
    export_openapi(args.output)


if __name__ == "__main__":
    main()
