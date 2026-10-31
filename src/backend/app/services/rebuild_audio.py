from __future__ import annotations

import time
from collections.abc import Callable
from pathlib import Path

from app.schemas import ClipGroup, ClipItem, SilenceAnalysis, SilenceOptions, SourceSegment
from app.services.clip_pipeline import group_and_extract
from app.services.editor_state import load_manifest, prepare_version, save_version
from app.services.ffmpeg import krayon_cache_dir
from app.services.pipeline_log import PipelineContext
from app.services.segments import (
    LEGACY_TAIL_MAX_EXTEND_S,
    Word,
    build_segments_from_words,
    extend_segment_tails,
    removed_seconds,
)

ProgressFn = Callable[[str, float, str], None]


class RebuildResult:
    def __init__(
        self,
        *,
        version_id: str,
        clips: list[ClipItem],
        groups: list[ClipGroup],
        analysis: SilenceAnalysis,
        source_path: str,
    ) -> None:
        self.version_id = version_id
        self.clips = clips
        self.groups = groups
        self.analysis = analysis
        self.source_path = source_path


def _publish(on_progress: ProgressFn | None, phase: str, step_progress: float, message: str) -> None:
    if on_progress:
        on_progress(phase, step_progress, message)


def rebuild_audio(
    source: Path,
    *,
    version_id: str,
    options: SilenceOptions,
    similarity_threshold: float,
    on_progress: ProgressFn | None = None,
    pipeline: PipelineContext | None = None,
) -> RebuildResult:
    started = time.perf_counter()
    existing = load_manifest(source, version_id)
    if existing is None:
        raise FileNotFoundError("Analysis run not found")
    if not existing.analysis.words:
        raise ValueError("No transcript on this run")

    new_version_id = prepare_version(source)

    if pipeline:
        pipeline.version_id = new_version_id
        pipeline.source = source
        pipeline.phase("starting", "rebuild from existing transcript")
        pipeline.phase_complete("starting")

    _publish(on_progress, "starting", 1.0, "Starting pipeline…")

    words = [Word(text=w.text, start=w.start, end=w.end) for w in existing.analysis.words]
    source_duration = existing.analysis.source_duration

    if pipeline:
        pipeline.reset_phase_timer()
        pipeline.phase(
            "segmenting",
            "segment start",
            silence_threshold=options.silence_threshold,
            pad=options.pad,
        )

    _publish(on_progress, "segmenting", 0.5, "Building speech segments…")
    segment_started = time.perf_counter()
    segments = build_segments_from_words(
        words,
        silence_threshold=options.silence_threshold,
        pad=options.pad,
        source_duration=source_duration,
    )
    wav_path = krayon_cache_dir(source.parent) / f"{source.stem}.wav"
    segments = extend_segment_tails(
        wav_path,
        segments,
        source_duration or 0.0,
        max_extend_s=LEGACY_TAIL_MAX_EXTEND_S,
        neighbor_guard_s=0.0,
        stop_on_reloud=False,
    )
    removed = removed_seconds(source_duration or 0.0, segments)

    if pipeline:
        pipeline.phase_complete(
            "segmenting",
            segment_count=len(segments),
            removed_seconds=round(removed, 2),
            elapsed_ms=int((time.perf_counter() - segment_started) * 1000),
        )

    _publish(on_progress, "segmenting", 1.0, f"Found {len(segments)} segments")

    clips, groups = group_and_extract(
        source,
        version_id=new_version_id,
        segments=segments,
        words=words,
        similarity_threshold=similarity_threshold,
        pad=options.pad,
        on_progress=on_progress,
        pipeline=pipeline,
    )

    analysis = SilenceAnalysis(
        source_duration=source_duration,
        fps=existing.analysis.fps,
        segments=[
            SourceSegment(source_start=s.source_start, source_end=s.source_end) for s in segments
        ],
        removed_seconds=removed,
        words=existing.analysis.words,
    )

    processing_duration = time.perf_counter() - started
    manifest = save_version(
        source,
        version_id=new_version_id,
        options=options,
        similarity_threshold=similarity_threshold,
        analysis=analysis,
        clips=clips,
        groups=groups,
        processing_duration_seconds=processing_duration,
        audio_ready=True,
        pipeline=pipeline,
        source_version_id=version_id,
    )

    return RebuildResult(
        version_id=new_version_id,
        clips=manifest.clips,
        groups=manifest.groups,
        analysis=analysis,
        source_path=str(source.resolve()),
    )
