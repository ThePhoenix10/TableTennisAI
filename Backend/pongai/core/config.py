"""
pongai.core.config — load a local .env, once.

In a container every setting arrives as a real environment variable and this
does nothing. Locally it removes a footgun: the app needs three variables, and
starting it without them produced a traceback halfway through a request rather
than a refusal at the door.

Real environment variables always win, so a container is never overridden by a
stray file.
"""
from __future__ import annotations

import logging
from pathlib import Path

log = logging.getLogger(__name__)

# Backend/ — three levels up from pongai/core/config.py
ENV_FILE = Path(__file__).resolve().parents[2] / ".env"


def load_env() -> None:
    if not ENV_FILE.exists():
        return
    try:
        from dotenv import load_dotenv
    except ModuleNotFoundError:      # not installed in the slim images
        return
    load_dotenv(ENV_FILE, override=False)
    log.debug("loaded %s", ENV_FILE)
