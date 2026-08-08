import hashlib
import hmac
from uuid import UUID

from pwdlib import PasswordHash

_password_hash = PasswordHash.recommended()
_dummy_password_hash = _password_hash.hash("memora-dummy-password-for-timing-only")


def normalize_email(email: str) -> str:
    return email.strip().casefold()


def hash_password(password: str) -> str:
    return _password_hash.hash(password)


def verify_password(password: str, password_hash: str | None) -> bool:
    candidate_hash = password_hash or _dummy_password_hash
    return _password_hash.verify(password, candidate_hash)


def digest_session_token(token: str, secret: str) -> str:
    return hmac.new(secret.encode(), token.encode(), hashlib.sha256).hexdigest()


def digest_verification_code(
    *,
    challenge_id: UUID,
    email: str,
    purpose: str,
    code: str,
    secret: str,
) -> str:
    message = f"{challenge_id}:{normalize_email(email)}:{purpose}:{code}"
    return hmac.new(secret.encode(), message.encode(), hashlib.sha256).hexdigest()


def verify_verification_code(
    *,
    challenge_id: UUID,
    email: str,
    purpose: str,
    code: str,
    expected_digest: str,
    secret: str,
) -> bool:
    candidate = digest_verification_code(
        challenge_id=challenge_id,
        email=email,
        purpose=purpose,
        code=code,
        secret=secret,
    )
    return hmac.compare_digest(candidate, expected_digest)
