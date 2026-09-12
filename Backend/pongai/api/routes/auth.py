"""Accounts — sign up, sign in, and who am I."""
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, Response

from pongai.api.deps import current_user, storage
from pongai.api.errors import ApiError
from pongai.core.auth import (
    TOKEN_TTL,
    create_token,
    hash_password,
    needs_rehash,
    password_problems,
    verify_password,
)
from pongai.core.schema import (
    SignInRequest,
    SignUpRequest,
    TokenResponse,
    User,
    utcnow,
)
from pongai.core.storage import Storage

log = logging.getLogger(__name__)
router = APIRouter(tags=["auth"])


def _token_response(user: User) -> TokenResponse:
    return TokenResponse(
        access_token=create_token(user.user_id, user.email),
        expires_in_s=int(TOKEN_TTL.total_seconds()),
        user=user)


@router.post("/auth/signup", response_model=TokenResponse, status_code=201,
             summary="Create an account")
def signup(req: SignUpRequest,
           store: Storage = Depends(storage)) -> TokenResponse:
    problems = password_problems(req.password)
    if problems:
        raise ApiError(422, "weak_password",
                       "The password must " + ", ".join(problems) + ".",
                       problems=problems)

    user = User(
        user_id=store.new_user_id(),
        email=req.email,
        first_name=req.first_name.strip(),
        last_name=req.last_name.strip(),
        created_at=utcnow(),
        password_hash=hash_password(req.password),
    )

    # create_entity, not upsert: two simultaneous signups for one address
    # cannot both win, and an existing account is never overwritten.
    if not store.create_user(user):
        raise ApiError(409, "email_taken",
                       "An account with this email already exists.")

    log.info("account created: %s", user.user_id)
    return _token_response(user)


@router.post("/auth/signin", response_model=TokenResponse,
             summary="Sign in")
def signin(req: SignInRequest,
           store: Storage = Depends(storage)) -> TokenResponse:
    user = store.get_user_by_email(req.email)

    # One message and one code for both "no such account" and "wrong
    # password". Distinguishing them turns this endpoint into a way to find
    # out which addresses are registered.
    if user is None or not verify_password(req.password, user.password_hash):
        raise ApiError(401, "invalid_credentials",
                       "That email and password do not match an account.")

    # Transparently upgrade a hash made with older argon2 parameters, now that
    # the correct password is in hand.
    if needs_rehash(user.password_hash):
        store.update_user_password(user, hash_password(req.password))

    return _token_response(user)


@router.get("/auth/me", response_model=User, summary="The signed-in account")
def me(response: Response, user: User = Depends(current_user)) -> User:
    response.headers["Cache-Control"] = "no-store"
    return user
