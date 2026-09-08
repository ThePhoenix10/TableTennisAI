"""
pongai.worker.device — where the models run.

The pipeline was written against a T4 and said "cuda" in nine places, so it
could not start anywhere else: not on a CPU container, not on a laptop, not in
a test. That made the first real run of the pipeline necessarily also its first
run inside a GPU container, which is the worst place to debug one.

Resolution order:

    PONGAI_DEVICE   explicit wins, always
    auto            cuda when present, otherwise cpu

`mps` (Apple GPU) is never chosen automatically. Several ops in these models
fall back or behave differently there, and a silently wrong kinematic is worse
than a slow correct one — it has to be asked for by name.
"""
from __future__ import annotations

import functools
import logging
import os

log = logging.getLogger(__name__)


@functools.lru_cache(maxsize=1)
def torch_device() -> str:
    """'cuda' | 'cpu' | 'mps' — for torch and ultralytics."""
    want = os.getenv("PONGAI_DEVICE", "auto").lower()
    import torch

    if want != "auto":
        if want == "cuda" and not torch.cuda.is_available():
            raise RuntimeError(
                "PONGAI_DEVICE=cuda but no CUDA device is visible. Unset it to "
                "fall back to CPU.")
        log.info("device: %s (explicit)", want)
        return want

    chosen = "cuda" if torch.cuda.is_available() else "cpu"
    log.info("device: %s (auto)", chosen)
    return chosen


@functools.lru_cache(maxsize=1)
def onnx_device() -> str:
    """rtmlib takes its own device string for the ONNX session."""
    d = torch_device()
    return d if d in ("cuda", "mps") else "cpu"


def is_gpu() -> bool:
    return torch_device() != "cpu"
