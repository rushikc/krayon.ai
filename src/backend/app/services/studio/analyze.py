from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

from app.schemas import ClipGroup, ClipItem, WordTiming
from app.config import settings
from app.services.boundary_snap import snap_studio_clips
from app.services.clips import build_segment_clips
from app.services.ffmpeg import probe_media
from app.services.segments import (
    TAIL_NEIGHBOR_GUARD_S,
    build_segments_from_words,
    extend_segment_tails,
)
from app.services.studio.scoring import score_clips
from app.services.studio.transcribe_resume import ensure_wav, ensure_words, load_words


@dataclass
class StudioAnalysis:
    source_duration: float
    fps: float
    words: list[WordTiming]
    clips: list[ClipItem]
    groups: list[ClipGroup]
    scores: dict[str, dict]
    removed_seconds: float


def _write_checkpoint(analysis_dir: Path, phase: str, message: str) -> None:
    path = analysis_dir / "job.json"
    path.write_text(json.dumps({"phase": phase, "message": message}))


def analyze_project(
    source: Path,
    analysis_dir: Path,
    *,
    silence_threshold: float,
    pad: float,
    similarity_threshold: float,
    language: str | None = "en",
    snap_to_audio: bool = True,
    snap_search_seconds: float = 0.3,
    on_progress=None,
) -> StudioAnalysis:
    """First-pass analysis. Skips extract/Whisper when analysis/ caches exist."""
    analysis_dir.mkdir(parents=True, exist_ok=True)
    wav_path = analysis_dir / "source.wav"
    words_path = analysis_dir / "words.json"

    def progress(phase: str, ratio: float, message: str) -> None:
        _write_checkpoint(analysis_dir, phase, message)
        if on_progress:
            on_progress(phase, ratio, message)

    progress("extracting", 0.0, "Extracting audio…" if not wav_path.is_file() else "Reusing cached audio")
    extracted = ensure_wav(source, wav_path)
    progress("extracting", 1.0, "Extracted audio" if extracted else "Cached audio")

    def whisper_progress(ratio: float, message: str) -> None:
        progress("transcribing", ratio, message)

    if words_path.is_file():
        progress("transcribing", 1.0, "Reusing cached transcript")
    else:
        progress("transcribing", 0.0, "Transcribing…")
    ensure_words(wav_path, words_path, language=language, on_progress=whisper_progress)
    words = load_words(words_path)

    probe = probe_media(source)
    source_duration = float(probe.duration or 0.0)
    progress("segmenting", 0.2, "Building speech segments…")
    segments = build_segments_from_words(
        words,
        silence_threshold=silence_threshold,
        pad=pad,
        source_duration=source_duration,
    )
    segments = extend_segment_tails(
        wav_path,
        segments,
        source_duration,
        max_extend_s=settings.tail_max_extend_s,
        neighbor_guard_s=TAIL_NEIGHBOR_GUARD_S,
        stop_on_reloud=True,
    )
    progress("segmenting", 1.0, f"Found {len(segments)} segments")

    progress("grouping", 0.2, "Grouping retakes…")
    clips, groups = build_segment_clips(
        "studio",
        segments,
        words,
        similarity_threshold=similarity_threshold,
        pad=pad,
        drop_junk_tokens=True,
        avoid_untrusted_cuts=True,
        language=language,
    )
    if snap_to_audio:
        clips = snap_studio_clips(clips, wav_path, pad=pad, search=snap_search_seconds)
    scores = score_clips(clips)
    progress("grouping", 1.0, f"Grouped {len(clips)} clips")

    return StudioAnalysis(
        source_duration=source_duration,
        fps=float(probe.fps or 30.0),
        words=[WordTiming(text=word.text, start=word.start, end=word.end) for word in words],
        clips=clips,
        groups=groups,
        scores=scores,
        removed_seconds=max(0.0, source_duration - sum(clip.duration for clip in clips)),
    )
