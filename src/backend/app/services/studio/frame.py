from __future__ import annotations

from pathlib import Path

from app.config import settings
from app.services.ffmpeg import run_command


def extract_frame(source: Path, output: Path, at: float) -> None:
    """Grab one decoded frame at `at` seconds (accurate seek, not keyframe-only)."""
    if at < 0:
        raise ValueError("at must be >= 0")
    output.parent.mkdir(parents=True, exist_ok=True)
    run_command(
        [
            settings.ffmpeg,
            "-y",
            "-i",
            str(source),
            "-ss",
            f"{at:.6f}",
            "-frames:v",
            "1",
            str(output),
        ]
    )
