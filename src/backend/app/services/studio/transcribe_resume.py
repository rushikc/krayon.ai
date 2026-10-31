from __future__ import annotations

import json
import time
from pathlib import Path

from app.config import settings
from app.services.ffmpeg import extract_audio, probe_media
from app.services.segments import Word
from app.services.transcribe import get_whisper_model


def wav_is_cached(wav_path: Path) -> bool:
    return wav_path.is_file() and wav_path.stat().st_size > 44


def words_are_cached(words_path: Path) -> bool:
    return words_path.is_file() and words_path.stat().st_size > 0


def load_words(words_path: Path) -> list[Word]:
    payload = json.loads(words_path.read_text())
    raw = payload["words"] if isinstance(payload, dict) else payload
    return [Word(text=str(item["text"]), start=float(item["start"]), end=float(item["end"])) for item in raw]


def save_words(words_path: Path, words: list[Word]) -> None:
    words_path.parent.mkdir(parents=True, exist_ok=True)
    payload = {"words": [{"text": word.text, "start": word.start, "end": word.end} for word in words]}
    words_path.write_text(json.dumps(payload))


def ensure_wav(source: Path, wav_path: Path) -> bool:
    """Extract audio only when the WAV cache is missing. Returns True if extracted."""
    if wav_is_cached(wav_path):
        return False
    extract_audio(source, wav_path)
    return True


def transcribe_wav(
    wav_path: Path,
    *,
    language: str | None = "en",
    on_progress=None,
    initial_prompt: str | None = None,
) -> list[Word]:
    """Transcribe an existing WAV. Does not extract or overwrite the file."""
    model = get_whisper_model()
    if on_progress:
        on_progress(0.0, "Transcribing…")

    started = time.perf_counter()
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
    last_ratio = -1.0
    for segment in segments:
        if segment.words:
            for token in segment.words:
                text = (token.word or "").strip()
                if not text:
                    continue
                words.append(Word(text=text, start=float(token.start), end=float(token.end)))
        else:
            text = (segment.text or "").strip()
            if text:
                words.append(Word(text=text, start=float(segment.start), end=float(segment.end)))

        if on_progress and total_duration > 0:
            ratio = min(1.0, float(segment.end) / total_duration)
            if ratio - last_ratio >= 0.01 or ratio >= 0.99:
                on_progress(ratio, f"Transcribing… {int(ratio * 100)}%")
                last_ratio = ratio

    words.sort(key=lambda word: (word.start, word.end))
    if on_progress:
        on_progress(1.0, f"Transcribed {len(words)} words in {time.perf_counter() - started:.1f}s")
    return words


def ensure_words(
    wav_path: Path,
    words_path: Path,
    *,
    language: str | None = "en",
    on_progress=None,
    initial_prompt: str | None = None,
) -> bool:
    """Return True when Whisper ran. A cached words.json skips transcription."""
    if words_are_cached(words_path):
        return False
    words = transcribe_wav(
        wav_path,
        language=language,
        on_progress=on_progress,
        initial_prompt=initial_prompt,
    )
    save_words(words_path, words)
    return True
