# API — CPU, always warm (min 1 replica so SSE connections survive)
FROM python:3.11-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
      ffmpeg curl && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY pyproject.toml ./
COPY pongai/__init__.py       ./pongai/__init__.py
COPY pongai/core               ./pongai/core
COPY pongai/api                ./pongai/api
# ".[api]", not ".". fastapi and uvicorn are optional-dependencies, so a bare
# install omits them and the CMD below fails with "uvicorn: not found".
RUN pip install --no-cache-dir ".[api]"

EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD curl -fsS http://localhost:8000/api/health || exit 1

# One worker. SSE holds connections open for ~40 min; multiple sync workers
# would each need their own table polling loop.
CMD ["uvicorn","pongai.api.main:app","--host","0.0.0.0","--port","8000", \
     "--timeout-keep-alive","3600"]
