from __future__ import annotations

from pathlib import Path

import pytest

from app.services.segments import Word
from app.services.studio.common.dispatch import resolve_pipeline, run_pipeline
from app.services.studio.common.project import PipelineOptions, ProjectAudio
from app.services.studio.transcribe_resume import save_words


def _options(pipeline: str = "auto") -> PipelineOptions:
    return PipelineOptions(
        silence_threshold=0.4,
        pad=0.05,
        similarity_threshold=0.7,
        pipeline=pipeline,  # type: ignore[arg-type]
        snap_to_audio=False,
        script_whisper_prompt=False,
    )


def test_auto_without_script_is_transcript() -> None:
    assert resolve_pipeline(_options("auto"), None) == "transcript"
    assert resolve_pipeline(_options("auto"), "  \n") == "transcript"


def test_auto_with_script_is_scripted() -> None:
    assert resolve_pipeline(_options("auto"), "hello world") == "scripted"


def test_explicit_transcript_ignores_script() -> None:
    assert resolve_pipeline(_options("transcript"), "hello world") == "transcript"


def test_scripted_without_lines_falls_back() -> None:
    assert resolve_pipeline(_options("scripted"), "") == "transcript"


def test_rebuild_without_script_matches_transcript(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    source = tmp_path / "talk.mp4"
    source.write_bytes(b"x")
    analysis = tmp_path / "analysis"
    analysis.mkdir()
    (analysis / "source.wav").write_bytes(b"RIFF")
    save_words(analysis / "words.json", [Word("hello", 0.2, 0.6), Word("there", 0.7, 1.1)])

    monkeypatch.setattr("app.services.studio.analyze.ensure_wav", lambda *a, **k: False)
    monkeypatch.setattr(
        "app.services.studio.analyze.probe_media",
        lambda _path: type("P", (), {"duration": 2.0, "fps": 30.0})(),
    )

    project = ProjectAudio(source=source, analysis_dir=analysis)
    transcript = run_pipeline(project, _options("transcript"), "hello there")
    auto_no = run_pipeline(project, _options("auto"), None)
    assert transcript.pipeline == "transcript"
    assert auto_no.pipeline == "transcript"
    assert [clip.source_start for clip in transcript.clips] == [clip.source_start for clip in auto_no.clips]
    assert [clip.text for clip in transcript.clips] == [clip.text for clip in auto_no.clips]
