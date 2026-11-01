"""HTTP coverage for /api/audio-studio. Whisper stays off because words.json is already written."""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

from app.services.ffmpeg import ffmpeg_available
from tests.fixtures import build_fixture


def _wait(client, job_id: str) -> dict:
    phases: list[dict] = []
    with client.stream("GET", f"/api/audio-studio/progress/{job_id}") as response:
        assert response.status_code == 200
        for line in response.iter_lines():
            if not line.startswith("data:"):
                continue
            payload = json.loads(line[5:])
            if payload.get("phase"):
                phases.append(payload)
            phase = payload.get("phase")
            if phase == "error":
                raise AssertionError(payload.get("message") or payload)
            if phase in {"complete", "cancelled"} or payload.get("done"):
                if phase in {"complete", "cancelled"}:
                    break
    complete = next(item for item in phases if item.get("phase") == "complete")
    message = complete.get("message") or ""
    if message[:1] not in "{[":
        return {"message": message}
    return json.loads(message)


def _tiny_mp4(path: Path) -> None:
    ffmpeg = shutil.which("ffmpeg")
    assert ffmpeg
    path.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        [
            ffmpeg,
            "-y",
            "-f",
            "lavfi",
            "-i",
            "testsrc=size=160x90:rate=30:duration=2",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:sample_rate=48000:duration=2",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            "-shortest",
            str(path),
        ],
        check=True,
        capture_output=True,
    )


def test_analyze_reanalyze_peaks_ranges_and_errors(tmp_path: Path, client) -> None:
    fixture = build_fixture(tmp_path)
    started = client.post(
        "/api/audio-studio/analyze/async",
        json={
            "sourcePath": str(fixture.source),
            "analysisDir": str(fixture.root / "analysis"),
            "pipeline": "transcript",
            "scriptWhisperPrompt": False,
        },
    )
    assert started.status_code == 200
    payload = _wait(client, started.json()["jobId"])
    assert payload["pipeline"] == "transcript"
    assert len(payload["clips"]) == fixture.clip_count

    again = client.post(
        "/api/audio-studio/reanalyze/async",
        json={
            "sourcePath": str(fixture.source),
            "analysisDir": str(fixture.root / "analysis"),
            "mode": "resegment",
            "rangeStart": 1.0,
            "rangeEnd": 5.0,
            "clips": payload["clips"],
            "scriptWhisperPrompt": False,
        },
    )
    assert again.status_code == 200
    regrouped = _wait(client, again.json()["jobId"])
    assert regrouped["clips"]

    missing = client.post(
        "/api/audio-studio/reanalyze/async",
        json={
            "sourcePath": str(fixture.source),
            "analysisDir": str(tmp_path / "nope"),
            "mode": "resegment",
        },
    )
    assert missing.status_code == 404

    peaks = client.get(
        "/api/audio-studio/clip-peaks",
        params={"wav": str(fixture.wav), "ranges": "1.0,2.0", "buckets": 16},
    )
    assert peaks.status_code == 200
    assert len(peaks.json()["peaks"]) == 32

    stats = client.get("/api/audio-studio/audio-stats", params={"wav": str(fixture.wav), "ranges": "1.0,2.0"})
    assert stats.status_code == 200
    assert "startEdge" in stats.json()

    audio = client.get("/api/audio-studio/clip-audio", params={"wav": str(fixture.wav), "ranges": "1.0,1.5", "pad": 0})
    padded = client.get("/api/audio-studio/clip-audio", params={"wav": str(fixture.wav), "ranges": "1.0,1.5", "pad": 0.1})
    assert audio.status_code == 200
    assert padded.status_code == 200
    assert len(padded.content) > len(audio.content)

    size = len(audio.content)
    opened = client.get(
        "/api/audio-studio/clip-audio",
        params={"wav": str(fixture.wav), "ranges": "1.0,1.5"},
        headers={"Range": "bytes=0-"},
    )
    middle = client.get(
        "/api/audio-studio/clip-audio",
        params={"wav": str(fixture.wav), "ranges": "1.0,1.5"},
        headers={"Range": "bytes=44-75"},
    )
    suffix = client.get(
        "/api/audio-studio/clip-audio",
        params={"wav": str(fixture.wav), "ranges": "1.0,1.5"},
        headers={"Range": f"bytes=-{min(16, size)}"},
    )
    invalid = client.get(
        "/api/audio-studio/clip-audio",
        params={"wav": str(fixture.wav), "ranges": "1.0,1.5"},
        headers={"Range": f"bytes={size + 10}-{size + 20}"},
    )
    past = client.get(
        "/api/audio-studio/clip-audio",
        params={"wav": str(fixture.wav), "ranges": "1.0,1.5"},
        headers={"Range": f"bytes={size - 8}-{size + 100}"},
    )
    assert opened.status_code == 206
    assert opened.headers["content-range"].startswith("bytes 0-")
    assert middle.status_code == 206
    assert len(middle.content) == 32
    assert suffix.status_code == 206
    assert len(suffix.content) == min(16, size)
    assert invalid.status_code == 416
    assert past.status_code == 206
    assert len(past.content) == 8

    gone = client.get("/api/audio-studio/clip-audio", params={"wav": str(tmp_path / "missing.wav"), "ranges": "0,1"})
    assert gone.status_code == 404
    bad = client.get("/api/audio-studio/clip-audio", params={"wav": str(fixture.wav), "ranges": "nope"})
    assert bad.status_code == 400
    unprocessable = client.get("/api/audio-studio/clip-peaks", params={"wav": str(fixture.wav)})
    assert unprocessable.status_code == 422
    segments = client.post("/api/audio-studio/segments", json={"analysisDir": str(fixture.root / "analysis")})
    assert segments.status_code == 200
    assert segments.json()["segments"]


@pytest.mark.skipif(not ffmpeg_available() or shutil.which("ffmpeg") is None, reason="ffmpeg is not installed")
def test_frame_and_render_http(tmp_path: Path, client) -> None:
    source = tmp_path / "tiny.mp4"
    _tiny_mp4(source)
    frame = client.get("/api/audio-studio/frame.png", params={"source": str(source), "at": 0})
    assert frame.status_code == 200
    assert frame.content[:8] == b"\x89PNG\r\n\x1a\n"
    output = tmp_path / "out" / "preview.mp4"
    started = client.post(
        "/api/audio-studio/render/async",
        json={
            "sourcePath": str(source),
            "outputPath": str(output),
            "quality": "preview",
            "clips": [{"id": "c-0001", "ranges": [{"sourceStart": 0.2, "sourceEnd": 1.2}]}],
        },
    )
    assert started.status_code == 200
    body = _wait(client, started.json()["jobId"])
    assert body["duration"] > 0
    assert output.is_file()
