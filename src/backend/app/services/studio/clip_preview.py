from __future__ import annotations

from pathlib import Path

from app.services.clip_audio import _slice_wav


def slice_clip_audio(
    wav_path: Path,
    output: Path,
    ranges: list[tuple[float, float]],
    *,
    pad: float = 0.0,
) -> None:
    """Slice clip ranges from the cached WAV, with padding on the outer edges."""
    if not ranges:
        raise ValueError("at least one range is required")
    if pad < 0:
        raise ValueError("pad must be >= 0")

    padded: list[tuple[float, float]] = []
    last = len(ranges) - 1
    for index, (start, end) in enumerate(ranges):
        left = start - pad if index == 0 else start
        right = end + pad if index == last else end
        padded.append((max(0.0, left), max(left, right)))
    _slice_wav(wav_path, output, padded)
