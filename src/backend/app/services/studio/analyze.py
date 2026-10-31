from __future__ import annotations

from pathlib import Path

from app.config import settings
from app.services.boundary_snap import snap_studio_clips
from app.services.clips import build_segment_clips
from app.services.ffmpeg import probe_media
from app.services.segments import (
    TAIL_NEIGHBOR_GUARD_S,
    build_segments_from_words,
    extend_segment_tails,
)
from app.schemas import WordTiming
from app.services.studio.common.project import PipelineOptions, ProjectAudio, StudioAnalysis, write_checkpoint
from app.services.studio.scoring import score_clips
from app.services.studio.transcribe_resume import ensure_wav, ensure_words, load_words

__all__ = ["StudioAnalysis", "analyze_project", "run_transcript_pipeline"]


def run_transcript_pipeline(project: ProjectAudio, options: PipelineOptions, on_progress=None) -> StudioAnalysis:
    """Today's scriptless Studio analysis. Skips extract/Whisper when caches exist."""
    analysis_dir = project.analysis_dir
    source = project.source
    analysis_dir.mkdir(parents=True, exist_ok=True)
    wav_path = analysis_dir / "source.wav"
    words_path = analysis_dir / "words.json"

    def progress(phase: str, ratio: float, message: str) -> None:
        write_checkpoint(analysis_dir, phase, message)
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
    ensure_words(
        wav_path,
        words_path,
        language=options.language,
        on_progress=whisper_progress,
        initial_prompt=options.initial_prompt,
    )
    words = load_words(words_path)

    probe = probe_media(source)
    source_duration = float(probe.duration or 0.0)
    progress("segmenting", 0.2, "Building speech segments…")
    segments = build_segments_from_words(
        words,
        silence_threshold=options.silence_threshold,
        pad=options.pad,
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
        similarity_threshold=options.similarity_threshold,
        pad=options.pad,
        drop_junk_tokens=True,
        avoid_untrusted_cuts=True,
        language=options.language,
    )
    if options.snap_to_audio:
        clips = snap_studio_clips(clips, wav_path, pad=options.pad, search=options.snap_search_seconds)
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
        pipeline="transcript",
    )


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
    pipeline: str = "transcript",
    script: str | None = None,
    script_match_threshold: float = 0.7,
    script_confirm_threshold: float = 0.85,
    script_prefer_last_takes: bool = True,
    script_whisper_prompt: bool = True,
    initial_prompt: str | None = None,
) -> StudioAnalysis:
    """First-pass analysis. Skips extract/Whisper when analysis/ caches exist."""
    from app.services.studio.common.dispatch import run_pipeline

    options = PipelineOptions(
        silence_threshold=silence_threshold,
        pad=pad,
        similarity_threshold=similarity_threshold,
        language=language,
        snap_to_audio=snap_to_audio,
        snap_search_seconds=snap_search_seconds,
        pipeline=pipeline,  # type: ignore[arg-type]
        script_match_threshold=script_match_threshold,
        script_confirm_threshold=script_confirm_threshold,
        script_prefer_last_takes=script_prefer_last_takes,
        script_whisper_prompt=script_whisper_prompt,
        initial_prompt=initial_prompt,
    )
    return run_pipeline(ProjectAudio(source=source, analysis_dir=analysis_dir), options, script, on_progress=on_progress)
