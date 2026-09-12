"""
pongai.core.auth — passwords and session tokens.

Two rules shape this file.

Passwords are hashed with argon2id, never stored or logged. The parameters are
the argon2-cffi defaults, which follow the OWASP guidance; the hash string
carries its own parameters, so raising them later still verifies old hashes.

The password policy lives here rather than in the API so the browser and the
server reject the same passwords with the same words — the same reason the
upload limits live in `validation.py`.
"""
from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError, VerificationError

# --- passwords ---------------------------------------------------------------

MIN_PASSWORD_LENGTH = 8
SPECIAL_CHARS = "!@#$%^&*()_+-=[]{}|;:',.<>?/`~\"\\"

_hasher = PasswordHasher()


def password_problems(password: str) -> list[str]:
    """Every problem at once, phrased for a person.

    Returning them one at a time makes a user fix, resubmit, and be told about
    the next one — the same reason `validate_probe` reports all its findings
    together.
    """
    out: list[str] = []
    if len(password) < MIN_PASSWORD_LENGTH:
        out.append(f"be at least {MIN_PASSWORD_LENGTH} characters")
    if not any(c.isupper() for c in password):
        out.append("contain an uppercase letter")
    if not any(c in SPECIAL_CHARS for c in password):
        out.append("contain a special character")
    return out


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password: str, hashed: str) -> bool:
    try:
        return _hasher.verify(hashed, password)
    except (VerifyMismatchError, VerificationError):
        return False


def needs_rehash(hashed: str) -> bool:
    """True when a hash was made with weaker parameters than today's."""
    return _hasher.check_needs_rehash(hashed)


# --- tokens ------------------------------------------------------------------

ALGORITHM = "HS256"
MIN_SECRET_BYTES = 32
TOKEN_TTL = timedelta(minutes=60)

# Refresh once a token is past halfway. Reissuing on every request would churn
# the client's stored token for no benefit; waiting for expiry would log out a
# user who is actively watching a 25-minute analysis.
REFRESH_AFTER = TOKEN_TTL / 2


class AuthConfigError(RuntimeError):
    pass


def secret() -> str:
    """The signing key.

    Deliberately has no default. A generated fallback would differ between API
    replicas — so a token issued by one would be rejected by another — and
    would silently invalidate every session on restart.
    """
    s = os.getenv("PONGAI_JWT_SECRET")
    if not s:
        raise AuthConfigError("PONGAI_JWT_SECRET is not set")
    # RFC 7518 §3.2: an HMAC key shorter than the hash output weakens HS256.
    # PyJWT only warns, once per call; failing here means a weak secret is
    # caught when the container starts rather than logged forever.
    if len(s.encode()) < MIN_SECRET_BYTES:
        raise AuthConfigError(
            f"PONGAI_JWT_SECRET must be at least {MIN_SECRET_BYTES} bytes; "
            f"generate one with: openssl rand -base64 48")
    return s


def create_token(user_id: str, email: str) -> str:
    now = datetime.now(timezone.utc)
    return jwt.encode(
        {"sub": user_id, "email": email,
         "iat": int(now.timestamp()),
         "exp": int((now + TOKEN_TTL).timestamp())},
        secret(), algorithm=ALGORITHM)


class InvalidToken(Exception):
    pass


def decode_token(token: str) -> dict:
    """Claims, or InvalidToken. Expiry is checked by the library."""
    try:
        return jwt.decode(token, secret(), algorithms=[ALGORITHM])
    except jwt.ExpiredSignatureError as e:
        raise InvalidToken("expired") from e
    except jwt.InvalidTokenError as e:
        raise InvalidToken("invalid") from e


def should_refresh(claims: dict) -> bool:
    issued = datetime.fromtimestamp(claims["iat"], tz=timezone.utc)
    return datetime.now(timezone.utc) - issued > REFRESH_AFTER
