"""Transcript pipeline on the synthetic fixture. Bounds are the designed cut, not a loosened target."""

from __future__ import annotations

from pathlib import Path

import pytest

from app.services.boundary_snap import load_envelope, speech_threshold
from app.services.studio.common.dispatch import run_pipeline
from app.services.studio.common.project import PipelineOptions, ProjectAudio
from tests.fixtures import EXPECTED_TEXTS, build_fixture


def _options() -> PipelineOptions:
    return PipelineOptions(
        silence_threshold=0.4,
        pad=0.05,
        similarity_threshold=0.7,
        pipeline="transcript",
        snap_to_audio=True,
        script_whisper_prompt=False,
    )


def test_fixture_transcript_meets_cut_bounds(tmp_path: Path) -> None:
    fixture = build_fixture(tmp_path)
    result = run_pipeline(ProjectAudio(source=fixture.source, analysis_dir=fixture.root / "analysis"), _options())
    clips = sorted(result.clips, key=lambda clip: clip.source_start)
    assert [clip.text for clip in clips] == EXPECTED_TEXTS
    assert len(clips) == fixture.clip_count

    envelope = load_envelope(fixture.wav)
    assert envelope is not None
    threshold = speech_threshold(envelope)
    for index, clip in enumerate(clips):
        assert clip.duration >= 0.15
        assert clip.source_end > clip.source_start
        assert envelope.value_at(clip.source_start) < threshold
        assert envelope.value_at(min(clip.source_end, fixture.duration_s - 0.001)) < threshold
        if clip.words:
            assert clip.words[0].start - clip.source_start < 0.15
            assert clip.source_end - clip.words[-1].end < 0.35
        if index:
            previous = clips[index - 1]
            assert clip.source_start >= previous.source_end - 1e-3


@pytest.mark.xfail(strict=True, reason="BUG: reanalyze snaps every clip and does not lock manual splits")
def test_reanalyze_does_not_lock_manual_splits(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    from app.services.segments import Word
    from app.services.studio.reanalyze import _build_range_clips

    wav = tmp_path / "source.wav"
    wav.write_bytes(b"not-a-real-wav")
    seen: list[set[str]] = []

    def spy(clips, _wav, **kwargs):
        seen.append(set(kwargs.get("locked_ids") or ()))
        return clips

    monkeypatch.setattr("app.services.studio.reanalyze.snap_studio_clips", spy)
    _build_range_clips(
        [Word("alpha", 0.2, 0.6), Word("beta", 0.8, 1.2)],
        start=0.0,
        end=2.0,
        source_duration=2.0,
        wav_path=wav,
        silence_threshold=0.4,
        pad=0.05,
        similarity_threshold=0.7,
    )
    # BUG: reanalyze snaps every clip and does not lock manual splits
    assert seen and seen[0]
