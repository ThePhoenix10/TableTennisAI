#!/usr/bin/env python
"""Verify the storage account is reachable and correctly set up.

    python scripts/check_storage.py          # check only
    python scripts/check_storage.py --fix    # also create what is missing

Checks what the app actually depends on, in the order it would fail:
connection string -> account key (SAS signing) -> containers, queue, table ->
a real SAS round-trip -> CORS for browser-direct upload.

Prints no secrets.
"""
from __future__ import annotations

import os
import sys
import urllib.request

OK, BAD, WARN = "  ok  ", " FAIL ", " warn "
problems: list[str] = []


def line(tag: str, msg: str) -> None:
    print(f"[{tag}] {msg}")


def fail(msg: str, fix: str = "") -> None:
    line(BAD, msg)
    problems.append(fix or msg)


def main() -> int:
    from pongai.core.config import load_env

    load_env()   # so the script works without sourcing .env first
    do_fix = "--fix" in sys.argv

    cs = os.getenv("AZURE_STORAGE_CONNECTION_STRING")
    if not cs:
        fail("AZURE_STORAGE_CONNECTION_STRING is not set",
             "export AZURE_STORAGE_CONNECTION_STRING=... (see .env.example)")
        return report()

    parts = dict(p.split("=", 1) for p in cs.split(";") if "=" in p)
    account = parts.get("AccountName", "?")
    line(OK, f"connection string parsed, account '{account}'")

    if "AccountKey" not in cs:
        fail("connection string has no AccountKey",
             "SAS signing needs the key; use the key-based connection string")
        return report()
    line(OK, "AccountKey present (needed to sign SAS)")

    from pongai.core.storage import (
        DEMOS_CONTAINER, JOB_QUEUE, JOB_TABLE, OUTPUTS_CONTAINER,
        UPLOADS_CONTAINER, Storage,
    )

    try:
        store = Storage(cs)
    except Exception as e:
        fail(f"could not construct the client: {e}")
        return report()

    # --- reachability
    try:
        props = store.blob.get_service_properties()
        line(OK, "blob service reachable")
    except Exception as e:
        fail(f"blob service unreachable: {type(e).__name__}: {e}",
             "check the key is current and public network access is enabled")
        return report()

    if do_fix:
        store.ensure_resources()
        line(OK, "ensure_resources() ran")

    # --- containers / queue / table
    existing = {c.name for c in store.blob.list_containers()}
    for name in (UPLOADS_CONTAINER, OUTPUTS_CONTAINER, DEMOS_CONTAINER):
        if name in existing:
            line(OK, f"container '{name}'")
        else:
            fail(f"container '{name}' missing", "run with --fix")

    try:
        depth = store.queue_depth()
        line(OK, f"queue '{JOB_QUEUE}' ({depth} messages waiting)")
    except Exception:
        fail(f"queue '{JOB_QUEUE}' missing", "run with --fix")

    try:
        n = sum(1 for _ in store.table_svc.get_table_client(JOB_TABLE)
                .query_entities("PartitionKey ne ''", results_per_page=5))
        line(OK, f"table '{JOB_TABLE}' ({n} job rows)")
    except Exception:
        fail(f"table '{JOB_TABLE}' missing", "run with --fix")

    # --- the SAS round-trip the browser performs
    try:
        url, path, _ = store.upload_sas("0" * 16, "_healthcheck.bin")
        req = urllib.request.Request(
            url, data=b"ping", method="PUT",
            headers={"x-ms-blob-type": "BlockBlob",
                     "Content-Type": "video/mp4"})
        with urllib.request.urlopen(req, timeout=30) as r:
            assert r.status in (201, 202)
        size = store.blob_size(UPLOADS_CONTAINER, path)
        store.blob.get_blob_client(UPLOADS_CONTAINER, path).delete_blob()
        line(OK, f"SAS upload round-trip works ({size} bytes written, deleted)")
    except Exception as e:
        fail(f"SAS upload failed: {type(e).__name__}: {e}",
             "check 'Require secure transfer' and that the clock is not skewed")

    # --- CORS: needed because the browser PUTs straight to blob
    try:
        cors = props.get("cors") or []
        if not cors:
            fail("no CORS rules on the blob service",
                 "the browser cannot PUT directly; see the az command below")
        else:
            # allowed_origins comes back as a comma-separated STRING here,
            # not a list, so iterating it directly yields characters.
            origins = []
            for r in cors:
                raw = r.allowed_origins or []
                parts = raw.split(",") if isinstance(raw, str) else raw
                origins += [o.strip() for o in parts if o.strip()]
            origins = sorted(set(origins))
            line(OK, f"blob CORS configured for {origins}")
            if not any("localhost" in o or o == "*" for o in origins):
                line(WARN, "no localhost origin — local frontend uploads will "
                           "be blocked by the browser")
    except Exception as e:
        line(WARN, f"could not read CORS rules: {e}")

    return report()


def report() -> int:
    print()
    if problems:
        print(f"{len(problems)} problem(s):")
        for p in problems:
            print(f"  - {p}")
        return 1
    print("storage is ready")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
