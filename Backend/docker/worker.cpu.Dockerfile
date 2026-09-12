# Worker — CPU. Runs to completion and exits.
#
# The GPU image (worker.Dockerfile) is FROM nvidia/cuda:12.4.1-runtime and
# installs a CUDA torch wheel plus onnxruntime-gpu: ~4-6 GB, nearly all of it
# CUDA libraries that a CPU node can never use. Image size IS cold-start
# latency when the job scales to zero, so the CPU build starts from slim and
# takes the CPU wheels instead.
#
# Keep the two in step. They differ only in base image, wheel index and
# PONGAI_DEVICE; the application code and weights are identical.
FROM python:3.11-slim

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    # No CUDA here. `auto` would resolve to cpu anyway, but saying so keeps a
    # misconfigured node from silently running 40x slower than intended.
    PONGAI_DEVICE=cpu

# ffmpeg for probing and encoding; libgl/libglib for OpenCV.
RUN apt-get update && apt-get install -y --no-install-recommends \
      ffmpeg libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Heavy layers first so code changes do not invalidate them.
#
# torchvision MUST come from the same index and the same install as torch.
# Ultralytics needs it for NMS, and left to pip it resolves from PyPI, where
# the Linux wheel is built against the CUDA torch — its compiled ops then fail
# to register and the very first detector call dies with
# "operator torchvision::nms does not exist". The CPU index is also what keeps
# this at ~200 MB rather than ~2.5 GB.
RUN pip install --no-cache-dir \
      torch torchvision --index-url https://download.pytorch.org/whl/cpu

# pydantic[email], not bare pydantic: core.schema declares User.email as an
# EmailStr, and pydantic raises at class-definition time without
# email-validator. The worker imports schema through storage, so a bare install
# crashes the container on startup rather than at first use.
RUN pip install --no-cache-dir \
      onnxruntime ultralytics opencv-python-headless numpy pandas tqdm \
      azure-storage-blob azure-storage-queue azure-data-tables \
      "pydantic[email]" python-dotenv

# rtmlib pins its own onnxruntime; --no-deps keeps the one installed above.
# Its actual imports (numpy, opencv, onnxruntime, tqdm) are all present.
RUN pip install --no-cache-dir --no-deps rtmlib

# Weights baked in (~121 MB). The job scales to zero, so a runtime download
# would cost on every cold start and add an external dependency.
COPY pongai/worker/weights ./pongai/worker/weights

COPY pyproject.toml ./
COPY pongai/__init__.py  ./pongai/__init__.py
COPY pongai/core          ./pongai/core
COPY pongai/worker        ./pongai/worker
RUN pip install --no-cache-dir --no-deps .

# No server. Pull one message, process, exit.
CMD ["python","-m","pongai.worker.run"]
