from __future__ import annotations

from pathlib import Path

from app.services.studio.common.dispatch import run_pipeline
from app.services.studio.common.project import PipelineOptions, ProjectAudio
from tests.fixtures import FULL_LINE, SCRIPT, build_fixture


def _options(pipeline: str = "auto") -> PipelineOptions:
    return PipelineOptions(
        silence_threshold=0.4,
        pad=0.05,
        similarity_threshold=0.7,
        pipeline=pipeline,  # type: ignore[arg-type]
        snap_to_audio=True,
        script_whisper_prompt=False,
    )


def test_fixture_script_picks_the_last_full_take_and_flags_the_missing_line(tmp_path: Path) -> None:
    fixture = build_fixture(tmp_path, with_script=True)
    result = run_pipeline(
        ProjectAudio(source=fixture.source, analysis_dir=fixture.root / "analysis"),
        _options("auto"),
        fixture.script,
    )
    assert result.pipeline == "scripted"
    selected = []
    for clip in result.clips:
        meta = result.clip_meta[clip.id]
        if meta.get("status") == "selected":
            selected.append((meta["script"]["line"], clip))
    selected.sort(key=lambda item: item[0])
    lines = [line for line, _clip in selected]
    assert lines == [1, 2]
    first = selected[0][1]
    second = selected[1][1]
    assert FULL_LINE in first.text
    assert first.source_start > 12
    assert second.text.replace("  ", " ").strip() == "epsilon zeta eta"
    assert first.source_start < second.source_start
    assert all("theta" not in clip.text for clip in result.clips)
    missing = [group for group in result.groups if "lambda mu nu" in group.label]
    assert missing
    assert result.group_meta[missing[0].id]["scriptLine"] == 3
    assert not any(
        result.clip_meta[clip_id].get("status") == "selected"
        for clip_id in missing[0].clip_ids
    )


def test_empty_script_uses_the_transcript_pipeline(tmp_path: Path) -> None:
    fixture = build_fixture(tmp_path, with_script=True)
    result = run_pipeline(
        ProjectAudio(source=fixture.source, analysis_dir=fixture.root / "analysis"),
        _options("auto"),
        "\n\n",
    )
    assert result.pipeline == "transcript"
    assert len(result.clips) == fixture.clip_count
    assert SCRIPT.splitlines()[2] not in {clip.text for clip in result.clips}
