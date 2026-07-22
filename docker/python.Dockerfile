# syntax=docker/dockerfile:1
# apps/python — FastAPI scene-generation service.
#
# Code, config.yaml, prompts/, data/, and the Kokoro/whisper model files are
# NOT copied into the image — they're bind-mounted by docker-compose (see
# root docker-compose.yml). The model files (kokoro-v1.0.onnx,
# voices-v1.0.bin, ~350MB combined) are gitignored/local-only and would
# bloat the image + invalidate the build cache on every change, so they
# always come from the host, in both dev and prod.
#
# Installs the Ollama CLI so src/llm.py's `subprocess.check_output(["ollama",
# "run", ...])` has a binary to call. OLLAMA_HOST (set in docker-compose)
# points it at the HOST's Ollama daemon instead of expecting one inside this
# container — this image does not run an Ollama daemon itself.
FROM python:3.11-slim AS base
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg curl ca-certificates zstd \
    && curl -fsSL https://ollama.com/install.sh | sh \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app/apps/python

FROM base AS deps
COPY apps/python/requirements.txt ./requirements.txt
# --mount=type=cache persists downloaded wheels across build attempts (a
# cache mount survives even when the RUN step itself fails), and
# --timeout/--retries ride out slow/flaky connections instead of dying on
# one stalled read mid-download of a large wheel (torch, whisper, etc).
#
# torch is installed first from PyTorch's CPU-only wheel index: plain
# `pip install torch` resolves the full CUDA build (~2GB of nvidia-*
# packages) even though this container has no GPU and whisper/kokoro run
# CPU-only here. Installing the CPU wheel up front means the later
# `-r requirements.txt` (which pulls torch in transitively via
# openai-whisper) finds it already satisfied and skips the CUDA download.
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install --timeout=120 --retries=10 torch --index-url https://download.pytorch.org/whl/cpu \
    && pip install --timeout=120 --retries=10 -r requirements.txt

FROM deps AS dev
EXPOSE 8000
CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8000", "--reload", "--app-dir", "src"]

FROM deps AS prod
EXPOSE 8000
CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8000", "--app-dir", "src"]
