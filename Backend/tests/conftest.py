"""A fake Storage so the API can be tested without Azure.

Everything the routes touch goes through the `storage()` dependency, so one
override covers all eleven endpoints.
"""
from __future__ import annotations

import json
from datetime import timedelta

import pytest
from fastapi.testclient import TestClient

from pongai.api import deps
from pongai.api.main import app
from pongai.core.schema import Job, utcnow


class FakeStorage:
    def __init__(self):
        self.jobs: dict[str, Job] = {}
        self.blobs: dict[tuple[str, str], bytes] = {}
        self.queued: list[str] = []

    # --- jobs
    def new_job_id(self) -> str:
        return f"{len(self.jobs):016x}"

    def put_job(self, job: Job) -> None:
        job.updated_at = utcnow()
        # Round-trip through JSON exactly as Table Storage does, so a field
        # that cannot survive serialization fails here rather than in prod.
        self.jobs[job.job_id] = Job.model_validate(
            json.loads(json.dumps(job.model_dump(mode="json"))))

    def get_job(self, job_id: str) -> Job | None:
        return self.jobs.get(job_id)

    def list_jobs(self, limit: int = 50) -> list[Job]:
        return sorted(self.jobs.values(),
                      key=lambda j: j.created_at, reverse=True)[:limit]

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

    def enqueue(self, job_id) -> None:
        self.queued.append(job_id)

    def queue_depth(self) -> int:
        return len(self.queued)


@pytest.fixture
def store():
    return FakeStorage()


@pytest.fixture
def client(store):
    app.dependency_overrides[deps.storage] = lambda: store
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


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
