from __future__ import annotations

import json
from pathlib import Path

import pytest

from app.services.studio.common.timings import AnalysisTimingsTracker, analysis_timing_session
from app.services.studio.transcribe_resume import AnalysisCancelled


class FakeClock:
    def __init__(self, start: float = 1_700_000_000.0) -> None:
        self.t = start

    def __call__(self) -> float:
        return self.t

    def advance(self, seconds: float) -> None:
        self.t += seconds


def _stage(snapshot: dict, stage_id: str) -> dict:
    return next(item for item in snapshot["stages"] if item["id"] == stage_id)


def _run_fake(
    analysis_dir: Path,
    clock: FakeClock,
    *,
    cached_transcript: bool = False,
    snap: bool = True,
    fail_at: str | None = None,
    cancel_at: str | None = None,
    sleeps: dict[str, float] | None = None,
) -> dict:
    durations = sleeps or {
        "extracting": 8.0,
        "transcribing": 18.0,
        "segmenting": 1.4,
        "grouping": 2.0,
        "snapping": 3.0,
        "saving": 0.4,
    }
    with analysis_timing_session(
        analysis_dir,
        pipeline="transcript",
        snap_to_audio=snap,
        now=clock,
    ) as progress:
        progress("extracting", 0.0, "Extracting audio…")
        clock.advance(durations["extracting"])
        progress("extracting", 1.0, "Extracted audio")
        if cached_transcript:
            progress("transcribing", 1.0, "Reusing cached transcript", skipped=True)
        else:
            progress("transcribing", 0.0, "Transcribing…")
            clock.advance(durations["transcribing"])
            if cancel_at == "transcribing":
                raise AnalysisCancelled()
            progress("transcribing", 1.0, "Transcribed")
        progress("segmenting", 0.2, "Building speech segments…")
        clock.advance(durations["segmenting"])
        progress("segmenting", 1.0, "Found 2 segments")
        progress("grouping", 0.2, "Grouping retakes…")
        clock.advance(durations["grouping"])
        if fail_at == "grouping":
            raise RuntimeError("grouping failed")
        if snap:
            progress("snapping", 0.2, "Snapping cuts to the waveform…")
            clock.advance(durations["snapping"])
            progress("snapping", 1.0, "Snapped cuts")
        progress("grouping", 1.0, "Grouped 2 clips")
        progress("saving", 0.0, "Save clips")
        clock.advance(durations["saving"])
        progress("saving", 1.0, "Save clips")
    return json.loads((analysis_dir / "job.json").read_text())["timings"]


def test_fake_pipeline_records_stage_seconds(tmp_path: Path) -> None:
    clock = FakeClock()
    timings = _run_fake(tmp_path, clock)
    by_id = {item["id"]: item for item in timings["stages"]}
    assert by_id["extracting"]["seconds"] == pytest.approx(8.0, abs=0.2)
    assert by_id["transcribing"]["seconds"] == pytest.approx(18.0, abs=0.2)
    assert by_id["segmenting"]["seconds"] == pytest.approx(1.4, abs=0.2)
    assert by_id["grouping"]["seconds"] == pytest.approx(2.0, abs=0.2)
    assert by_id["snapping"]["seconds"] == pytest.approx(3.0, abs=0.2)
    assert by_id["saving"]["seconds"] == pytest.approx(0.4, abs=0.2)
    assert timings["status"] == "ready"
    assert timings["totalSeconds"] == pytest.approx(8 + 18 + 1.4 + 2 + 3 + 0.4, abs=0.2)


def test_cached_transcript_is_skipped(tmp_path: Path) -> None:
    clock = FakeClock()
    timings = _run_fake(tmp_path, clock, cached_transcript=True)
    transcribe = _stage(timings, "transcribing")
    assert transcribe["status"] == "skipped"
    assert transcribe["seconds"] == pytest.approx(0.0, abs=0.2)
    assert transcribe["message"] == "Reusing cached transcript"
    assert _stage(timings, "extracting")["status"] == "done"


def test_snapping_off_omits_stage(tmp_path: Path) -> None:
    clock = FakeClock()
    timings = _run_fake(tmp_path, clock, snap=False)
    assert [item["id"] for item in timings["stages"]] == [
        "extracting",
        "transcribing",
        "segmenting",
        "grouping",
        "saving",
    ]


def test_grouping_error_leaves_later_pending(tmp_path: Path) -> None:
    clock = FakeClock()
    with pytest.raises(RuntimeError, match="grouping failed"):
        _run_fake(tmp_path, clock, fail_at="grouping")
    timings = json.loads((tmp_path / "job.json").read_text())["timings"]
    by_id = {item["id"]: item for item in timings["stages"]}
    assert by_id["grouping"]["status"] == "error"
    assert by_id["snapping"]["status"] == "pending"
    assert by_id["saving"]["status"] == "pending"
    assert timings["status"] == "error"
    assert by_id["grouping"]["seconds"] == pytest.approx(2.0, abs=0.2)


def test_cancel_persists_partial_timings(tmp_path: Path) -> None:
    clock = FakeClock()
    with pytest.raises(AnalysisCancelled):
        _run_fake(tmp_path, clock, cancel_at="transcribing")
    timings = json.loads((tmp_path / "job.json").read_text())["timings"]
    by_id = {item["id"]: item for item in timings["stages"]}
    assert timings["status"] == "cancelled"
    assert by_id["extracting"]["status"] == "done"
    assert by_id["transcribing"]["status"] == "cancelled"
    assert by_id["segmenting"]["status"] == "pending"
    assert by_id["transcribing"]["seconds"] == pytest.approx(18.0, abs=0.2)


def test_tracker_skip_ids_and_scripted_labels() -> None:
    clock = FakeClock()
    tracker = AnalysisTimingsTracker(
        pipeline="scripted",
        snap_to_audio=False,
        skip_ids=("extracting", "transcribing"),
        now=clock,
    )
    ids = [item["id"] for item in tracker.snapshot()["stages"]]
    assert ids == ["extracting", "transcribing", "segmenting", "grouping", "saving"]
    assert _stage(tracker.snapshot(), "extracting")["status"] == "skipped"
    assert _stage(tracker.snapshot(), "segmenting")["label"] == "Align to script"
    assert _stage(tracker.snapshot(), "grouping")["label"] == "Match script lines to takes"
