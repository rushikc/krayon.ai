from __future__ import annotations

import tomllib
from pathlib import Path
from typing import Any

from pydantic_settings import BaseSettings, SettingsConfigDict

_CONFIG_PATH = Path(__file__).resolve().parents[1] / "krayon.toml"


def _load_toml_defaults() -> dict[str, Any]:
    if not _CONFIG_PATH.exists():
        return {}
    with _CONFIG_PATH.open("rb") as f:
        raw = tomllib.load(f)

    whisper = raw.get("whisper", {})
    silence = raw.get("silence", {})
    clips = raw.get("clips", {})
    paths = raw.get("paths", {})

    return {
        "ffmpeg": paths.get("ffmpeg", "ffmpeg"),
        "ffprobe": paths.get("ffprobe", "ffprobe"),
        "whisper_model": whisper.get("model", "base"),
        "whisper_device": whisper.get("device", "cpu"),
        "whisper_compute_type": whisper.get("compute_type", "int8"),
        "whisper_warmup_on_startup": whisper.get("warmup_on_startup", True),
        "whisper_beam_size": whisper.get("beam_size", 1),
        "whisper_condition_on_previous_text": whisper.get("condition_on_previous_text", False),
        "silence_threshold": silence.get("threshold", 0.4),
        "silence_pad": silence.get("pad", 0.05),
        "min_segment_seconds": silence.get("min_segment_seconds", 0.05),
        "tail_max_extend_s": silence.get("tail_max_extend_s", 0.3),
        "clip_similarity_threshold": clips.get("similarity_threshold", 0.7),
    }


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="KRAYON_", extra="ignore")

    ffmpeg: str = "ffmpeg"
    ffprobe: str = "ffprobe"
    whisper_model: str = "base"
    whisper_device: str = "cpu"
    whisper_compute_type: str = "int8"
    whisper_download_root: str | None = None
    whisper_warmup_on_startup: bool = True
    whisper_beam_size: int = 1
    whisper_condition_on_previous_text: bool = False

    silence_threshold: float = 0.4
    silence_pad: float = 0.05
    min_segment_seconds: float = 0.05
    tail_max_extend_s: float = 0.3

    clip_similarity_threshold: float = 0.7

    cors_origins: list[str] = ["http://localhost:5173", "http://127.0.0.1:5173"]


settings = Settings(**_load_toml_defaults())
