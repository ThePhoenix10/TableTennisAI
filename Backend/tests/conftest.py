"""A fake Storage so the API can be tested without Azure.

Everything the routes touch goes through the `storage()` dependency, so one
override covers every endpoint.
"""
from __future__ import annotations

import json
from datetime import timedelta

import pytest
from fastapi.testclient import TestClient

from pongai.api import deps
from pongai.api.main import app
from pongai.core.schema import Job, User, utcnow
from pongai.core.storage import email_key


class FakeStorage:
    def __init__(self):
        self.jobs: dict[str, Job] = {}
        self.blobs: dict[tuple[str, str], bytes] = {}
        self.queued: list[tuple[str, str]] = []
        self.users: dict[str, User] = {}      # keyed like the real table

    # --- jobs
    def new_job_id(self) -> str:
        return f"{len(self.jobs):016x}"

    def put_job(self, job: Job) -> None:
        job.updated_at = utcnow()
        # Round-trip through JSON exactly as Table Storage does, so a field
        # that cannot survive serialization fails here rather than in prod.
        self.jobs[job.job_id] = Job.model_validate(
            json.loads(json.dumps(job.model_dump(mode="json"))))

    def get_job(self, user_id: str, job_id: str) -> Job | None:
        job = self.jobs.get(job_id)
        # Mirrors the real store: a job lives in its owner's partition, so
        # another user's id simply does not find it.
        return job if job and job.user_id == user_id else None

    def list_jobs(self, user_id: str, limit: int = 50) -> list[Job]:
        mine = [j for j in self.jobs.values() if j.user_id == user_id]
        return sorted(mine, key=lambda j: j.created_at, reverse=True)[:limit]

    # --- users
    def create_user(self, user: User) -> bool:
        k = email_key(user.email)
        if k in self.users:
            return False
        self.users[k] = user
        return True

    def get_user_by_email(self, email: str) -> User | None:
        return self.users.get(email_key(email))

    def update_user_password(self, user: User, password_hash: str) -> None:
        self.users[email_key(user.email)] = user.model_copy(
            update={"password_hash": password_hash})

    def new_user_id(self) -> str:
        return f"u{len(self.users):031x}"

    # --- blobs / queue
    def upload_sas(self, job_id, filename, content_type="video/mp4"):
        path = f"{job_id}/{filename}"
        return (f"https://fake.blob/uploads/{path}?sig=x", path,
                utcnow() + timedelta(minutes=30))

    def read_sas(self, container, path, hours=24):
        return f"https://fake.blob/{container}/{path}?sig=x"

    def blob_exists(self, container, path) -> bool:
        return (container, path) in self.blobs

    def blob_size(self, container, path):
        b = self.blobs.get((container, path))
        return None if b is None else len(b)

    def delete_blob(self, container, path) -> bool:
        return self.blobs.pop((container, path), None) is not None

    def delete_prefix(self, container, prefix) -> int:
        keys = [k for k in self.blobs if k[0] == container and k[1].startswith(prefix)]
        for k in keys:
            del self.blobs[k]
        return len(keys)

    def delete_job(self, job) -> None:
        self.jobs.pop(job.job_id, None)

    def read_json(self, container, path) -> dict:
        if (container, path) not in self.blobs:
            raise FileNotFoundError(path)
        return json.loads(self.blobs[(container, path)])

    def put_json(self, container, path, obj) -> None:
        self.blobs[(container, path)] = json.dumps(obj).encode()

    def enqueue(self, user_id, job_id) -> None:
        self.queued.append((user_id, job_id))

    def queue_depth(self) -> int:
        return len(self.queued)


@pytest.fixture
def store():
    return FakeStorage()


SIGNUP = {"email": "ada@example.com", "first_name": "Ada",
          "last_name": "Lovelace", "password": "Passw0rd!2026"}


@pytest.fixture
def signup():
    """The account the `client` fixture creates. A fixture rather than an
    import, since tests/ is not a package."""
    return dict(SIGNUP)


@pytest.fixture(autouse=True)
def _isolated_env(monkeypatch):
    """Tests never touch real storage.

    The app loads Backend/.env at import so it runs without a shell
    incantation. That also hands the test process a live connection string,
    and the lifespan's ensure_resources() would then create containers in the
    real account on every TestClient — slow, and it writes to production.
    Removing it makes that call fail fast, exactly as it did before; the
    storage dependency is overridden with a fake regardless.
    """
    monkeypatch.delenv("AZURE_STORAGE_CONNECTION_STRING", raising=False)
    monkeypatch.setenv("PONGAI_JWT_SECRET", "t" * 48)


@pytest.fixture(autouse=True)
def _fast_hashing(monkeypatch):
    """Argon2 at production strength costs ~100ms a call, and almost every
    test signs an account in. Weak parameters here keep the suite quick; the
    real cost factors stay untouched in core.auth."""
    from argon2 import PasswordHasher

    from pongai.core import auth
    monkeypatch.setattr(
        auth, "_hasher",
        PasswordHasher(time_cost=1, memory_cost=8, parallelism=1))


@pytest.fixture
def anon(store):
    """A client with no session."""
    app.dependency_overrides[deps.storage] = lambda: store
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


@pytest.fixture
def client(anon):
    """Signed in. Almost every route needs an account, so this is the default
    and `anon` is the exception."""
    r = anon.post("/api/auth/signup", json=SIGNUP)
    assert r.status_code == 201, r.text
    anon.headers["Authorization"] = f"Bearer {r.json()['access_token']}"
    return anon


@pytest.fixture
def user_id(store):
    """The id the `client` fixture's account gets."""
    return "u" + "0" * 31


@pytest.fixture
def probe():
    return {"size_bytes": 20_000_000, "duration_s": 60.0, "width": 1920,
            "height": 1080, "fps": 120.0, "source": "client"}


SHOT = {
    "rally_id": 0, "shot_index": 0, "player": "left", "frame": 100,
    "timestamp_s": 0.83, "shot_class": "attack", "class_confidence": 0.91,
    "technique": "loop", "abstain": False, "detect_confidence": 0.88,
    "backswing_amplitude": 1.2, "contact_height": 0.3, "elbow_angle": 110.0,
    "elbow_range": 60.0, "trunk_lean": 12.0, "trunk_rotation": 40.0,
    "table_distance": 1.8, "stance_width": 0.6, "knee_angle": 150.0,
    "peak_wrist_speed": 0.4, "time_to_peak": -2, "follow_through": 8.0,
    "recovery_time": 12.0, "rally_length": 4, "pose_confidence": 0.8,
    "detected": 1.0,
}


@pytest.fixture
def make_analysis():
    """The shots.json a finished worker run leaves in the outputs container."""
    def _make(n_shots: int = 2, fps: float = 120.0) -> dict:
        return {
            "meta": {"video_id": "v", "duration_s": 60.0, "source_fps": fps,
                     "width": 1600, "height": 900, "n_shots": n_shots,
                     "n_rallies": 1, "schema_version": 1},
            "shots": [dict(SHOT, shot_index=i) for i in range(n_shots)],
        }
    return _make
