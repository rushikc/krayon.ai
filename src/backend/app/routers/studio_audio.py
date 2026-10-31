from __future__ import annotations

import json
import tempfile
import threading
import uuid
from pathlib import Path

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel, ConfigDict, Field

from app.schemas import ClipItem
from app.services.jobs import SSE_HEADERS, job_hub
from app.services.segments import build_segments_from_words
from app.services.studio.analyze import StudioAnalysis, analyze_project
from app.services.studio.audio_stats import clip_audio_stats
from app.services.studio.clip_preview import slice_clip_audio
from app.services.studio.frame import extract_frame
from app.services.studio.pick_file import pick_video_macos
from app.services.studio.reanalyze import reanalyze_project
from app.services.studio.render import RenderCancelled, RenderClipIn, render_video
from app.services.studio.transcribe_resume import load_words

router = APIRouter(prefix="/api/audio-studio", tags=["audio-studio"])


class _Camel(BaseModel):
    model_config = ConfigDict(populate_by_name=True)


class AnalyzeBody(_Camel):
    source_path: str = Field(alias="sourcePath")
    analysis_dir: str = Field(alias="analysisDir")
    silence_threshold: float = Field(default=0.4, alias="silenceThreshold")
    pad: float = 0.05
    similarity_threshold: float = Field(default=0.7, alias="similarityThreshold")
    language: str | None = "en"


class ReanalyzeBody(AnalyzeBody):
    mode: str
    range_start: float | None = Field(default=None, alias="rangeStart")
    range_end: float | None = Field(default=None, alias="rangeEnd")
    clips: list[ClipItem] = Field(default_factory=list)


class RenderRangeBody(_Camel):
    source_start: float = Field(alias="sourceStart")
    source_end: float = Field(alias="sourceEnd")


class RenderClipBody(_Camel):
    id: str
    ranges: list[RenderRangeBody]


class RenderBody(_Camel):
    source_path: str = Field(alias="sourcePath")
    output_path: str = Field(alias="outputPath")
    quality: str = "final"
    clips: list[RenderClipBody]


def _analysis_payload(result: StudioAnalysis) -> dict:
    return {
        "sourceDuration": result.source_duration,
        "fps": result.fps,
        "removedSeconds": result.removed_seconds,
        "words": [word.model_dump() for word in result.words],
        "clips": [clip.model_dump(by_alias=True) for clip in result.clips],
        "groups": [group.model_dump(by_alias=True) for group in result.groups],
        "scores": result.scores,
        "scope": "full",
        "rangeStart": None,
        "rangeEnd": None,
    }


def _start_job(work) -> dict:
    job_id = str(uuid.uuid4())
    job_hub.create_job(job_id)

    def run() -> None:
        def on_progress(phase: str, ratio: float, message: str) -> None:
            job_hub.publish(job_id, phase, ratio, message, step_progress=ratio)

        try:
            payload = work(on_progress, job_id)
            if job_hub.is_cancelled(job_id):
                job_hub.publish(job_id, "cancelled", 1.0, "cancelled", step_progress=1.0)
            else:
                job_hub.publish(job_id, "complete", 1.0, json.dumps(payload), step_progress=1.0)
        except RenderCancelled:
            job_hub.publish(job_id, "cancelled", 1.0, "cancelled", step_progress=1.0)
        except Exception as exc:
            if job_hub.is_cancelled(job_id):
                job_hub.publish(job_id, "cancelled", 1.0, "cancelled", step_progress=1.0)
            else:
                job_hub.publish(job_id, "error", 1.0, str(exc), step_progress=1.0)
        finally:
            job_hub.finish(job_id)

    threading.Thread(target=run, daemon=True, name=f"studio-{job_id[:8]}").start()
    return {"jobId": job_id}


def _require_file(path: Path, label: str) -> Path:
    resolved = path.expanduser().resolve()
    if not resolved.is_file():
        raise HTTPException(status_code=404, detail=f"{label} not found")
    return resolved


@router.post("/pick-file")
def pick_file() -> dict:
    try:
        path = pick_video_macos()
    except RuntimeError as exc:
        raise HTTPException(status_code=501, detail=str(exc)) from exc
    if path is None:
        return {"path": None, "cancelled": True}
    return {"path": path, "cancelled": False}


@router.post("/analyze/async")
def analyze_async(body: AnalyzeBody) -> dict:
    source = _require_file(Path(body.source_path), "Source")
    analysis_dir = Path(body.analysis_dir).expanduser().resolve()

    def work(on_progress, _job_id=None):
        result = analyze_project(
            source,
            analysis_dir,
            silence_threshold=body.silence_threshold,
            pad=body.pad,
            similarity_threshold=body.similarity_threshold,
            language=body.language,
            on_progress=on_progress,
        )
        return _analysis_payload(result)

    return _start_job(work)


@router.post("/reanalyze/async")
def reanalyze_async(body: ReanalyzeBody) -> dict:
    source = _require_file(Path(body.source_path), "Source")
    analysis_dir = Path(body.analysis_dir).expanduser().resolve()
    if not analysis_dir.is_dir():
        raise HTTPException(status_code=404, detail="Analysis directory not found")

    def work(on_progress, _job_id=None):
        return reanalyze_project(
            source,
            analysis_dir,
            mode=body.mode,
            clips=body.clips,
            range_start=body.range_start,
            range_end=body.range_end,
            silence_threshold=body.silence_threshold,
            pad=body.pad,
            similarity_threshold=body.similarity_threshold,
            language=body.language,
            on_progress=on_progress,
        )

    return _start_job(work)


@router.get("/progress/{job_id}")
async def progress(job_id: str) -> StreamingResponse:
    return StreamingResponse(job_hub.stream(job_id), media_type="text/event-stream", headers=SSE_HEADERS)


def _parse_ranges(text: str) -> list[tuple[float, float]]:
    ranges: list[tuple[float, float]] = []
    for part in text.split(";"):
        piece = part.strip()
        if not piece:
            continue
        bits = piece.split(",")
        if len(bits) != 2:
            raise HTTPException(status_code=400, detail="ranges must be start,end pairs separated by ';'")
        start, end = float(bits[0]), float(bits[1])
        if end <= start:
            raise HTTPException(status_code=400, detail="range end must be after start")
        ranges.append((start, end))
    if not ranges:
        raise HTTPException(status_code=400, detail="ranges are required")
    return ranges


@router.get("/clip-audio")
def clip_audio(
    wav: str = Query(),
    ranges: str = Query(),
    pad: float = Query(default=0.0),
) -> FileResponse:
    wav_path = _require_file(Path(wav), "WAV")
    parsed = _parse_ranges(ranges)
    output = wav_path.parent / "previews" / f"clip-{uuid.uuid4().hex}.wav"
    try:
        slice_clip_audio(wav_path, output, parsed, pad=pad)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return FileResponse(output, media_type="audio/wav", filename="clip.wav")


@router.get("/audio-stats")
def audio_stats(wav: str = Query(), ranges: str = Query()) -> dict:
    wav_path = _require_file(Path(wav), "WAV")
    parsed = _parse_ranges(ranges)
    try:
        return clip_audio_stats(wav_path, parsed, cache_dir=wav_path.parent / "audio-stats")
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/frame.png")
def frame_png(source: str = Query(), at: float = Query()) -> FileResponse:
    source_path = _require_file(Path(source), "Source")
    output = Path(tempfile.gettempdir()) / f"krayon-frame-{uuid.uuid4().hex}.png"
    try:
        extract_frame(source_path, output, at)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return FileResponse(output, media_type="image/png", filename="frame.png")


@router.post("/render/async")
def render_async(body: RenderBody) -> dict:
    source = _require_file(Path(body.source_path), "Source")
    output = Path(body.output_path).expanduser().resolve()
    clips = [
        RenderClipIn(
            clip_id=clip.id,
            ranges=[(span.source_start, span.source_end) for span in clip.ranges],
        )
        for clip in body.clips
    ]

    def work(on_progress, job_id=None):
        return render_video(
            source,
            output,
            clips,
            quality=body.quality,
            on_progress=on_progress,
            register_process=lambda process: job_hub.register_process(job_id, process) if job_id else None,
            cancelled=lambda: job_hub.is_cancelled(job_id) if job_id else False,
        )

    return _start_job(work)


class SegmentsBody(_Camel):
    analysis_dir: str = Field(alias="analysisDir")
    silence_threshold: float = Field(default=0.4, alias="silenceThreshold")
    pad: float = 0.05
    source_duration: float | None = Field(default=None, alias="sourceDuration")


@router.post("/segments")
def list_segments(body: SegmentsBody) -> dict:
    analysis_dir = Path(body.analysis_dir).expanduser().resolve()
    words_path = analysis_dir / "words.json"
    if not words_path.is_file():
        raise HTTPException(status_code=404, detail="words.json is missing; run analysis first")
    words = load_words(words_path)
    duration = body.source_duration
    if duration is None:
        duration = words[-1].end if words else 0.0
    segments = build_segments_from_words(
        words,
        silence_threshold=body.silence_threshold,
        pad=body.pad,
        source_duration=duration,
    )
    items = []
    for segment in segments:
        text = " ".join(
            word.text
            for word in words
            if word.end > segment.source_start and word.start < segment.source_end
        )
        items.append(
            {
                "kind": "speech",
                "sourceStart": segment.source_start,
                "sourceEnd": segment.source_end,
                "duration": segment.duration,
                "text": text,
            }
        )
    return {"sourceDuration": duration, "segments": items}


@router.post("/jobs/{job_id}/cancel")
def cancel_job(job_id: str) -> dict:
    if not job_hub.cancel(job_id):
        raise HTTPException(status_code=404, detail="Unknown job")
    return {"jobId": job_id, "status": "cancelled"}
