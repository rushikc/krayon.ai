from __future__ import annotations

import array
import json
import math
import shutil
import wave
from pathlib import Path

import pytest

from app.services.ffmpeg import ffmpeg_available, probe_media
from app.services.segments import Word
from app.services.studio.analyze import analyze_project
from app.services.studio.clip_preview import slice_clip_audio
from app.services.studio.reanalyze import splice_words
from app.services.studio.render import RenderClipIn, manifest_for, render_command, render_video
from app.services.studio.transcribe_resume import save_words

RATE = 16000


def _write_wav(path: Path, samples: list[int], rate: int = RATE) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(rate)
        wf.writeframes(array.array("h", samples).tobytes())


def _tone(seconds: float, rate: int = RATE) -> list[int]:
    return [int(8000 * math.sin(2 * math.pi * 440 * i / rate)) for i in range(int(rate * seconds))]


def test_analyze_skips_extract_and_whisper_when_cached(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    source = tmp_path / "talk.mp4"
    source.write_bytes(b"not-a-real-video")
    analysis = tmp_path / "analysis"
    analysis.mkdir()
    wav = analysis / "source.wav"
    _write_wav(wav, _tone(2.0))
    save_words(
        analysis / "words.json",
        [Word("hello", 0.2, 0.6), Word("there", 0.7, 1.1)],
    )

    def fail_extract(*_args, **_kwargs):
        raise AssertionError("extract should be skipped")

    def fail_transcribe(*_args, **_kwargs):
        raise AssertionError("whisper should be skipped")

    monkeypatch.setattr("app.services.studio.analyze.ensure_wav", lambda *a, **k: False)
    monkeypatch.setattr("app.services.studio.transcribe_resume.extract_audio", fail_extract)
    monkeypatch.setattr("app.services.studio.transcribe_resume.transcribe_wav", fail_transcribe)
    monkeypatch.setattr(
        "app.services.studio.analyze.probe_media",
        lambda _path: type("P", (), {"duration": 2.0, "fps": 30.0, "width": 10, "height": 10, "size": 1})(),
    )

    result = analyze_project(
        source,
        analysis,
        silence_threshold=0.4,
        pad=0.05,
        similarity_threshold=0.7,
    )
    assert result.words[0].text == "hello"
    assert result.clips
    assert (analysis / "words.json").is_file()


def test_ensure_wav_skips_existing_file(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    from app.services.studio.transcribe_resume import ensure_wav

    source = tmp_path / "in.mp4"
    source.write_bytes(b"x")
    wav = tmp_path / "source.wav"
    _write_wav(wav, _tone(0.2))
    monkeypatch.setattr(
        "app.services.studio.transcribe_resume.extract_audio",
        lambda *_a, **_k: (_ for _ in ()).throw(AssertionError("extracted")),
    )
    assert ensure_wav(source, wav) is False


def test_clip_audio_pad_extends_sample_count(tmp_path: Path) -> None:
    wav = tmp_path / "source.wav"
    _write_wav(wav, _tone(2.0))
    out = tmp_path / "clip.wav"
    slice_clip_audio(wav, out, [(0.5, 1.0)], pad=0.25)
    with wave.open(str(out), "rb") as handle:
        frames = handle.getnframes()
        rate = handle.getframerate()
    assert frames == int(round(1.0 * rate))


def test_splice_words_replaces_overlap() -> None:
    words = [Word("a", 0.0, 0.4), Word("b", 0.5, 0.9), Word("c", 1.2, 1.5)]
    merged = splice_words(words, 0.4, 1.0, [Word("bee", 0.5, 0.8)])
    assert [word.text for word in merged] == ["a", "bee", "c"]


def test_render_command_reencodes_video(tmp_path: Path) -> None:
    output = tmp_path / "out.mp4"
    command = render_command(
        tmp_path / "in.mp4",
        output,
        [RenderClipIn("c-0001", [(0.2, 0.7), (1.1, 1.6)])],
        quality="final",
    )
    codec = command[command.index("-c:v") + 1]
    assert codec in {"libx264", "h264_videotoolbox"}
    assert "copy" not in command
    from app.services.studio.render import build_filter

    preview_script, _, _ = build_filter([(0.2, 1.2)], preview=True)
    assert "min(iw,640)" in preview_script
    assert "scale=640" not in preview_script
    entries = manifest_for([RenderClipIn("c-0001", [(0.2, 0.7), (1.1, 1.6)])])
    assert entries[0].out_end == pytest.approx(1.0)
    output.with_suffix(".mp4.filter").unlink(missing_ok=True)


@pytest.mark.skipif(not ffmpeg_available(), reason="ffmpeg is not installed")
def test_final_render_duration_and_sync(tmp_path: Path) -> None:
    source = tmp_path / "src.mp4"
    built = shutil.which("ffmpeg")
    assert built
    import subprocess

    subprocess.run(
        [
            built,
            "-y",
            "-f",
            "lavfi",
            "-i",
            "testsrc=size=320x180:rate=30:duration=4",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:sample_rate=48000:duration=4",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            "-shortest",
            str(source),
        ],
        check=True,
        capture_output=True,
    )
    output = tmp_path / "out" / "final.mp4"
    clips = [
        RenderClipIn("c-0001", [(0.40, 1.15)]),
        RenderClipIn("c-0002", [(2.10, 3.05)]),
    ]
    payload = render_video(source, output, clips, quality="final")
    assert output.is_file()
    probe = probe_media(output)
    expected = (1.15 - 0.40) + (3.05 - 2.10)
    assert probe.duration == pytest.approx(expected, abs=0.05)
    assert payload["duration"] == pytest.approx(expected, abs=0.05)
    streams = subprocess.run(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "stream=codec_type,duration",
            "-of",
            "json",
            str(output),
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    decoded = json.loads(streams.stdout)
    durations = {item["codec_type"]: float(item["duration"]) for item in decoded["streams"]}
    assert abs(durations["video"] - durations["audio"]) < 0.05
    manifest = json.loads(output.with_suffix(".json").read_text())
    assert [item["clipId"] for item in manifest["clips"]] == ["c-0001", "c-0002"]


def _lavfi(path: Path, duration: str = "3", size: str = "320x180") -> None:
    built = shutil.which("ffmpeg")
    assert built
    import subprocess

    subprocess.run(
        [
            built,
            "-y",
            "-f",
            "lavfi",
            "-i",
            f"testsrc=size={size}:rate=30:duration={duration}",
            "-f",
            "lavfi",
            "-i",
            f"sine=frequency=440:sample_rate=48000:duration={duration}",
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


@pytest.mark.skipif(not ffmpeg_available(), reason="ffmpeg is not installed")
def test_render_job_reaches_complete_and_writes_manifest(tmp_path: Path, client) -> None:
    source = tmp_path / "src.mp4"
    _lavfi(source, "3")
    output = tmp_path / "out" / "final.mp4"
    started = client.post(
        "/api/audio-studio/render/async",
        json={
            "sourcePath": str(source),
            "outputPath": str(output),
            "quality": "preview",
            "clips": [{"id": "c-0001", "ranges": [{"sourceStart": 0.4, "sourceEnd": 1.6}]}],
        },
    )
    assert started.status_code == 200
    job_id = started.json()["jobId"]
    phases: list[dict] = []
    with client.stream("GET", f"/api/audio-studio/progress/{job_id}") as response:
        for line in response.iter_lines():
            if not line.startswith("data:"):
                continue
            payload = json.loads(line[5:])
            if payload.get("phase"):
                phases.append(payload)
            if payload.get("done"):
                break
    complete = next(item for item in phases if item.get("phase") == "complete")
    body = json.loads(complete["message"])
    assert body["clips"][0]["clipId"] == "c-0001"
    assert "outStart" in body["clips"][0]
    assert "outEnd" in body["clips"][0]
    assert body["duration"] > 0
    manifest = json.loads(output.with_suffix(".json").read_text())
    assert manifest["clips"][0]["clipId"] == "c-0001"
    assert manifest["duration"] == body["duration"]


def test_audio_stats_edges_and_internal_silence(tmp_path: Path) -> None:
    from app.services.studio.audio_stats import clip_audio_stats

    rate = 16000
    silence = [0] * int(rate * 0.5)
    tone = [8000] * int(rate * 0.4)
    samples = silence + tone + silence + tone
    wav = tmp_path / "source.wav"
    _write_wav(wav, samples, rate)
    stats = clip_audio_stats(wav, [(0.5, 1.4)], cache_dir=tmp_path / "audio-stats")
    assert stats["start"]["rmsDbfs"] > -35
    assert stats["end"]["rmsDbfs"] < -35
    assert stats["before"]["rmsDbfs"] < -35
    assert stats["longestSilenceSeconds"] >= 0.4
    cached = clip_audio_stats(wav, [(0.5, 1.4)], cache_dir=tmp_path / "audio-stats")
    assert cached == stats
    assert list((tmp_path / "audio-stats").glob("*.json"))
    assert "startEdge" in stats
    assert "endEdge" in stats
    try:
        clip_audio_stats(wav, [])
        raise AssertionError("empty ranges should fail")
    except ValueError:
        pass
    mid = clip_audio_stats(wav, [(0.6, 0.8)])
    assert mid["before"]["rmsDbfs"] > -35
    assert mid["startEdge"]["rmsDbfs"] > -30
    quiet = clip_audio_stats(wav, [(0.05, 0.2)])
    assert quiet["before"]["rmsDbfs"] < -40
    assert quiet["after"]["rmsDbfs"] < -40
