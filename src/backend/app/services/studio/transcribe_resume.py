from __future__ import annotations

import json
import logging
import time
import zlib
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Iterable

from app.config import settings
from app.services.ffmpeg import extract_audio, probe_media
from app.services.segments import Word
from app.services.transcribe import get_whisper_model

logger = logging.getLogger("krayon.whisper")

STUDIO_TEMPERATURES = (0.0, 0.4)
COMPRESSION_RATIO_THRESHOLD = 2.4
ACCEPT_COMPRESSION_RATIO_THRESHOLD = 10.0
WINDOW_S = 30.0

LANGUAGE_NAMES = {
    "en": "English",
    "hi": "Hindi",
    "es": "Spanish",
    "fr": "French",
    "de": "German",
    "pt": "Portuguese",
    "ja": "Japanese",
    "ko": "Korean",
    "zh": "Chinese",
}


class AnalysisCancelled(Exception):
    """Raised when a Studio analyze/reanalyze job is cancelled mid-Whisper."""


def requested_language_key(language: str | None) -> str:
    if language is None or language == "" or str(language).lower() == "auto":
        return "auto"
    return str(language).lower()


def whisper_language(language: str | None) -> str | None:
    key = requested_language_key(language)
    return None if key == "auto" else key


def language_display_name(code: str | None) -> str:
    if not code:
        return "unknown"
    return LANGUAGE_NAMES.get(code.lower(), code)


def wav_is_cached(wav_path: Path) -> bool:
    return wav_path.is_file() and wav_path.stat().st_size > 44


def words_are_cached(
    words_path: Path,
    *,
    requested_language: str | None = None,
    model: str | None = None,
) -> bool:
    if not (words_path.is_file() and words_path.stat().st_size > 0):
        return False
    try:
        payload = json.loads(words_path.read_text())
    except json.JSONDecodeError:
        return False
    if isinstance(payload, list):
        return True
    if not isinstance(payload, dict) or "words" not in payload:
        return False
    stored_language = payload.get("requestedLanguage")
    stored_model = payload.get("model")
    if stored_language is None and stored_model is None:
        return True
    want_language = requested_language_key(requested_language)
    want_model = model or settings.whisper_model
    return stored_language == want_language and stored_model == want_model


def _word_payload(word: Word) -> dict:
    item: dict = {"text": word.text, "start": word.start, "end": word.end}
    if word.confidence and word.confidence != "high":
        item["confidence"] = word.confidence
    return item


def load_words(words_path: Path) -> list[Word]:
    payload = json.loads(words_path.read_text())
    raw = payload["words"] if isinstance(payload, dict) else payload
    words: list[Word] = []
    for item in raw:
        words.append(
            Word(
                text=str(item["text"]),
                start=float(item["start"]),
                end=float(item["end"]),
                confidence=str(item.get("confidence") or "high"),
            )
        )
    return words


def save_words(
    words_path: Path,
    words: list[Word],
    *,
    requested_language: str | None = None,
    detected_language: str | None = None,
    model: str | None = None,
) -> None:
    words_path.parent.mkdir(parents=True, exist_ok=True)
    previous = read_words_meta(words_path) if words_path.is_file() else {}
    requested = (
        requested_language
        if requested_language is not None
        else previous.get("requestedLanguage") or "en"
    )
    payload = {
        "requestedLanguage": requested_language_key(requested),
        "detectedLanguage": detected_language if detected_language is not None else previous.get("detectedLanguage"),
        "model": model or previous.get("model") or settings.whisper_model,
        "words": [_word_payload(word) for word in words],
    }
    words_path.write_text(json.dumps(payload))


def read_words_meta(words_path: Path) -> dict:
    if not words_path.is_file():
        return {}
    try:
        payload = json.loads(words_path.read_text())
    except json.JSONDecodeError:
        return {}
    if not isinstance(payload, dict):
        return {}
    return {
        "requestedLanguage": payload.get("requestedLanguage"),
        "detectedLanguage": payload.get("detectedLanguage"),
        "model": payload.get("model"),
    }


def ensure_wav(source: Path, wav_path: Path) -> bool:
    """Extract audio only when the WAV cache is missing. Returns True if extracted."""
    if wav_is_cached(wav_path):
        return False
    extract_audio(source, wav_path)
    return True


def _compression_ratio(text: str) -> float:
    raw = text.encode("utf-8")
    if not raw:
        return 0.0
    return len(raw) / max(1, len(zlib.compress(raw)))


def format_clock(seconds: float) -> str:
    total = max(0, int(round(seconds)))
    return f"{total // 60}:{total % 60:02d}"


def _eta_phrase(elapsed: float, ratio: float) -> str | None:
    if ratio <= 0.02 or elapsed <= 0:
        return None
    remaining = elapsed / ratio * (1.0 - ratio)
    if remaining < 45:
        return "less than a minute left"
    minutes = max(1, int(round(remaining / 60.0)))
    return f"about {minutes} min left"


def _progress_message(
    *,
    position: float,
    duration: float,
    elapsed: float,
    model_name: str,
    detected: str | None,
    probability: float | None,
) -> str:
    ratio = min(1.0, position / duration) if duration > 0 else 0.0
    parts = [f"Transcribing with {model_name}… {format_clock(position)} of {format_clock(duration)}"]
    eta = _eta_phrase(elapsed, ratio)
    if eta:
        parts.append(eta)
    if detected:
        pct = int(round((probability or 0.0) * 100))
        parts.append(f"Detected language: {language_display_name(detected)} ({pct}%)")
    return " · ".join(parts)


def _segment_text(segment) -> str:
    if getattr(segment, "text", None):
        return str(segment.text).strip()
    words = getattr(segment, "words", None) or []
    return " ".join((token.word or "").strip() for token in words if (token.word or "").strip())


def _words_from_segments(segments: Iterable, *, confidence: str) -> list[Word]:
    words: list[Word] = []
    for segment in segments:
        if segment.words:
            for token in segment.words:
                text = (token.word or "").strip()
                if not text:
                    continue
                words.append(
                    Word(
                        text=text,
                        start=float(token.start),
                        end=float(token.end),
                        confidence=confidence,
                    )
                )
        else:
            text = (segment.text or "").strip()
            if text:
                words.append(
                    Word(
                        text=text,
                        start=float(segment.start),
                        end=float(segment.end),
                        confidence=confidence,
                    )
                )
    words.sort(key=lambda word: (word.start, word.end))
    return words


def _covered(words: list[Word], start: float, end: float) -> bool:
    overlap = 0.0
    for word in words:
        overlap += max(0.0, min(word.end, end) - max(word.start, start))
    return overlap >= (end - start) * 0.15


@dataclass
class TranscribeResult:
    words: list[Word]
    detected_language: str | None
    detected_probability: float | None
    fallback_windows: int


def transcribe_wav(
    wav_path: Path,
    *,
    language: str | None = "en",
    on_progress=None,
    initial_prompt: str | None = None,
    cancelled: Callable[[], bool] | None = None,
    words_path: Path | None = None,
    requested_language: str | None = None,
) -> list[Word]:
    """Transcribe an existing WAV. Does not extract or overwrite the file."""
    model = get_whisper_model()
    requested = requested_language_key(requested_language if requested_language is not None else language)
    whisper_lang = whisper_language(language)
    model_name = settings.whisper_model

    try:
        total_duration = float(probe_media(wav_path).duration or 0.0)
    except Exception:
        total_duration = 0.0

    if on_progress:
        on_progress(0.0, f"Transcribing with {model_name}…")

    started = time.perf_counter()
    detected_language: str | None = None
    detected_probability: float | None = None

    if whisper_lang is not None:
        detect = getattr(model, "detect_language", None)
        if callable(detect):
            try:
                from faster_whisper.audio import decode_audio

                audio = decode_audio(str(wav_path), sampling_rate=16000)
                head = audio[: 16000 * 30] if getattr(audio, "__len__", None) else audio
                result = detect(head)
                if isinstance(result, tuple) and result:
                    detected_language = str(result[0])
                    detected_probability = float(result[1]) if len(result) > 1 else None
            except Exception:
                logger.debug("Language detection skipped", exc_info=True)

    transcribe_kwargs: dict = {
        "language": whisper_lang,
        "word_timestamps": True,
        "vad_filter": True,
        "beam_size": settings.whisper_beam_size,
        "condition_on_previous_text": False,
        "temperature": STUDIO_TEMPERATURES,
        "compression_ratio_threshold": COMPRESSION_RATIO_THRESHOLD,
    }
    if initial_prompt:
        transcribe_kwargs["initial_prompt"] = initial_prompt

    words: list[Word] = []
    fallback_windows = 0

    def persist() -> None:
        if words_path is not None:
            save_words(
                words_path,
                words,
                requested_language=requested,
                detected_language=detected_language,
                model=model_name,
            )

    def check_cancelled() -> None:
        if cancelled and cancelled():
            persist()
            raise AnalysisCancelled()

    check_cancelled()
    segments, info = model.transcribe(str(wav_path), **transcribe_kwargs)
    if whisper_lang is None and getattr(info, "language", None):
        detected_language = str(info.language)
        detected_probability = float(getattr(info, "language_probability", 0.0) or 0.0)
    if total_duration <= 0:
        total_duration = float(getattr(info, "duration", 0.0) or 0.0)

    for segment in segments:
        check_cancelled()
        words.extend(_words_from_segments([segment], confidence="high"))
        if on_progress and total_duration > 0:
            on_progress(
                min(1.0, float(segment.end) / total_duration),
                _progress_message(
                    position=float(segment.end),
                    duration=total_duration,
                    elapsed=time.perf_counter() - started,
                    model_name=model_name,
                    detected=detected_language,
                    probability=detected_probability,
                ),
            )

    if total_duration > 0:
        start = 0.0
        while start < total_duration - 1e-3:
            end = min(total_duration, start + WINDOW_S)
            if not _covered(words, start, end):
                check_cancelled()
                fallback_windows += 1
                extra_kwargs = {
                    **transcribe_kwargs,
                    "temperature": STUDIO_TEMPERATURES[1],
                    "compression_ratio_threshold": ACCEPT_COMPRESSION_RATIO_THRESHOLD,
                    "clip_timestamps": [start, end],
                }
                extra_segments, extra_info = model.transcribe(str(wav_path), **extra_kwargs)
                if whisper_lang is None and not detected_language and getattr(extra_info, "language", None):
                    detected_language = str(extra_info.language)
                    detected_probability = float(getattr(extra_info, "language_probability", 0.0) or 0.0)
                extra_words = _words_from_segments(extra_segments, confidence="low")
                extra_words = [word for word in extra_words if word.start >= start - 0.05 and word.end <= end + 0.05]
                words.extend(extra_words)
            start = end

    if fallback_windows:
        logger.info("Studio Whisper fallback windows=%s model=%s", fallback_windows, model_name)

    words.sort(key=lambda word: (word.start, word.end))
    persist()
    if on_progress:
        on_progress(1.0, f"Transcribed {len(words)} words in {time.perf_counter() - started:.1f}s")
    transcribe_wav.last_result = TranscribeResult(  # type: ignore[attr-defined]
        words=words,
        detected_language=detected_language,
        detected_probability=detected_probability,
        fallback_windows=fallback_windows,
    )
    return words


def ensure_words(
    wav_path: Path,
    words_path: Path,
    *,
    language: str | None = "en",
    on_progress=None,
    initial_prompt: str | None = None,
    cancelled: Callable[[], bool] | None = None,
    requested_language: str | None = None,
) -> bool:
    """Return True when Whisper ran. A cached words.json skips transcription."""
    requested = requested_language_key(requested_language if requested_language is not None else language)
    if words_are_cached(words_path, requested_language=requested, model=settings.whisper_model):
        return False
    transcribe_wav(
        wav_path,
        language=language,
        on_progress=on_progress,
        initial_prompt=initial_prompt,
        cancelled=cancelled,
        words_path=words_path,
        requested_language=requested,
    )
    return True
