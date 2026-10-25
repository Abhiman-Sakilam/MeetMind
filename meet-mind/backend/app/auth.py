"""JWT authentication helpers for MeetMind."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Annotated

from fastapi import Depends, HTTPException
from fastapi.security import OAuth2PasswordBearer

_oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login", auto_error=False)


def _secret() -> str:
    from app.config import settings
    return settings.jwt_secret


def create_access_token(user_id: str, email: str, name: str = "") -> str:
    from app.config import settings
    from jose import jwt

    expire = datetime.now(timezone.utc) + timedelta(minutes=settings.jwt_expire_minutes)
    payload = {"sub": user_id, "email": email, "name": name, "exp": expire}
    return jwt.encode(payload, _secret(), algorithm=settings.jwt_algorithm)


def decode_token(token: str) -> dict:
    from app.config import settings
    from jose import JWTError, jwt

    try:
        return jwt.decode(token, _secret(), algorithms=[settings.jwt_algorithm])
    except JWTError as exc:
        raise HTTPException(status_code=401, detail="Invalid or expired token") from exc


def _reset_secret() -> str:
    # Separate signing key so a reset token can never be used as a login token, or vice versa.
    return _secret() + ":password-reset"


def _password_fingerprint(hashed_password: str) -> str:
    # Ties a reset token to the current password, so it stops working once the password changes.
    import hashlib
    return hashlib.sha256(hashed_password.encode("utf-8")).hexdigest()[:16]


def create_password_reset_token(user_id: str, hashed_password: str) -> str:
    from app.config import settings
    from jose import jwt

    expire = datetime.now(timezone.utc) + timedelta(minutes=settings.password_reset_expire_minutes)
    payload = {"sub": user_id, "pwd": _password_fingerprint(hashed_password), "exp": expire}
    return jwt.encode(payload, _reset_secret(), algorithm=settings.jwt_algorithm)


def decode_password_reset_token(token: str) -> dict | None:
    """Return the token payload, or None if it is malformed or expired."""
    from app.config import settings
    from jose import JWTError, jwt

    try:
        return jwt.decode(token, _reset_secret(), algorithms=[settings.jwt_algorithm])
    except JWTError:
        return None


def reset_token_matches(payload: dict, hashed_password: str) -> bool:
    """False once the password has changed since the token was issued (i.e. link already used)."""
    import hmac
    return hmac.compare_digest(str(payload.get("pwd", "")), _password_fingerprint(hashed_password))


def hash_password(plain: str) -> str:
    import bcrypt
    # bcrypt only uses the first 72 bytes; truncate to avoid modern bcrypt's
    # ">72 bytes" ValueError (passlib 1.7.x is unmaintained and breaks on bcrypt 4.x).
    pw = plain.encode("utf-8")[:72]
    return bcrypt.hashpw(pw, bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    import bcrypt
    try:
        return bcrypt.checkpw(plain.encode("utf-8")[:72], hashed.encode("utf-8"))
    except (ValueError, TypeError):
        return False


async def get_current_user(
    token: Annotated[str | None, Depends(_oauth2_scheme)] = None,
):
    """FastAPI dependency. Raises 401 if token is missing or invalid.
    Returns the decoded JWT payload dict."""
    if not _secret():
        raise HTTPException(
            status_code=503,
            detail="Authentication is not enabled. Set JWT_SECRET in .env",
        )
    if not token:
        raise HTTPException(status_code=401, detail="Missing authentication token")
    return decode_token(token)


async def get_optional_user(
    token: Annotated[str | None, Depends(_oauth2_scheme)] = None,
):
    """Like get_current_user but returns None instead of raising when auth is disabled."""
    if not _secret() or not token:
        return None
    try:
        return decode_token(token)
    except HTTPException:
        return None
