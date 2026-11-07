#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

ENV_DIR=".krayonenv"
DEPS_MARKER="$ENV_DIR/.deps-installed"

pick_python() {
  local candidate version major minor
  for candidate in python3.12 python3.11 python3; do
    if ! command -v "$candidate" >/dev/null 2>&1; then
      continue
    fi
    version=$("$candidate" -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')
    major=${version%%.*}
    minor=${version#*.}
    if [[ "$major" -eq 3 && "$minor" -ge 13 ]]; then
      echo "Warning: $candidate is Python $version — Krayon recommends 3.12 (brew install python@3.12)" >&2
    fi
    echo "$candidate"
    return 0
  done
  echo "No suitable python3 found. Install Python 3.12: brew install python@3.12" >&2
  exit 1
}

PYTHON_BIN="${KRAYON_PYTHON:-$(pick_python)}"

if [[ ! -d "$ENV_DIR" ]]; then
  "$PYTHON_BIN" -m venv "$ENV_DIR"
fi

if [[ "${VIRTUAL_ENV:-}" != "$(pwd)/$ENV_DIR" ]]; then
  source "$ENV_DIR/bin/activate"
fi

if [[ ! -f "$DEPS_MARKER" ]] || [[ requirements.txt -nt "$DEPS_MARKER" ]]; then
  pip install -r requirements.txt
  touch "$DEPS_MARKER"
fi

WHISPER_MODEL=$(python -c "from app.config import settings; print(settings.whisper_model)")
WHISPER_MARKER="$ENV_DIR/.whisper-ready-${WHISPER_MODEL}"

if [[ ! -f "$WHISPER_MARKER" ]]; then
  echo "→ Downloading Whisper model (${WHISPER_MODEL}) — one-time setup…"
  python -c "from app.services.transcribe import warmup_whisper_model; warmup_whisper_model()"
  touch "$WHISPER_MARKER"
fi

if [[ "${KRAYON_FIXED:-}" == "1" ]]; then
  exec uvicorn app.main:app --port 8000
fi
exec uvicorn app.main:app --reload --port 8000
