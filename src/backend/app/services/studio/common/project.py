from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal

from app.schemas import ClipGroup, ClipItem, WordTiming

PipelineName = Literal["auto", "transcript", "scripted"]


@dataclass
class StudioAnalysis:
    source_duration: float
    fps: float
    words: list[WordTiming]
    clips: list[ClipItem]
    groups: list[ClipGroup]
    scores: dict[str, dict]
    removed_seconds: float
    pipeline: str = "transcript"
    clip_meta: dict[str, dict] = field(default_factory=dict)
    group_meta: dict[str, dict] = field(default_factory=dict)


@dataclass
class ProjectAudio:
    source: Path
    analysis_dir: Path


RECENCY_LAST = 0.10
RECENCY_SECOND = 0.06
RECENCY_THIRD = 0.03
COMPLETENESS_BONUS = 0.08
INTERNAL_PAUSE_S = 0.8
INTERNAL_PAUSE_PENALTY = 0.15
WHISPER_PROMPT_MAX_CHARS = 800


def write_checkpoint(analysis_dir: Path, phase: str, message: str) -> None:
    path = analysis_dir / "job.json"
    path.write_text(json.dumps({"phase": phase, "message": message}))


@dataclass
class PipelineOptions:
    silence_threshold: float
    pad: float
    similarity_threshold: float
    language: str | None = "en"
    snap_to_audio: bool = True
    snap_search_seconds: float = 0.3
    pipeline: PipelineName = "auto"
    script_match_threshold: float = 0.7
    script_confirm_threshold: float = 0.85
    script_prefer_last_takes: bool = True
    script_whisper_prompt: bool = True
    recency_last: float = RECENCY_LAST
    recency_second: float = RECENCY_SECOND
    recency_third: float = RECENCY_THIRD
    completeness_bonus: float = COMPLETENESS_BONUS
    internal_pause_s: float = INTERNAL_PAUSE_S
    internal_pause_penalty: float = INTERNAL_PAUSE_PENALTY
    initial_prompt: str | None = None
