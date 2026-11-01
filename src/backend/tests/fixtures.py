"""Synthetic Studio project. Keep the timeline in sync with test/helpers/fixture-project.ts."""

from __future__ import annotations

import array
import json
import math
import shutil
import subprocess
import wave
from dataclasses import dataclass, field
from pathlib import Path

RATE = 16000
DURATION_S = 40.0
AMPLITUDE = 8000

# (start, end, kind) kind is "tone", "decay", or "noise".
# Decay is a linear fade from AMPLITUDE at start to silence at end.
REGIONS: list[tuple[float, float, str]] = [
    (1.00, 4.70, "tone"),
    (6.20, 9.90, "tone"),
    (11.40, 13.40, "tone"),
    (13.70, 17.15, "tone"),
    (18.70, 20.60, "tone"),
    (20.60, 20.82, "decay"),
    (22.20, 22.28, "noise"),
    (23.50, 26.30, "tone"),
]

# Words sit inside loud regions. The false-start sentence repeats its first
# four words after a 0.4 s gap so it stays one segment and split_restart cuts it.
WORDS: list[tuple[str, float, float]] = [
    ("alpha", 1.08, 1.48),
    ("beta", 1.58, 1.98),
    ("gamma", 2.08, 2.48),
    ("delta", 2.58, 2.98),
    ("is", 3.08, 3.38),
    ("the", 3.48, 3.78),
    ("answer", 3.88, 4.50),
    ("alpha", 6.28, 6.68),
    ("beta", 6.78, 7.18),
    ("gamma", 7.28, 7.68),
    ("delta", 7.78, 8.18),
    ("is", 8.28, 8.58),
    ("the", 8.68, 8.98),
    ("answer", 9.08, 9.70),
    ("alpha", 11.48, 11.88),
    ("beta", 11.98, 12.38),
    ("gamma", 12.48, 12.88),
    ("delta", 12.98, 13.38),
    ("alpha", 13.78, 14.18),
    ("beta", 14.28, 14.68),
    ("gamma", 14.78, 15.18),
    ("delta", 15.28, 15.68),
    ("is", 15.78, 16.08),
    ("the", 16.18, 16.48),
    ("answer", 16.58, 17.05),
    ("epsilon", 18.78, 19.30),
    ("zeta", 19.50, 20.10),
    ("eta", 20.20, 20.60),
    ("theta", 23.58, 24.10),
    ("iota", 24.30, 24.90),
    ("kappa", 25.10, 26.10),
]

FULL_LINE = "alpha beta gamma delta is the answer"
SCRIPT = "\n".join(
    [
        FULL_LINE,
        "epsilon zeta eta",
        "lambda mu nu",
    ]
)

# Designed transcript clip texts, in source order. The 80 ms noise burst has no words.
EXPECTED_TEXTS = [
    FULL_LINE,
    FULL_LINE,
    "alpha beta gamma delta",
    FULL_LINE,
    "epsilon zeta eta",
    "theta iota kappa",
]


@dataclass
class FixtureProject:
    root: Path
    source: Path
    wav: Path
    words_path: Path
    mp4: Path | None
    script_path: Path | None
    script: str
    words: list[dict] = field(default_factory=list)
    duration_s: float = DURATION_S
    expected_texts: list[str] = field(default_factory=lambda: list(EXPECTED_TEXTS))

    @property
    def clip_count(self) -> int:
        return len(self.expected_texts)


def _sample(t: float) -> int:
    for start, end, kind in REGIONS:
        if t < start or t >= end:
            continue
        if kind == "tone":
            return int(AMPLITUDE * math.sin(2 * math.pi * 440 * t))
        if kind == "decay":
            span = max(1e-6, end - start)
            gain = 1.0 - (t - start) / span
            return int(AMPLITUDE * gain * math.sin(2 * math.pi * 440 * t))
        phase = math.sin(2 * math.pi * 1800 * t)
        return int(6000 * (1 if phase >= 0 else -1))
    return 0


def render_samples(duration_s: float = DURATION_S, rate: int = RATE) -> array.array:
    count = int(round(duration_s * rate))
    samples = array.array("h", [0]) * count
    for index in range(count):
        samples[index] = _sample(index / rate)
    return samples


def write_wav(path: Path, samples: array.array | None = None, rate: int = RATE) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    data = samples if samples is not None else render_samples()
    with wave.open(str(path), "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(rate)
        handle.writeframes(data.tobytes())


def words_payload() -> dict:
    return {"words": [{"text": text, "start": start, "end": end} for text, start, end in WORDS]}


def _write_mp4(wav: Path, mp4: Path) -> bool:
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        return False
    mp4.parent.mkdir(parents=True, exist_ok=True)
    command = [
        ffmpeg,
        "-y",
        "-f",
        "lavfi",
        "-i",
        f"color=c=black:s=160x90:r=1:d={int(DURATION_S)}",
        "-i",
        str(wav),
        "-shortest",
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-preset",
        "ultrafast",
        "-c:a",
        "aac",
        "-b:a",
        "64k",
        str(mp4),
    ]
    completed = subprocess.run(command, capture_output=True, check=False)
    return completed.returncode == 0 and mp4.is_file()


def build_fixture(tmp_path: Path, with_script: bool = False, with_mp4: bool = False) -> FixtureProject:
    """Build a temp project. Does not touch studio/real or any existing studio folder."""
    root = tmp_path / "fixture"
    analysis = root / "analysis"
    analysis.mkdir(parents=True, exist_ok=True)
    source = root / "source.wav"
    samples = render_samples()
    write_wav(source, samples)
    wav = analysis / "source.wav"
    shutil.copyfile(source, wav)
    words_path = analysis / "words.json"
    payload = words_payload()
    words_path.write_text(json.dumps(payload))
    script_path = None
    if with_script:
        script_path = root / "script.txt"
        script_path.write_text(SCRIPT + "\n")
    mp4 = None
    if with_mp4:
        candidate = root / "source.mp4"
        if _write_mp4(source, candidate):
            mp4 = candidate
    return FixtureProject(
        root=root,
        source=source,
        wav=wav,
        words_path=words_path,
        mp4=mp4,
        script_path=script_path,
        script=SCRIPT if with_script else "",
        words=payload["words"],
    )
