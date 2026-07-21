from memora.worker import main


def test_worker_once_exits_successfully() -> None:
    assert main(["--once"]) == 0
