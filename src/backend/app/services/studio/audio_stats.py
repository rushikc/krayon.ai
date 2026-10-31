from __future__ import annotations

import array
import hashlib
import json
import math
import wave
from pathlib import Path

FULL_SCALE = 32768.0
EDGE_SECONDS = 0.15
CLIP_EDGE_SECONDS = 0.02
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
        "startEdge": _levels(_slice(samples, rate, start, start + CLIP_EDGE_SECONDS)),
        "endEdge": _levels(_slice(samples, rate, end - CLIP_EDGE_SECONDS, end)),
        "before": _levels(_slice(samples, rate, start - EDGE_SECONDS, start)),
        "after": _levels(_slice(samples, rate, end, min(duration, end + EDGE_SECONDS))),
        "longestSilenceSeconds": _longest_silence(inside, rate),
    }
    if cache_path:
        cache_path.parent.mkdir(parents=True, exist_ok=True)
        cache_path.write_text(json.dumps(payload))
    return payload


def _pad_ranges(ranges: list[tuple[float, float]], pad: float) -> list[tuple[float, float]]:
    if pad < 0:
        raise ValueError("pad must be >= 0")
    padded: list[tuple[float, float]] = []
    last = len(ranges) - 1
    for index, (start, end) in enumerate(ranges):
        left = start - pad if index == 0 else start
        right = end + pad if index == last else end
        padded.append((max(0.0, left), max(left, right)))
    return padded


def clip_peaks(
    wav_path: Path,
    ranges: list[tuple[float, float]],
    *,
    pad: float = 0.0,
    buckets: int = 800,
    cache_dir: Path | None = None,
) -> dict:
    if not ranges:
        raise ValueError("at least one range is required")
    count = max(1, min(int(buckets), 4096))
    padded = _pad_ranges(ranges, pad)
    key = hashlib.sha256(json.dumps({"ranges": padded, "buckets": count}).encode()).hexdigest()[:16]
    cache_path = (cache_dir / f"{key}.json") if cache_dir else None
    if cache_path and cache_path.is_file():
        return json.loads(cache_path.read_text())

    samples, rate = _load_wav(wav_path)
    inside = array.array("h")
    for start, end in padded:
        inside.extend(_slice(samples, rate, start, end))
    length = len(inside)
    peaks: list[float] = []
    if length == 0:
        peaks = [0.0, 0.0] * count
    else:
        for index in range(count):
            start_i = int(index * length / count)
            end_i = int((index + 1) * length / count)
            chunk = inside[start_i:end_i]
            if len(chunk) == 0:
                chunk = array.array("h", [0])
            low = max(-1.0, min(1.0, min(chunk) / FULL_SCALE))
            high = max(-1.0, min(1.0, max(chunk) / FULL_SCALE))
            peaks.extend([round(low, 4), round(high, 4)])
    payload = {"duration": round(length / rate, 6) if rate else 0.0, "peaks": peaks}
    if cache_path:
        cache_path.parent.mkdir(parents=True, exist_ok=True)
        cache_path.write_text(json.dumps(payload))
    return payload
