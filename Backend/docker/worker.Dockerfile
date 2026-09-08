# Worker — GPU, scales to zero. Runs to completion and exits.
#
# `runtime` not `devel`: the devel image is ~3 GB larger and nothing here
# compiles CUDA. Image size is cold-start latency when replicas start at 0.
FROM nvidia/cuda:12.4.1-runtime-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

RUN apt-get update && apt-get install -y --no-install-recommends \
      python3.11 python3-pip ffmpeg libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/* \
    && ln -sf /usr/bin/python3.11 /usr/bin/python

WORKDIR /app

# Heavy layers first so code changes don't invalidate them.
# torchvision alongside torch, from the same index: ultralytics needs it for
# NMS, and resolving it from PyPI instead gives a build compiled against a
# different torch, which fails at the first detector call.
RUN pip install --no-cache-dir \
      torch torchvision --index-url https://download.pytorch.org/whl/cu124
RUN pip install --no-cache-dir \
      "onnxruntime-gpu==1.22.0" ultralytics \
      opencv-python-headless numpy pandas tqdm \
      azure-storage-blob azure-storage-queue azure-data-tables pydantic

# rtmlib declares CPU onnxruntime as a hard dependency, which shadows the GPU
# build and silently drops pose inference to CPU at ~40x the cost. --no-deps
# is the only way to keep the GPU wheel.
RUN pip install --no-cache-dir --no-deps rtmlib

# Weights baked in (~115 MB). The job scales to zero, so a runtime download
# would cost on every cold start and add an external dependency.
COPY pongai/worker/weights ./pongai/worker/weights

COPY pyproject.toml ./
COPY pongai/__init__.py  ./pongai/__init__.py
COPY pongai/core          ./pongai/core
COPY pongai/worker        ./pongai/worker
RUN pip install --no-cache-dir --no-deps .

# onnxruntime-gpu looks for libcudnn/libcublas on the loader path; torch ships
# its own copies under site-packages/nvidia/*.
ENV LD_LIBRARY_PATH=/usr/local/lib/python3.11/dist-packages/nvidia/cudnn/lib:/usr/local/lib/python3.11/dist-packages/nvidia/cublas/lib:$LD_LIBRARY_PATH

# No server. Pull one message, process, exit.
CMD ["python","-m","pongai.worker.run"]
