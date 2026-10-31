from __future__ import annotations

import array
import hashlib
import json
import math
import wave
from pathlib import Path

FULL_SCALE = 32768.0
EDGE_SECONDS = 0.15
WINDOW_SECONDS = 0.02
SILENCE_DBFS = -40.0


def _dbfs(level: float) -> float:
    if level <= 1e-9:
        return -100.0
    return round(20.0 * math.log10(level / FULL_SCALE), 2)


def _slice(samples: array.array, rate: int, start: float, end: float) -> array.array:
    start_i = max(0, int(round(start * rate)))
    end_i = min(len(samples), int(round(max(start, end) * rate)))
    return samples[start_i:end_i]


def _levels(chunk: array.array) -> dict[str, float]:
    if len(chunk) == 0:
        return {"rmsDbfs": -100.0, "peakDbfs": -100.0}
    peak = max(abs(sample) for sample in chunk)
    mean_square = sum(sample * sample for sample in chunk) / len(chunk)
    return {"rmsDbfs": _dbfs(math.sqrt(mean_square)), "peakDbfs": _dbfs(float(peak))}


def _longest_silence(samples: array.array, rate: int) -> float:
    window = max(1, int(rate * WINDOW_SECONDS))
    run = 0
    best = 0
    for offset in range(0, len(samples), window):
        chunk = samples[offset : offset + window]
        if len(chunk) == 0:
            break
        mean_square = sum(sample * sample for sample in chunk) / len(chunk)
        if _dbfs(math.sqrt(mean_square)) < SILENCE_DBFS:
            run += len(chunk)
            best = max(best, run)
        else:
            run = 0
    return round(best / rate, 3)


def _load_wav(wav_path: Path) -> tuple[array.array, int]:
    with wave.open(str(wav_path), "rb") as handle:
        if handle.getnchannels() != 1 or handle.getsampwidth() != 2:
            raise ValueError("cached wav must be 16-bit mono")
        rate = handle.getframerate()
        payload = array.array("h")
        payload.frombytes(handle.readframes(handle.getnframes()))
    return payload, rate


def clip_audio_stats(
    wav_path: Path,
    ranges: list[tuple[float, float]],
    *,
    cache_dir: Path | None = None,
) -> dict:
    if not ranges:
        raise ValueError("at least one range is required")
    key = hashlib.sha256(json.dumps(ranges).encode()).hexdigest()[:16]
    cache_path = (cache_dir / f"{key}.json") if cache_dir else None
    if cache_path and cache_path.is_file():
        return json.loads(cache_path.read_text())

    samples, rate = _load_wav(wav_path)
    duration = len(samples) / rate if rate else 0.0
    start = ranges[0][0]
    end = ranges[-1][1]
    inside = array.array("h")
    for range_start, range_end in ranges:
        inside.extend(_slice(samples, rate, range_start, range_end))

    payload = {
        "start": _levels(_slice(samples, rate, start, start + EDGE_SECONDS)),
        "end": _levels(_slice(samples, rate, end - EDGE_SECONDS, end)),
        "before": _levels(_slice(samples, rate, start - EDGE_SECONDS, start)),
        "after": _levels(_slice(samples, rate, end, min(duration, end + EDGE_SECONDS))),
        "longestSilenceSeconds": _longest_silence(inside, rate),
    }
    if cache_path:
        cache_path.parent.mkdir(parents=True, exist_ok=True)
        cache_path.write_text(json.dumps(payload))
    return payload
