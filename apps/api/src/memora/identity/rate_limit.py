from collections import defaultdict, deque
from threading import Lock
from time import monotonic


class LoginRateLimiter:
    def __init__(self, *, maximum_attempts: int = 8, window_seconds: float = 60) -> None:
        self.maximum_attempts = maximum_attempts
        self.window_seconds = window_seconds
        self._attempts: dict[str, deque[float]] = defaultdict(deque)
        self._lock = Lock()

    def consume(self, key: str, *, now: float | None = None) -> bool:
        current_time = monotonic() if now is None else now
        cutoff = current_time - self.window_seconds
        with self._lock:
            attempts = self._attempts[key]
            while attempts and attempts[0] <= cutoff:
                attempts.popleft()
            if len(attempts) >= self.maximum_attempts:
                return False
            attempts.append(current_time)
            return True

    def reset(self, key: str) -> None:
        with self._lock:
            self._attempts.pop(key, None)
