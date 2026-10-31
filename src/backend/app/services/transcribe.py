from __future__ import annotations

import logging
import sys
import time
from functools import lru_cache
from pathlib import Path

from faster_whisper import WhisperModel

from app.config import settings
from app.services.ffmpeg import extract_audio, probe_media
from app.services.pipeline_log import PipelineContext
from app.services.segments import Word

logger = logging.getLogger("krayon.whisper")


@lru_cache(maxsize=1)
def get_whisper_model() -> WhisperModel:
    kwargs: dict = {
        "model_size_or_path": settings.whisper_model,
        "device": settings.whisper_device,
        "compute_type": settings.whisper_compute_type,
    }
    if settings.whisper_download_root:
        kwargs["download_root"] = settings.whisper_download_root
    model = WhisperModel(**kwargs)
    py_version = f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}"
    logger.info(
        "Whisper model loaded model=%s device=%s compute_type=%s python=%s beam_size=%s",
        settings.whisper_model,
        settings.whisper_device,
        settings.whisper_compute_type,
        py_version,
        settings.whisper_beam_size,
    )
    return model


def is_whisper_model_loaded() -> bool:
    return get_whisper_model.cache_info().currsize > 0


def whisper_available() -> bool:
    try:
        import faster_whisper  # noqa: F401

        return True
    except Exception:
        return False


def whisper_ready() -> bool:
    return whisper_available() and is_whisper_model_loaded()


def warmup_whisper_model() -> None:
    if is_whisper_model_loaded():
        logger.info("Whisper model already loaded (%s)", settings.whisper_model)
        return

    logger.info("Loading Whisper model (%s)…", settings.whisper_model)
    started = time.perf_counter()
    get_whisper_model()
    elapsed = time.perf_counter() - started
    logger.info("Whisper model ready in %.1fs", elapsed)


def transcribe_words(
    source_path: Path,
    wav_path: Path,
    *,
    language: str | None = "en",
    on_progress=None,
    pipeline: PipelineContext | None = None,
    initial_prompt: str | None = None,
) -> list[Word]:
    if on_progress:
        on_progress(0.05, "Extracting audio…")

    if pipeline:
        pipeline.phase("transcribing", "extract audio start", step="extract_audio")

    extract_started = time.perf_counter()
    extract_audio(source_path, wav_path)

    if pipeline:
        pipeline.phase(
            "transcribing",
            "extract audio complete",
            step="extract_audio",
            elapsed_ms=int((time.perf_counter() - extract_started) * 1000),
        )
        pipeline.phase("transcribing", "transcribe start", step="whisper")
        logger.debug("WAV cache path=%s", wav_path)

    model = get_whisper_model()

    if on_progress:
        on_progress(0.25, "Transcribing…")

    transcribe_started = time.perf_counter()
    transcribe_kwargs: dict = {
        "language": language,
        "word_timestamps": True,
        "vad_filter": True,
        "beam_size": settings.whisper_beam_size,
        "condition_on_previous_text": settings.whisper_condition_on_previous_text,
    }
    if initial_prompt:
        transcribe_kwargs["initial_prompt"] = initial_prompt
    segments, info = model.transcribe(str(wav_path), **transcribe_kwargs)

    total_duration = float(info.duration or 0.0)
    if total_duration <= 0:
        try:
            total_duration = float(probe_media(wav_path).duration or 0.0)
        except Exception:
            total_duration = 0.0

    words: list[Word] = []
    last_ratio = 0.25
    last_logged_pct = -1
    segment_count = 0

    for segment in segments:
        segment_count += 1
        if segment.words:
            for w in segment.words:
                text = (w.word or "").strip()
                if not text:
                    continue
                words.append(Word(text=text, start=float(w.start), end=float(w.end)))
        else:
            text = (segment.text or "").strip()
            if text:
                words.append(
                    Word(text=text, start=float(segment.start), end=float(segment.end))
                )

        if on_progress and total_duration > 0:
            transcribe_ratio = min(1.0, float(segment.end) / total_duration)
            ratio = 0.25 + 0.75 * transcribe_ratio
            if ratio - last_ratio >= 0.01 or transcribe_ratio >= 0.99:
                on_progress(ratio, f"Transcribing… {int(transcribe_ratio * 100)}%")
                last_ratio = ratio

            pct = int(transcribe_ratio * 100)
            logged_bucket = (pct // 10) * 10
            if pipeline and logged_bucket > last_logged_pct and logged_bucket % 10 == 0:
                last_logged_pct = logged_bucket
                pipeline.phase(
                    "transcribing",
                    "transcribe progress",
                    step="whisper",
                    transcribe_pct=logged_bucket,
                    elapsed_ms=int((time.perf_counter() - transcribe_started) * 1000),
                )
        elif on_progress and segment_count % 5 == 0:
            on_progress(0.5, f"Transcribing… ({segment_count} segments)")

    words.sort(key=lambda w: (w.start, w.end))

    transcribe_elapsed = time.perf_counter() - transcribe_started
    realtime_factor = (
        round(total_duration / transcribe_elapsed, 2) if transcribe_elapsed > 0 else 0.0
    )

    if pipeline:
        pipeline.phase_complete(
            "transcribing",
            step="whisper",
            word_count=len(words),
            audio_duration_s=round(total_duration, 1),
            realtime_factor=realtime_factor,
        )

    if on_progress:
        on_progress(1.0, f"Transcribed {len(words)} words")

    return words
