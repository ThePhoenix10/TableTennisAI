"""API surface: error envelope, path validation, warnings, contract fields.

No Azure. The `storage()` dependency is overridden with an in-memory fake,
which round-trips every job through JSON the way Table Storage does.
"""
import json

import pytest

from pongai.core.schema import Job, JobStatus, utcnow
from pongai.core.storage import DEMOS_CONTAINER, OUTPUTS_CONTAINER, UPLOADS_CONTAINER
from pongai.core.validation import Severity


# =============================================================================
# Error envelope — every failure has one shape
# =============================================================================

@pytest.mark.parametrize("method,path,body", [
    ("get", "/api/jobs/0123456789abcdef", None),
    ("get", "/api/analyses/0123456789abcdef", None),
    ("get", "/api/demos/nope", None),
    ("post", "/api/jobs/0123456789abcdef/submit", None),
    ("post", "/api/uploads", {"filename": "x.mp4", "size_bytes": 999_000_000}),
])
def test_errors_share_one_envelope(client, method, path, body):
    r = getattr(client, method)(path, **({"json": body} if body else {}))
    assert r.status_code >= 400
    err = r.json()["error"]
    assert isinstance(err["code"], str) and err["code"]
    assert isinstance(err["message"], str) and err["message"]


def test_request_validation_is_enveloped_too(client):
    r = client.post("/api/uploads", json={"filename": "x.mp4"})   # no size
    assert r.status_code == 422
    assert r.json()["error"]["code"] == "invalid_request"


# =============================================================================
# Path validation — malformed ids must not reach the OData filter
# =============================================================================

@pytest.mark.parametrize("bad", [
    "'", "x' or RowKey ne '", "ABCDEF0123456789", "short", "0123456789abcdeg",
    "0123456789abcdef0",
])
def test_malformed_job_id_is_404_not_500(client, bad):
    """A quote here used to reach the Table Storage OData filter verbatim."""
    r = client.get(f"/api/jobs/{bad}")
    assert r.status_code == 404, r.text
    assert r.json()["error"]["code"] == "job_not_found"


def test_malformed_demo_id_rejected(client):
    assert client.get("/api/demos/..%2Fsecrets").status_code == 404


# =============================================================================
# Warnings survive to the client
# =============================================================================

def test_30fps_upload_returns_a_warning_not_a_rejection(client, probe, store):
    r = client.post("/api/uploads", json={
        "filename": "clip.mp4", "size_bytes": probe["size_bytes"],
        "probe": {**probe, "fps": 30.0}})
    assert r.status_code == 200, r.text
    warnings = r.json()["warnings"]
    assert len(warnings) == 1
    assert warnings[0]["severity"] == Severity.WARN.value
    assert "swing-speed" in warnings[0]["message"]
    # and it is persisted, so the poll endpoint and the stream can replay it
    job = store.get_job(r.json()["job_id"])
    assert len(job.warnings) == 1


def test_120fps_upload_has_no_warnings(client, probe):
    r = client.post("/api/uploads", json={
        "filename": "clip.mp4", "size_bytes": probe["size_bytes"],
        "probe": probe})
    assert r.status_code == 200 and r.json()["warnings"] == []


def test_blocking_probe_is_rejected_with_all_reasons(client):
    r = client.post("/api/uploads", json={
        "filename": "clip.mp4", "size_bytes": 20_000_000,
        "probe": {"size_bytes": 20_000_000, "duration_s": 900.0,
                  "width": 1080, "height": 1920, "fps": 24.0}})
    assert r.status_code == 422
    codes = {x["code"] for x in r.json()["error"]["rejections"]}
    # all problems at once, not just the first
    assert {"too_long", "fps_too_low", "aspect_vertical"} <= codes


# =============================================================================
# Contract fields the frontend would otherwise have to re-derive
# =============================================================================

def test_limits_serves_model_capability(client):
    payload = client.get("/api/limits").json()
    m = payload["model"]
    assert m["class_precision"]["defence"] == 0.556
    assert m["coachable_classes"] == ["attack", "serve"]
    assert "peak_wrist_speed" in m["velocity_kinematics"]
    assert "peak_wrist_speed" not in m["position_kinematics"]
    # the threshold that gates them appears once, at the top level
    assert payload["velocity_min_fps"] == 60


@pytest.mark.parametrize("fps,expected", [(120.0, True), (30.0, False)])
def test_analysis_serves_velocity_reliable(client, store, make_analysis, fps, expected):
    jid = "0123456789abcdef"
    store.put_job(Job(job_id=jid, status=JobStatus.DONE, created_at=utcnow(),
                      updated_at=utcnow()))
    store.put_json(OUTPUTS_CONTAINER, f"{jid}/shots.json",
                   make_analysis(fps=fps))
    r = client.get(f"/api/analyses/{jid}")
    assert r.status_code == 200, r.text
    assert r.json()["meta"]["velocity_reliable"] is expected
    # signed URLs expire, so this must never be cached
    assert "no-store" in r.headers["cache-control"]


def test_job_serves_is_terminal(client, store):
    jid = "0123456789abcdef"
    store.put_job(Job(job_id=jid, status=JobStatus.PROCESSING,
                      created_at=utcnow(), updated_at=utcnow()))
    assert client.get(f"/api/jobs/{jid}").json()["is_terminal"] is False


def test_analysis_409_while_running(client, store):
    jid = "0123456789abcdef"
    store.put_job(Job(job_id=jid, status=JobStatus.PROCESSING, progress=0.4,
                      created_at=utcnow(), updated_at=utcnow()))
    r = client.get(f"/api/analyses/{jid}")
    assert r.status_code == 409
    assert r.json()["error"]["context"]["progress"] == 0.4


# =============================================================================
# Upload -> submit
# =============================================================================

def _create(client, store, probe, size=20_000_000):
    r = client.post("/api/uploads", json={
        "filename": "clip.mp4", "size_bytes": size, "probe": probe})
    assert r.status_code == 200, r.text
    return r.json()


def test_submit_requires_the_blob_to_exist(client, store, probe):
    up = _create(client, store, probe)
    r = client.post(f"/api/jobs/{up['job_id']}/submit")
    assert r.status_code == 400
    assert r.json()["error"]["code"] == "upload_missing"


def test_submit_enqueues_once_and_is_idempotent(client, store, probe):
    up = _create(client, store, probe)
    store.blobs[(UPLOADS_CONTAINER, up["blob_path"])] = b"x" * 20_000_000
    assert client.post(f"/api/jobs/{up['job_id']}/submit").status_code == 200
    assert client.post(f"/api/jobs/{up['job_id']}/submit").status_code == 200
    assert store.queued == [up["job_id"]]


def test_truncated_upload_is_caught_at_submit(client, store, probe):
    up = _create(client, store, probe)
    store.blobs[(UPLOADS_CONTAINER, up["blob_path"])] = b"x" * 5_000
    r = client.post(f"/api/jobs/{up['job_id']}/submit")
    assert r.status_code == 400
    assert r.json()["error"]["code"] == "upload_incomplete"
    assert store.get_job(up["job_id"]).status == JobStatus.REJECTED


def test_filename_with_path_separator_rejected(client):
    r = client.post("/api/uploads",
                    json={"filename": "../../etc/passwd", "size_bytes": 1000})
    assert r.status_code == 422


# =============================================================================
# Demos — same shape as a real analysis, and no dead links
# =============================================================================

def test_demo_matches_the_analysis_shape(client, store, make_analysis):
    store.put_json(DEMOS_CONTAINER, "match1/shots.json", make_analysis())
    for name in ("video.mp4", "track.json", "track.bin", "thumb.jpg"):
        store.blobs[(DEMOS_CONTAINER, f"match1/{name}")] = b"x"
    r = client.get("/api/demos/match1")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["is_demo"] is True
    assert body["meta"]["velocity_reliable"] is True
    assert len(body["shots"]) == 2
    # every key of a real analysis is present
    assert {"meta", "shots", "video_url", "track_url",
            "track_bin_url", "thumb_url"} <= set(body)


def test_demo_index_omits_entries_with_no_video(client, store):
    store.put_json(DEMOS_CONTAINER, "index.json",
                   {"demos": [{"id": "ghost", "title": "Missing"},
                              {"id": "real", "title": "There"}]})
    store.blobs[(DEMOS_CONTAINER, "real/video.mp4")] = b"x"
    rows = client.get("/api/demos").json()
    assert [d["id"] for d in rows] == ["real"]
    assert rows[0]["title"] == "There"          # index extras pass through
    assert rows[0]["thumb_url"] is None         # not signed, it does not exist


def test_demos_empty_without_an_index(client):
    assert client.get("/api/demos").json() == []


# =============================================================================
# Health / readiness
# =============================================================================

def test_health_does_not_touch_storage(client, store):
    def boom():
        raise RuntimeError("storage down")
    store.queue_depth = boom
    assert client.get("/api/health").status_code == 200
    assert client.get("/api/ready").status_code == 503


def test_root_redirects_to_docs(client):
    r = client.get("/", follow_redirects=False)
    assert r.status_code == 307 and r.headers["location"] == "/docs"


# =============================================================================
# SSE stream
# =============================================================================

def _sse(client, path, timeout=10.0):
    """Read one SSE response to completion and parse it into (event, data)."""
    events = []
    with client.stream("GET", path, timeout=timeout) as r:
        assert r.status_code == 200
        assert r.headers["content-type"].startswith("text/event-stream")
        assert r.headers["x-accel-buffering"] == "no"
        name = None
        for line in r.iter_lines():
            if line.startswith("event: "):
                name = line[7:]
            elif line.startswith("data: "):
                events.append((name, json.loads(line[6:])))
    return events


def _put(store, jid, **kw):
    store.put_job(Job(job_id=jid, created_at=utcnow(), updated_at=utcnow(),
                      **kw))


def test_stream_emits_status_then_done(client, store):
    jid = "0123456789abcdef"
    _put(store, jid, status=JobStatus.DONE, progress=1.0)
    events = _sse(client, f"/api/jobs/{jid}/stream")
    assert [e for e, _ in events] == ["status", "done"]
    status = events[0][1]
    assert status["progress"] == 1.0
    assert status["message"] == "Analysis complete."
    assert events[1][1]["analysis_url"] == f"/api/analyses/{jid}"


def test_stream_replays_warnings_before_the_wait(client, store, probe):
    """A 30fps user must learn swing speed is missing now, not in 30 minutes."""
    up = client.post("/api/uploads", json={
        "filename": "c.mp4", "size_bytes": probe["size_bytes"],
        "probe": {**probe, "fps": 30.0}}).json()
    job = store.get_job(up["job_id"])
    job.status = JobStatus.DONE
    store.put_job(job)

    events = _sse(client, f"/api/jobs/{up['job_id']}/stream")
    kinds = [e for e, _ in events]
    assert kinds[0] == "warning"
    assert "swing-speed" in events[0][1]["warnings"][0]["message"]


def test_stream_error_carries_rejections(client, store):
    from pongai.core.validation import Rejection, RejectionCode
    jid = "0123456789abcdef"
    _put(store, jid, status=JobStatus.REJECTED, rejections=[Rejection(
        code=RejectionCode.NO_TABLE, message="No table found.")])
    events = _sse(client, f"/api/jobs/{jid}/stream")
    name, data = events[-1]
    assert name == "error"
    assert data["rejections"][0]["code"] == "no_table"


def test_stream_reports_a_missing_job_instead_of_hanging(client):
    events = _sse(client, "/api/jobs/ffffffffffffffff/stream")
    assert events == [("error", {"code": "job_not_found",
                                 "message": "Job ffffffffffffffff not found."})]


def test_stream_sets_the_client_retry_interval(client, store):
    jid = "0123456789abcdef"
    _put(store, jid, status=JobStatus.DONE)
    with client.stream("GET", f"/api/jobs/{jid}/stream") as r:
        body = "".join(r.iter_text())
    assert body.startswith("retry: 3000")


def test_stream_survives_a_transient_storage_failure(client, store):
    """A 40-minute stream must not die on one bad table read."""
    jid = "0123456789abcdef"
    _put(store, jid, status=JobStatus.DONE)
    real, calls = store.get_job, {"n": 0}

    def flaky(job_id):
        calls["n"] += 1
        if calls["n"] == 1:
            raise RuntimeError("transient")
        return real(job_id)

    store.get_job = flaky
    events = _sse(client, f"/api/jobs/{jid}/stream")
    assert [e for e, _ in events] == ["status", "done"]
    assert calls["n"] == 2


def test_worker_warning_reaches_the_browser(client, store):
    """The full path for the authoritative warning: the worker's ffprobe finds
    a 30fps clip, writes it to the job table, and the API's stream replays it.
    The API's own copy comes from the client's advisory probe, so this is the
    one that survives a client that probed wrongly or not at all."""
    from pongai.core.progress import ProgressReporter
    from pongai.core.validation import VideoProbe, validate_probe

    jid = "0123456789abcdef"
    _put(store, jid, status=JobStatus.QUEUED)

    job = store.get_job(jid)
    rep = ProgressReporter(storage=store, job=job)
    rep.warn(validate_probe(VideoProbe(
        size_bytes=50_000_000, duration_s=180, width=1920, height=1080,
        fps=30, n_frames=5400, source="ffprobe")))
    rep.done()

    events = _sse(client, f"/api/jobs/{jid}/stream")
    name, data = events[0]
    assert name == "warning"
    assert data["warnings"][0]["code"] == "velocity_unavailable"
    assert data["warnings"][0]["severity"] == "warn"
    assert [e for e, _ in events] == ["warning", "status", "done"]


# =============================================================================
# Retry
# =============================================================================

def _failed(store, jid="0123456789abcdef", *, attempts=1, filename="c.mp4",
            with_blob=True, **kw):
    _put(store, jid, status=JobStatus.FAILED, filename=filename,
         attempts=attempts, error_code="RuntimeError",
         error_message="no shots detected", progress=0.83, **kw)
    if with_blob:
        store.blobs[(UPLOADS_CONTAINER, f"{jid}/{filename}")] = b"x" * 1000
    return jid


def test_retry_requeues_the_same_job_id(client, store):
    jid = _failed(store)
    r = client.post(f"/api/jobs/{jid}/retry")
    assert r.status_code == 200, r.text
    assert r.json()["job_id"] == jid          # the id is stable
    assert r.json()["status"] == "queued"
    assert store.queued == [jid]              # re-enqueued, not re-uploaded


def test_retry_clears_the_previous_attempt(client, store):
    jid = _failed(store)
    client.post(f"/api/jobs/{jid}/retry")
    job = store.get_job(jid)
    assert job.status == JobStatus.QUEUED
    assert job.attempts == 2
    assert job.error_code is None and job.error_message is None
    assert job.progress == 0.0 and job.stage is None
    assert job.finished_at is None
    assert job.filename == "c.mp4"            # what describes the FILE stays


def test_retry_does_not_require_a_re_upload(client, store):
    jid = _failed(store)
    before = dict(store.blobs)
    client.post(f"/api/jobs/{jid}/retry")
    assert store.blobs == before


def test_stream_still_works_on_the_same_id_after_retry(client, store):
    """The client's existing stream URL must keep working — that is the point
    of reusing the id."""
    jid = _failed(store)
    client.post(f"/api/jobs/{jid}/retry")
    job = store.get_job(jid)
    job.status = JobStatus.DONE
    store.put_job(job)
    assert [e for e, _ in _sse(client, f"/api/jobs/{jid}/stream")][-1] == "done"


def test_rejected_jobs_cannot_be_retried(client, store):
    """Validation is deterministic; another attempt reaches the same answer."""
    from pongai.core.validation import Rejection, RejectionCode
    jid = "0123456789abcdef"
    _put(store, jid, status=JobStatus.REJECTED, attempts=1, filename="c.mp4",
         rejections=[Rejection(code=RejectionCode.NO_TABLE,
                               message="No table found.")])
    store.blobs[(UPLOADS_CONTAINER, f"{jid}/c.mp4")] = b"x"
    r = client.post(f"/api/jobs/{jid}/retry")
    assert r.status_code == 409
    assert r.json()["error"]["code"] == "not_retryable"
    assert r.json()["error"]["rejections"][0]["code"] == "no_table"
    assert store.queued == []


def test_finished_jobs_cannot_be_retried(client, store):
    jid = "0123456789abcdef"
    _put(store, jid, status=JobStatus.DONE, attempts=1, filename="c.mp4")
    r = client.post(f"/api/jobs/{jid}/retry")
    assert r.status_code == 409
    assert r.json()["error"]["code"] == "already_done"


def test_a_running_job_cannot_be_retried(client, store):
    jid = "0123456789abcdef"
    _put(store, jid, status=JobStatus.PROCESSING, attempts=1, filename="c.mp4",
         progress=0.5)
    r = client.post(f"/api/jobs/{jid}/retry")
    assert r.status_code == 409
    assert r.json()["error"]["code"] == "still_running"
    assert store.queued == []


def test_a_stalled_job_can_be_retried(client, store):
    """A replica killed mid-run leaves PROCESSING with nothing to move it.
    The reporter writes every 2s, so silence this long means it is gone."""
    from datetime import timedelta
    jid = "0123456789abcdef"
    _put(store, jid, status=JobStatus.PROCESSING, attempts=1, filename="c.mp4")
    stuck = store.get_job(jid)
    stuck.updated_at = utcnow() - timedelta(hours=2)
    store.jobs[jid] = stuck                    # bypass put_job's timestamp
    store.blobs[(UPLOADS_CONTAINER, f"{jid}/c.mp4")] = b"x"

    assert client.post(f"/api/jobs/{jid}/retry").status_code == 200
    assert store.queued == [jid]


def test_retries_are_capped(client, store):
    jid = _failed(store, attempts=3)
    r = client.post(f"/api/jobs/{jid}/retry")
    assert r.status_code == 409
    assert r.json()["error"]["code"] == "attempts_exhausted"
    assert r.json()["error"]["context"]["max_attempts"] == 3
    assert store.queued == []


def test_retry_stops_after_the_cap_is_reached(client, store):
    """One upload must not be able to burn GPU time indefinitely."""
    jid = _failed(store, attempts=1)
    for _ in range(5):
        if client.post(f"/api/jobs/{jid}/retry").status_code != 200:
            break
        job = store.get_job(jid)              # worker fails it again
        job.status = JobStatus.FAILED
        store.put_job(job)
    assert store.get_job(jid).attempts == 3
    assert len(store.queued) == 2             # attempts 2 and 3


def test_retry_reports_an_expired_upload_clearly(client, store):
    """Raw uploads are deleted after 7 days, so a job outlives its source."""
    jid = _failed(store, with_blob=False)
    r = client.post(f"/api/jobs/{jid}/retry")
    assert r.status_code == 410
    assert r.json()["error"]["code"] == "source_expired"
    assert "7 days" in r.json()["error"]["message"]
    assert store.queued == []


def test_can_retry_is_served_so_the_ui_can_show_the_button(client, store):
    jid = _failed(store)
    assert client.get(f"/api/jobs/{jid}").json()["can_retry"] is True
    assert client.get(f"/api/jobs/{jid}").json()["attempts"] == 1

    _put(store, "1123456789abcdef", status=JobStatus.PROCESSING, attempts=1)
    assert client.get("/api/jobs/1123456789abcdef").json()["can_retry"] is False


def test_retry_on_an_unknown_job_is_404(client):
    assert client.post("/api/jobs/ffffffffffffffff/retry").status_code == 404


# =============================================================================
# Source playback + delete
# =============================================================================

def test_source_returns_a_signed_link_to_the_upload(client, store):
    jid = "0123456789abcdef"
    _put(store, jid, status=JobStatus.AWAITING_UPLOAD, filename="c.mp4",
         size_bytes=2048)
    store.blobs[(UPLOADS_CONTAINER, f"{jid}/c.mp4")] = b"x" * 2048

    r = client.get(f"/api/jobs/{jid}/source")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["job_id"] == jid
    assert body["filename"] == "c.mp4"
    assert f"{jid}/c.mp4" in body["url"]
    assert body["expires_in_s"] == 2 * 3600


def test_source_is_available_before_any_analysis(client, store):
    """The whole point: /analyses/{id} needs status==done, this does not."""
    jid = "0123456789abcdef"
    _put(store, jid, status=JobStatus.AWAITING_UPLOAD, filename="c.mp4")
    store.blobs[(UPLOADS_CONTAINER, f"{jid}/c.mp4")] = b"x"
    assert client.get(f"/api/jobs/{jid}/source").status_code == 200
    assert client.get(f"/api/analyses/{jid}").status_code == 409


def test_source_410_when_the_upload_never_landed(client, store):
    jid = "0123456789abcdef"
    _put(store, jid, status=JobStatus.AWAITING_UPLOAD, filename="c.mp4")
    r = client.get(f"/api/jobs/{jid}/source")
    assert r.status_code == 410
    assert r.json()["error"]["code"] == "source_unavailable"


def test_delete_removes_the_row_and_every_blob(client, store):
    jid = "0123456789abcdef"
    _put(store, jid, status=JobStatus.DONE, filename="c.mp4")
    store.blobs[(UPLOADS_CONTAINER, f"{jid}/c.mp4")] = b"x"
    for name in ("video.mp4", "shots.json", "track.json", "track.bin", "thumb.jpg"):
        store.blobs[(OUTPUTS_CONTAINER, f"{jid}/{name}")] = b"x"
    store.blobs[(UPLOADS_CONTAINER, "ffffffffffffffff/other.mp4")] = b"keep"

    assert client.delete(f"/api/jobs/{jid}").status_code == 204
    assert store.get_job(jid) is None
    assert not any(jid in path for _, path in store.blobs)
    # a neighbouring job is untouched
    assert (UPLOADS_CONTAINER, "ffffffffffffffff/other.mp4") in store.blobs


def test_delete_is_gone_from_the_list_afterwards(client, store):
    jid = "0123456789abcdef"
    _put(store, jid, status=JobStatus.AWAITING_UPLOAD, filename="c.mp4")
    assert len(client.get("/api/jobs").json()) == 1
    client.delete(f"/api/jobs/{jid}")
    assert client.get("/api/jobs").json() == []


def test_delete_refuses_while_a_worker_is_running(client, store):
    """Deleting the blob mid-pipeline produces a confusing failure 20 minutes
    later rather than an error here."""
    jid = "0123456789abcdef"
    _put(store, jid, status=JobStatus.PROCESSING, filename="c.mp4", progress=0.4)
    r = client.delete(f"/api/jobs/{jid}")
    assert r.status_code == 409
    assert r.json()["error"]["code"] == "job_busy"
    assert store.get_job(jid) is not None


def test_delete_allows_a_stalled_job(client, store):
    from datetime import timedelta
    jid = "0123456789abcdef"
    _put(store, jid, status=JobStatus.PROCESSING, filename="c.mp4")
    stuck = store.get_job(jid)
    stuck.updated_at = utcnow() - timedelta(hours=2)
    store.jobs[jid] = stuck
    assert client.delete(f"/api/jobs/{jid}").status_code == 204


def test_delete_on_an_unknown_job_is_404(client):
    assert client.delete("/api/jobs/ffffffffffffffff").status_code == 404


def test_source_on_an_unknown_job_is_404(client):
    assert client.get("/api/jobs/ffffffffffffffff/source").status_code == 404


# =============================================================================
# CORS
# =============================================================================

def test_cors_allows_every_method_the_api_exposes(client):
    """The browser preflights any non-simple method, and CORSMiddleware
    answers an unlisted one with '400 Disallowed CORS method' — which reads
    like a malformed request, not a configuration gap. DELETE was missing from
    the allow-list for exactly as long as it took someone to click Delete.
    """
    from pongai.api.main import app

    exposed = {
        m
        for path in app.openapi()["paths"].values()
        for m in path
        if m.upper() not in ("HEAD", "OPTIONS")
    }
    for method in exposed:
        r = client.options(
            "/api/jobs/0123456789abcdef",
            headers={
                "Origin": "http://localhost:3000",
                "Access-Control-Request-Method": method.upper(),
            },
        )
        assert r.status_code == 200, f"{method.upper()} preflight: {r.text}"


def test_cors_still_refuses_a_method_the_api_does_not_expose(client):
    r = client.options(
        "/api/jobs/0123456789abcdef",
        headers={
            "Origin": "http://localhost:3000",
            "Access-Control-Request-Method": "PATCH",
        },
    )
    assert r.status_code == 400
