from __future__ import annotations

from collections.abc import Callable, Iterator
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal

from app.services.studio.common.project import write_checkpoint
from app.services.studio.transcribe_resume import AnalysisCancelled

StageId = Literal["extracting", "transcribing", "segmenting", "grouping", "snapping", "saving"]
PipelineKind = Literal["transcript", "scripted"]
JobStatus = Literal["running", "ready", "error", "cancelled"]
StageStatus = Literal["pending", "running", "done", "skipped", "error", "cancelled"]

PHASE_ORDER: tuple[StageId, ...] = (
    "extracting",
    "transcribing",
    "segmenting",
    "grouping",
    "snapping",
    "saving",
)

STAGE_LABELS: dict[PipelineKind, dict[StageId, str]] = {
    "transcript": {
        "extracting": "Extract audio",
        "transcribing": "Transcribe",
        "segmenting": "Cut by silence",
        "grouping": "Group retakes",
        "snapping": "Snap cuts to the waveform",
        "saving": "Save clips",
    },
    "scripted": {
        "extracting": "Extract audio",
        "transcribing": "Transcribe",
        "segmenting": "Align to script",
        "grouping": "Match script lines to takes",
        "snapping": "Snap cuts to the waveform",
        "saving": "Save clips",
    },
}

SKIP_MESSAGES: dict[StageId, str] = {
    "extracting": "Reusing cached audio",
    "transcribing": "Reusing cached transcript",
    "segmenting": "Reusing cached transcript",
    "grouping": "Reusing cached transcript",
    "snapping": "Reusing cached transcript",
    "saving": "Reusing cached transcript",
}

NowFn = Callable[[], float]


def _iso(ts: float) -> str:
    return datetime.fromtimestamp(ts, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def _round_seconds(value: float) -> float:
    return round(max(0.0, value), 3)


def _phase_index(phase: str) -> int:
    try:
        return PHASE_ORDER.index(phase)  # type: ignore[arg-type]
    except ValueError:
        return -1


class AnalysisTimingsTracker:
    def __init__(
        self,
        *,
        pipeline: PipelineKind = "transcript",
        snap_to_audio: bool = True,
        skip_ids: tuple[str, ...] = (),
        now: NowFn | None = None,
    ) -> None:
        self._now = now or (lambda: datetime.now(timezone.utc).timestamp())
        self.pipeline: PipelineKind = pipeline if pipeline == "scripted" else "transcript"
        t0 = self._now()
        self._t0 = t0
        self.started_at = _iso(t0)
        self.finished_at: str | None = None
        self.status: JobStatus = "running"
        labels = STAGE_LABELS[self.pipeline]
        ids: list[StageId] = ["extracting", "transcribing", "segmenting", "grouping"]
        if snap_to_audio:
            ids.append("snapping")
        ids.append("saving")
        self.stages: list[dict[str, object]] = [
            {
                "id": stage_id,
                "label": labels[stage_id],
                "startedAt": None,
                "finishedAt": None,
                "seconds": 0.0,
                "status": "pending",
                "message": None,
                "_t0": None,
            }
            for stage_id in ids
        ]
        for stage_id in skip_ids:
            self.skip(stage_id, SKIP_MESSAGES.get(stage_id, "Reusing cached transcript"))  # type: ignore[arg-type]

    def _stage(self, phase: str) -> dict[str, object] | None:
        for stage in self.stages:
            if stage["id"] == phase:
                return stage
        return None

    def _complete(self, stage: dict[str, object], now: float, status: StageStatus) -> None:
        started = stage.get("_t0")
        t0 = float(started) if isinstance(started, (int, float)) else now
        stage["finishedAt"] = _iso(now)
        stage["seconds"] = _round_seconds(now - t0)
        stage["status"] = status
        stage["_t0"] = None

    def _close_running_before(self, phase: str, now: float) -> None:
        idx = _phase_index(phase)
        if idx < 0:
            return
        for stage in self.stages:
            if stage["status"] != "running":
                continue
            if _phase_index(str(stage["id"])) < idx:
                self._complete(stage, now, "done")

    def _start_if_needed(self, stage: dict[str, object], now: float) -> None:
        if stage["status"] != "pending":
            return
        stage["status"] = "running"
        stage["startedAt"] = _iso(now)
        stage["_t0"] = now
        stage["seconds"] = 0.0

    def snapshot(self) -> dict[str, object]:
        now = self._now()
        finished = self.finished_at
        if finished:
            total = _round_seconds(datetime.fromisoformat(finished.replace("Z", "+00:00")).timestamp() - self._t0)
        else:
            total = _round_seconds(now - self._t0)
        stages: list[dict[str, object]] = []
        for stage in self.stages:
            row = {key: value for key, value in stage.items() if not str(key).startswith("_")}
            if stage["status"] == "running":
                started = stage.get("_t0")
                t0 = float(started) if isinstance(started, (int, float)) else now
                row["seconds"] = _round_seconds(now - t0)
            stages.append(row)
        return {
            "startedAt": self.started_at,
            "finishedAt": self.finished_at,
            "totalSeconds": total,
            "pipeline": self.pipeline,
            "status": self.status,
            "stages": stages,
        }

    def progress(self, phase: str, ratio: float, message: str) -> dict[str, object]:
        now = self._now()
        stage = self._stage(phase)
        if stage is None:
            return self.snapshot()
        self._close_running_before(phase, now)
        terminal = {"done", "skipped", "error", "cancelled"}
        if stage["status"] in terminal:
            if message:
                stage["message"] = message
            return self.snapshot()
        self._start_if_needed(stage, now)
        stage["message"] = message
        if ratio >= 1.0:
            self._complete(stage, now, "done")
        else:
            started = stage.get("_t0")
            t0 = float(started) if isinstance(started, (int, float)) else now
            stage["seconds"] = _round_seconds(now - t0)
        return self.snapshot()

    def skip(self, phase: str, message: str) -> dict[str, object]:
        now = self._now()
        stage = self._stage(phase)
        if stage is None:
            return self.snapshot()
        self._close_running_before(phase, now)
        if stage["status"] in {"done", "skipped", "error", "cancelled"}:
            stage["message"] = message
            return self.snapshot()
        if stage["status"] == "pending":
            stage["startedAt"] = _iso(now)
            stage["_t0"] = now
        stage["message"] = message
        self._complete(stage, now, "skipped")
        return self.snapshot()

    def finish(self, status: JobStatus) -> dict[str, object]:
        now = self._now()
        if status == "ready":
            for stage in self.stages:
                if stage["status"] == "running":
                    self._complete(stage, now, "done")
                elif stage["status"] == "pending":
                    stage["startedAt"] = stage["startedAt"] or _iso(now)
                    stage["_t0"] = now
                    self._complete(stage, now, "skipped")
        else:
            stage_status: StageStatus = "cancelled" if status == "cancelled" else "error"
            for stage in self.stages:
                if stage["status"] == "running":
                    self._complete(stage, now, stage_status)
        self.status = status
        self.finished_at = _iso(now)
        return self.snapshot()

    def current_phase(self) -> str:
        for stage in self.stages:
            if stage["status"] == "running":
                return str(stage["id"])
        for stage in reversed(self.stages):
            if stage["status"] != "pending":
                return str(stage["id"])
        return str(self.stages[0]["id"]) if self.stages else "extracting"


@contextmanager
def analysis_timing_session(
    analysis_dir: Path,
    *,
    pipeline: PipelineKind = "transcript",
    snap_to_audio: bool = True,
    on_progress: Callable[[str, float, str], None] | None = None,
    skip_ids: tuple[str, ...] = (),
    now: NowFn | None = None,
) -> Iterator[Callable[..., dict[str, object]]]:
    analysis_dir.mkdir(parents=True, exist_ok=True)
    tracker = AnalysisTimingsTracker(
        pipeline=pipeline,
        snap_to_audio=snap_to_audio,
        skip_ids=skip_ids,
        now=now,
    )
    write_checkpoint(
        analysis_dir,
        tracker.current_phase(),
        "Starting analysis",
        0.0,
        timings=tracker.snapshot(),
    )

    def progress(phase: str, ratio: float, message: str, *, skipped: bool = False) -> dict[str, object]:
        timings = tracker.skip(phase, message) if skipped else tracker.progress(phase, ratio, message)
        write_checkpoint(analysis_dir, phase, message, ratio, timings=timings)
        if on_progress:
            on_progress(phase, ratio, message)
        return timings

    try:
        yield progress
        timings = tracker.finish("ready")
        write_checkpoint(analysis_dir, "saving", "Save clips", 1.0, timings=timings)
    except AnalysisCancelled:
        timings = tracker.finish("cancelled")
        write_checkpoint(analysis_dir, tracker.current_phase(), "cancelled", None, timings=timings)
        raise
    except Exception as exc:
        timings = tracker.finish("error")
        write_checkpoint(analysis_dir, tracker.current_phase(), str(exc), None, timings=timings)
        raise
