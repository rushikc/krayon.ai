from __future__ import annotations

from pathlib import Path

import pytest

from app.schemas import ClipItem, SourceSegment
from app.services.pipeline_log import PipelineContext
from app.services.pipeline_progress import overall_progress
from app.services.studio.audio_stats import clip_audio_stats, clip_peaks
from app.services.studio.clip_preview import slice_clip_audio
from app.services.studio.common.project import ProjectAudio, StudioAnalysis
from app.services.studio.common.serialize import analysis_payload
from app.services.studio.scoring import score_clips
from tests.fixtures import write_wav, render_samples


def _clip(clip_id: str, text: str, start: float = 0.0, end: float = 1.0) -> ClipItem:
    return ClipItem(
        id=clip_id,
        index=0,
        source_start=start,
        source_end=end,
        duration=end - start,
        text=text,
        group_id="g1",
        ranges=[SourceSegment(source_start=start, source_end=end)],
    )


def test_stats_and_peaks_reject_empty_ranges_and_cache(tmp_path: Path) -> None:
    wav = tmp_path / "source.wav"
    write_wav(wav, render_samples(duration_s=1.0))
    with pytest.raises(ValueError):
        clip_audio_stats(wav, [])
    with pytest.raises(ValueError):
        clip_peaks(wav, [], buckets=4)
    with pytest.raises(ValueError):
        clip_peaks(wav, [(0.0, 0.2)], pad=-0.1)
    with pytest.raises(ValueError):
        slice_clip_audio(wav, tmp_path / "out.wav", [])
    with pytest.raises(ValueError):
        slice_clip_audio(wav, tmp_path / "out.wav", [(0.0, 0.2)], pad=-1)

    cache = tmp_path / "stats"
    first = clip_audio_stats(wav, [(0.1, 0.4)], cache_dir=cache)
    second = clip_audio_stats(wav, [(0.1, 0.4)], cache_dir=cache)
    assert first["start"]["rmsDbfs"] == second["start"]["rmsDbfs"]
    assert "before" in first and "after" in first
    peaks = clip_peaks(wav, [(0.0, 0.5)], buckets=8)
    assert len(peaks["peaks"]) == 16


def test_analysis_payload_score_and_progress(tmp_path: Path) -> None:
    clip = _clip("c-0001", "alpha beta")
    scores = score_clips([clip])
    assert scores["c-0001"]["reasons"]
    result = StudioAnalysis(
        source_duration=1.0,
        fps=30.0,
        words=[],
        clips=[clip],
        groups=[],
        scores=scores,
        removed_seconds=0.2,
        pipeline="transcript",
    )
    payload = analysis_payload(result)
    assert payload["pipeline"] == "transcript"
    assert payload["scope"] == "full"
    assert payload["clips"][0]["id"] == "c-0001"
    assert "sourcePath" not in payload

    context = PipelineContext(job_id="job-1", source=tmp_path / "talk.wav")
    assert context.source_name == "talk.wav"
    context.phase("segmenting", "segment start")
    context.phase_complete("segmenting", segment_count=1)
    assert overall_progress("segmenting", 0.5) == pytest.approx(0.88)
    assert overall_progress("segmenting", 2.0) <= 1.0
    assert overall_progress("unknown", 0.5) == pytest.approx(0.5)
    assert ProjectAudio(source=tmp_path / "talk.wav", analysis_dir=tmp_path).analysis_dir == tmp_path
