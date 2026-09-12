"""Accounts, sessions, and the isolation they buy."""
import pytest

from pongai.core.auth import TOKEN_TTL, create_token
from pongai.core.schema import Job, JobStatus, utcnow
from pongai.core.storage import UPLOADS_CONTAINER

OTHER = {"email": "grace@example.com", "first_name": "Grace",
         "last_name": "Hopper", "password": "Passw0rd!"}


# =============================================================================
# Signing up
# =============================================================================

def test_signup_returns_a_session_and_never_the_hash(anon, signup):
    r = anon.post("/api/auth/signup", json=signup)
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["token_type"] == "bearer"
    assert body["expires_in_s"] == int(TOKEN_TTL.total_seconds())
    assert body["user"]["email"] == signup["email"]
    assert body["user"]["full_name"] == "Ada Lovelace"
    # the hash must not reach the client by any route
    assert "password_hash" not in body["user"]
    assert signup["password"] not in r.text


@pytest.mark.parametrize("password,missing", [
    ("Sh0rt!", "at least 8 characters"),
    ("alllowercase!", "uppercase letter"),
    ("NoSpecial123", "special character"),
])
def test_weak_passwords_are_refused_with_the_reason(anon, password, missing, signup):
    r = anon.post("/api/auth/signup", json={**signup, "password": password})
    assert r.status_code == 422
    assert r.json()["error"]["code"] == "weak_password"
    assert missing in r.json()["error"]["message"]


def test_every_password_problem_is_reported_at_once(anon, signup):
    """Fixing one and being told about the next is the pattern the upload
    rules deliberately avoid."""
    r = anon.post("/api/auth/signup", json={**signup, "password": "abc"})
    assert len(r.json()["error"]["context"]["problems"]) == 3


def test_an_address_cannot_be_registered_twice(anon, signup):
    assert anon.post("/api/auth/signup", json=signup).status_code == 201
    r = anon.post("/api/auth/signup", json=signup)
    assert r.status_code == 409
    assert r.json()["error"]["code"] == "email_taken"


def test_email_is_matched_case_insensitively(anon, signup):
    anon.post("/api/auth/signup", json=signup)
    r = anon.post("/api/auth/signup",
                  json={**signup, "email": signup["email"].upper()})
    assert r.status_code == 409


def test_a_malformed_address_is_refused(anon, signup):
    r = anon.post("/api/auth/signup", json={**signup, "email": "not-an-email"})
    assert r.status_code == 422


# =============================================================================
# Signing in
# =============================================================================

def test_signin_with_the_right_password(anon, signup):
    anon.post("/api/auth/signup", json=signup)
    r = anon.post("/api/auth/signin", json={"email": signup["email"],
                                            "password": signup["password"]})
    assert r.status_code == 200
    assert r.json()["access_token"]


@pytest.mark.parametrize("wrong_account", [False, True])
def test_bad_credentials_are_indistinguishable(anon, signup, wrong_account):
    """Different messages here would turn sign-in into a way to discover which
    addresses are registered."""
    anon.post("/api/auth/signup", json=signup)
    r = anon.post("/api/auth/signin", json={
        "email": "nobody@example.com" if wrong_account else signup["email"],
        "password": "Passw0rd!" if wrong_account else "Wr0ngPass!"})
    assert r.status_code == 401
    assert r.json()["error"]["code"] == "invalid_credentials"
    assert r.json()["error"]["message"] == (
        "That email and password do not match an account.")


# =============================================================================
# Sessions
# =============================================================================

def test_me_returns_the_signed_in_account(client, signup):
    body = client.get("/api/auth/me").json()
    assert body["email"] == signup["email"]
    assert "password_hash" not in body


@pytest.mark.parametrize("header", [
    None, "", "Bearer", "Bearer ", "Basic abc", "Bearer not.a.token",
])
def test_a_missing_or_malformed_token_is_401(anon, header):
    h = {"Authorization": header} if header is not None else {}
    r = anon.get("/api/auth/me", headers=h)
    assert r.status_code == 401


def test_an_expired_token_says_so(anon, store, monkeypatch, signup):
    from datetime import timedelta

    from pongai.core import auth
    anon.post("/api/auth/signup", json=signup)
    user = store.get_user_by_email(signup["email"])

    monkeypatch.setattr(auth, "TOKEN_TTL", timedelta(seconds=-1))
    stale = create_token(user.user_id, user.email)

    r = anon.get("/api/auth/me", headers={"Authorization": f"Bearer {stale}"})
    assert r.status_code == 401
    assert r.json()["error"]["code"] == "session_expired"


def test_a_token_signed_with_another_secret_is_rejected(anon, monkeypatch, signup):
    anon.post("/api/auth/signup", json=signup)
    monkeypatch.setenv("PONGAI_JWT_SECRET", "x" * 48)
    forged = create_token("u" + "0" * 31, signup["email"])
    monkeypatch.setenv("PONGAI_JWT_SECRET", "t" * 48)
    r = anon.get("/api/auth/me", headers={"Authorization": f"Bearer {forged}"})
    assert r.status_code == 401


def test_a_fresh_token_is_not_refreshed(client, signup):
    assert "X-Refresh-Token" not in client.get("/api/auth/me").headers


def test_a_half_spent_token_is_refreshed_in_place(anon, store, signup):
    """Sliding expiry. An analysis runs ~25 minutes with the page polling
    throughout; a hard cut would sign people out mid-run.

    The token is minted with a backdated `iat` rather than by shortening the
    TTL — the refresh decision is about how long ago it was ISSUED, so a
    shorter TTL on a brand-new token proves nothing.
    """
    from datetime import datetime, timedelta, timezone

    import jwt

    from pongai.core import auth

    anon.post("/api/auth/signup", json=signup)
    user = store.get_user_by_email(signup["email"])

    issued = datetime.now(timezone.utc) - timedelta(minutes=31)  # past halfway
    old = jwt.encode(
        {"sub": user.user_id, "email": user.email,
         "iat": int(issued.timestamp()),
         "exp": int((issued + auth.TOKEN_TTL).timestamp())},
        auth.secret(), algorithm=auth.ALGORITHM)

    r = anon.get("/api/auth/me", headers={"Authorization": f"Bearer {old}"})
    assert r.status_code == 200
    fresh = r.headers.get("X-Refresh-Token")
    assert fresh and fresh != old
    # and the replacement is itself a working session
    assert anon.get(
        "/api/auth/me",
        headers={"Authorization": f"Bearer {fresh}"}).status_code == 200


# =============================================================================
# Isolation — the point of the exercise
# =============================================================================

def _signed_in(anon, who):
    r = anon.post("/api/auth/signup", json=who)
    assert r.status_code == 201, r.text
    return r.json()["access_token"], r.json()["user"]["user_id"]


def test_a_user_sees_only_their_own_uploads(anon, store, signup):
    ada, ada_id = _signed_in(anon, signup)
    grace, grace_id = _signed_in(anon, OTHER)

    for jid, uid, name in (("a" * 16, ada_id, "ada.mp4"),
                           ("b" * 16, grace_id, "grace.mp4")):
        store.put_job(Job(job_id=jid, user_id=uid,
                          status=JobStatus.AWAITING_UPLOAD, filename=name,
                          created_at=utcnow(), updated_at=utcnow()))

    for token, expected in ((ada, "ada.mp4"), (grace, "grace.mp4")):
        rows = anon.get("/api/jobs",
                        headers={"Authorization": f"Bearer {token}"}).json()
        assert [j["filename"] for j in rows] == [expected]


@pytest.mark.parametrize("method,path", [
    ("get", "/api/jobs/{jid}"),
    ("get", "/api/jobs/{jid}/source"),
    ("post", "/api/jobs/{jid}/submit"),
    ("post", "/api/jobs/{jid}/retry"),
    ("delete", "/api/jobs/{jid}"),
    ("get", "/api/analyses/{jid}"),
])
def test_another_users_job_is_reported_missing_not_forbidden(
        anon, store, signup, method, path):
    """404, never 403 — a 403 would confirm the id exists, turning these into
    a way to probe for other people's jobs."""
    _, ada_id = _signed_in(anon, signup)
    grace, _ = _signed_in(anon, OTHER)

    jid = "0123456789abcdef"
    store.put_job(Job(job_id=jid, user_id=ada_id, status=JobStatus.DONE,
                      filename="ada.mp4", created_at=utcnow(),
                      updated_at=utcnow()))
    store.blobs[(UPLOADS_CONTAINER, f"{jid}/ada.mp4")] = b"x"

    r = getattr(anon, method)(path.format(jid=jid),
                              headers={"Authorization": f"Bearer {grace}"})
    assert r.status_code == 404, r.text
    assert r.json()["error"]["code"] in ("job_not_found", "demo_not_found")


@pytest.mark.parametrize("method,path", [
    ("get", "/api/jobs"),
    ("post", "/api/uploads"),
    ("get", "/api/jobs/0123456789abcdef"),
    ("delete", "/api/jobs/0123456789abcdef"),
    ("get", "/api/analyses/0123456789abcdef"),
])
def test_the_job_routes_require_a_session(anon, method, path):
    kw = {"json": {}} if method == "post" else {}
    r = getattr(anon, method)(path, **kw)
    assert r.status_code == 401, f"{method} {path} is open"


@pytest.mark.parametrize("path", [
    "/api/health", "/api/ready", "/api/limits", "/api/demos",
])
def test_the_public_routes_stay_public(anon, path):
    """Demos are the shop window; health is a platform probe."""
    assert anon.get(path).status_code != 401


def test_an_upload_is_owned_by_whoever_created_it(client, store, probe):
    r = client.post("/api/uploads", json={
        "filename": "c.mp4", "size_bytes": 2048, "probe": probe})
    assert r.status_code == 200, r.text
    me = client.get("/api/auth/me").json()
    assert store.jobs[r.json()["job_id"]].user_id == me["user_id"]
