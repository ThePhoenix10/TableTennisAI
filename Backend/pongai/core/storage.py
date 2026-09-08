"""
pongai.core.storage — Azure Blob, Queue and Table access.

Uploads go browser -> blob directly via SAS. A 100MB body never passes through
the API: it would be slow, consume a worker for the duration, and hit request
size limits.
"""
from __future__ import annotations

import json
import os
import re
import uuid
from datetime import datetime, timedelta

from azure.core.exceptions import ResourceExistsError, ResourceNotFoundError
from azure.data.tables import TableServiceClient
from azure.storage.blob import (
    BlobSasPermissions,
    BlobServiceClient,
    ContentSettings,
    generate_blob_sas,
)
from azure.storage.queue import QueueClient, QueueServiceClient

from pongai.core.schema import Job, utcnow
from pongai.core.validation import Limits

UPLOADS_CONTAINER = "uploads"
OUTPUTS_CONTAINER = "outputs"
DEMOS_CONTAINER = "demos"
JOB_QUEUE = "analysis-jobs"
JOB_TABLE = "jobs"

# Job ids are `uuid4().hex[:16]`. Enforced here rather than only at the API
# edge because the worker reaches get_job with the queue message body, which
# never passes through a route — and the id is interpolated into an OData
# filter below, where a quote would change the query.
JOB_ID_RE = re.compile(r"^[0-9a-f]{16}$")


def is_job_id(value: str) -> bool:
    return bool(JOB_ID_RE.fullmatch(value or ""))


class Storage:
    def __init__(self, connection_string: str | None = None):
        cs = connection_string or os.environ["AZURE_STORAGE_CONNECTION_STRING"]
        self._cs = cs
        self.blob = BlobServiceClient.from_connection_string(cs)
        self.queue_svc = QueueServiceClient.from_connection_string(cs)
        self.table_svc = TableServiceClient.from_connection_string(cs)

        # account key is needed to sign SAS tokens
        self._account_name = self.blob.account_name
        self._account_key = next(
            (p.split("=", 1)[1] for p in cs.split(";")
             if p.startswith("AccountKey=")), None)
        if not self._account_key:
            raise ValueError(
                "connection string has no AccountKey — required to sign SAS")

    # --- one-time setup ------------------------------------------------------
    def ensure_resources(self) -> None:
        for name in (UPLOADS_CONTAINER, OUTPUTS_CONTAINER, DEMOS_CONTAINER):
            try:
                self.blob.create_container(name)
            except ResourceExistsError:
                pass
        try:
            self.queue_svc.create_queue(JOB_QUEUE)
        except ResourceExistsError:
            pass
        try:
            self.table_svc.create_table(JOB_TABLE)
        except ResourceExistsError:
            pass

    # =========================================================================
    # SAS
    # =========================================================================
    def upload_sas(self, job_id: str, filename: str,
                   content_type: str = "video/mp4") -> tuple[str, str, datetime]:
        """SAS for the browser to PUT one specific blob.

        Scoped to a single path with create+write only, and short-lived. It
        cannot read, delete, or touch any other blob.
        """
        blob_path = f"{job_id}/{filename}"
        expires = utcnow() + timedelta(minutes=Limits.SAS_EXPIRY_MINUTES)

        token = generate_blob_sas(
            account_name=self._account_name,
            container_name=UPLOADS_CONTAINER,
            blob_name=blob_path,
            account_key=self._account_key,
            permission=BlobSasPermissions(create=True, write=True),
            expiry=expires,
            content_type=content_type,
        )
        url = (f"https://{self._account_name}.blob.core.windows.net/"
               f"{UPLOADS_CONTAINER}/{blob_path}?{token}")
        return url, blob_path, expires

    def read_sas(self, container: str, blob_path: str,
                 hours: int = 24) -> str:
        """Read-only SAS for the frontend to fetch a result."""
        expires = utcnow() + timedelta(hours=hours)
        token = generate_blob_sas(
            account_name=self._account_name,
            container_name=container,
            blob_name=blob_path,
            account_key=self._account_key,
            permission=BlobSasPermissions(read=True),
            expiry=expires,
        )
        return (f"https://{self._account_name}.blob.core.windows.net/"
                f"{container}/{blob_path}?{token}")

    # =========================================================================
    # Blobs
    # =========================================================================
    def blob_exists(self, container: str, path: str) -> bool:
        try:
            return self.blob.get_blob_client(container, path).exists()
        except ResourceNotFoundError:
            return False

    def blob_size(self, container: str, path: str) -> int | None:
        try:
            return self.blob.get_blob_client(container, path) \
                       .get_blob_properties().size
        except ResourceNotFoundError:
            return None

    def delete_blob(self, container: str, path: str) -> bool:
        """Returns whether anything was there to delete."""
        try:
            self.blob.get_blob_client(container, path).delete_blob()
            return True
        except ResourceNotFoundError:
            return False

    def delete_prefix(self, container: str, prefix: str) -> int:
        """Delete every blob under a prefix. Used to drop a job's outputs,
        which are five separate blobs under `{job_id}/`."""
        client = self.blob.get_container_client(container)
        n = 0
        for b in client.list_blobs(name_starts_with=prefix):
            try:
                client.delete_blob(b.name)
                n += 1
            except ResourceNotFoundError:
                pass
        return n

    def read_json(self, container: str, path: str) -> dict:
        data = self.blob.get_blob_client(container, path).download_blob().readall()
        return json.loads(data)

    def download(self, container: str, path: str, dest: str) -> None:
        with open(dest, "wb") as f:
            f.write(self.blob.get_blob_client(container, path)
                        .download_blob().readall())

    def upload(self, container: str, path: str, local: str,
               content_type: str | None = None) -> None:
        with open(local, "rb") as f:
            self.blob.get_blob_client(container, path).upload_blob(
                f, overwrite=True,
                content_settings=ContentSettings(content_type=content_type)
                if content_type else None)

    # =========================================================================
    # Queue
    # =========================================================================
    def enqueue(self, job_id: str) -> None:
        self._queue().send_message(job_id)

    def queue_depth(self) -> int:
        return self._queue().get_queue_properties().approximate_message_count or 0

    def receive_messages(self, max_messages: int, visibility_s: int):
        """Lease up to `max_messages` job ids.

        `visibility_s` must exceed the container job's replica timeout, or a
        long run makes its own message visible again while it is still going
        and a second replica repeats the work.
        """
        return self._queue().receive_messages(
            messages_per_page=max_messages, visibility_timeout=visibility_s)

    def delete_message(self, message) -> None:
        self._queue().delete_message(message)

    def _queue(self) -> QueueClient:
        return self.queue_svc.get_queue_client(JOB_QUEUE)

    # =========================================================================
    # Jobs (Table Storage)
    # =========================================================================
    # PartitionKey is a coarse date bucket so listing recent jobs is a single
    # partition scan rather than a full table scan.
    def _entity(self, job: Job) -> dict:
        d = job.model_dump(mode="json")
        return {
            "PartitionKey": job.created_at.strftime("%Y-%m"),
            "RowKey": job.job_id,
            "payload": json.dumps(d),
            "status": job.status.value,
            "created_at": job.created_at.isoformat(),
        }

    def put_job(self, job: Job) -> None:
        job.updated_at = utcnow()
        self.table_svc.get_table_client(JOB_TABLE) \
            .upsert_entity(self._entity(job))

    def get_job(self, job_id: str) -> Job | None:
        if not is_job_id(job_id):
            return None
        client = self.table_svc.get_table_client(JOB_TABLE)
        # RowKey is unique; partition is unknown without the creation month.
        # `next` rather than `list`: results_per_page is a page SIZE, not a
        # limit, so list() walked every matching row one HTTP request at a
        # time. This is polled every 2s per open SSE stream.
        row = next(iter(client.query_entities(
            f"RowKey eq '{job_id}'", results_per_page=1)), None)
        return Job.model_validate(json.loads(row["payload"])) if row else None

    def delete_job(self, job: Job) -> None:
        """Remove the job row. Its blobs are removed separately by the caller,
        blobs first — a row with no blobs is recoverable noise, whereas blobs
        with no row are invisible and bill forever."""
        self.table_svc.get_table_client(JOB_TABLE).delete_entity(
            job.created_at.strftime("%Y-%m"), job.job_id)

    def list_jobs(self, limit: int = 50) -> list[Job]:
        """Recent jobs, newest first.

        Spans two month partitions. Querying only the current one meant that
        at 00:00 on the 1st every job silently vanished from the history page.
        """
        client = self.table_svc.get_table_client(JOB_TABLE)
        now = utcnow()
        prev = (now.replace(day=1) - timedelta(days=1))
        parts = {now.strftime("%Y-%m"), prev.strftime("%Y-%m")}
        flt = " or ".join(f"PartitionKey eq '{p}'" for p in sorted(parts))

        jobs = []
        for row in client.query_entities(flt, results_per_page=min(limit, 100)):
            jobs.append(Job.model_validate(json.loads(row["payload"])))
        return sorted(jobs, key=lambda j: j.created_at, reverse=True)[:limit]

    def new_job_id(self) -> str:
        return uuid.uuid4().hex[:16]


_storage: Storage | None = None


def get_storage() -> Storage:
    global _storage
    if _storage is None:
        _storage = Storage()
    return _storage
