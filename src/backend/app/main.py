from __future__ import annotations

import logging
import sys
import threading

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.logging_setup import setup_logging, start_log_retention
from app.middleware.errors import http_exception_handler, unhandled_exception_handler
from app.middleware.request_logging import RequestLoggingMiddleware
from app.routers import clips, editor_state, fs, media, silence, studio_audio, tools
from app.services.transcribe import warmup_whisper_model

setup_logging()
start_log_retention()

logger = logging.getLogger("krayon")

app = FastAPI(title="Krayon API", version="0.2.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(RequestLoggingMiddleware)

app.add_exception_handler(HTTPException, http_exception_handler)
app.add_exception_handler(Exception, unhandled_exception_handler)

app.include_router(tools.router)
app.include_router(fs.router)
app.include_router(media.router)
app.include_router(silence.router)
app.include_router(clips.router)
app.include_router(editor_state.router)
app.include_router(studio_audio.router)


@app.on_event("startup")
def on_startup() -> None:
    py_version = f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}"
    logger.info(
        "Krayon API started python=%s whisper_model=%s device=%s compute_type=%s",
        py_version,
        settings.whisper_model,
        settings.whisper_device,
        settings.whisper_compute_type,
    )

    if not settings.whisper_warmup_on_startup:
        return

    def run_warmup() -> None:
        try:
            warmup_whisper_model()
        except Exception:
            logger.exception("Whisper warmup failed")

    threading.Thread(target=run_warmup, daemon=True, name="whisper-warmup").start()


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok"}
