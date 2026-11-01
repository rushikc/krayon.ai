from __future__ import annotations

import json
from pathlib import Path

import pytest

from app.services.segments import Word
from app.services.studio.transcribe_resume import ensure_wav, ensure_words, load_words, save_words, words_are_cached


def test_cached_words_skip_whisper(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    wav = tmp_path / "source.wav"
    wav.write_bytes(b"RIFF" + b"\0" * 80)
    words = tmp_path / "words.json"
    save_words(words, [Word("alpha", 0.1, 0.4), Word("beta", 0.5, 0.8)])

    def boom(*_args, **_kwargs):
        raise AssertionError("Whisper ran")

    monkeypatch.setattr("app.services.studio.transcribe_resume.transcribe_wav", boom)
    assert ensure_words(wav, words) is False
    assert [word.text for word in load_words(words)] == ["alpha", "beta"]


def test_corrupt_words_json_is_not_cached(tmp_path: Path) -> None:
    path = tmp_path / "words.json"
    path.write_text("{")
    assert words_are_cached(path, requested_language="en") is False
    with pytest.raises(json.JSONDecodeError):
        load_words(path)


def test_missing_wav_extracts_and_a_missing_source_raises(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    source = tmp_path / "talk.wav"
    source.write_bytes(b"source")
    dest = tmp_path / "analysis" / "source.wav"
    calls: list[Path] = []

    def fake_extract(src: Path, wav_path: Path) -> None:
        calls.append(src)
        wav_path.parent.mkdir(parents=True, exist_ok=True)
        wav_path.write_bytes(b"RIFF" + b"\0" * 80)

    monkeypatch.setattr("app.services.studio.transcribe_resume.extract_audio", fake_extract)
    assert ensure_wav(source, dest) is True
    assert calls == [source]
    assert ensure_wav(source, dest) is False

    missing = tmp_path / "gone.mp4"
    other = tmp_path / "other.wav"

    def missing_extract(src: Path, _wav: Path) -> None:
        raise FileNotFoundError(src)

    monkeypatch.setattr("app.services.studio.transcribe_resume.extract_audio", missing_extract)
    with pytest.raises(FileNotFoundError):
        ensure_wav(missing, other)


class _Token:
    def __init__(self, word: str, start: float, end: float) -> None:
        self.word = word
        self.start = start
        self.end = end


class _Seg:
    def __init__(self, start: float, end: float, text: str, words: list[_Token]) -> None:
        self.start = start
        self.end = end
        self.text = text
        self.words = words


class _Info:
    language = "hi"
    language_probability = 0.97
    duration = 8.0


class _FakeModel:
    def __init__(self) -> None:
        self.calls: list[dict] = []

    def transcribe(self, _path: str, **kwargs):
        self.calls.append(kwargs)
        words = [_Token("namaste", 0.0, 1.2)]
        return [_Seg(0.0, 1.2, "namaste", words)], _Info()


def _patch_model(monkeypatch: pytest.MonkeyPatch, model: _FakeModel) -> None:
    monkeypatch.setattr("app.services.studio.transcribe_resume.get_whisper_model", lambda: model)
    monkeypatch.setattr(
        "app.services.studio.transcribe_resume.probe_media",
        lambda _path: type("P", (), {"duration": 8.0, "fps": 30.0})(),
    )


def test_transcribe_passes_auto_language_and_short_temperatures(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    wav = tmp_path / "source.wav"
    wav.write_bytes(b"RIFF" + b"\0" * 80)
    model = _FakeModel()
    _patch_model(monkeypatch, model)
    events: list[tuple[float, str]] = []
    from app.services.studio.transcribe_resume import STUDIO_TEMPERATURES, transcribe_wav

    words = transcribe_wav(wav, language=None, on_progress=lambda ratio, message: events.append((ratio, message)))
    assert [word.text for word in words] == ["namaste"]
    assert model.calls
    assert model.calls[0]["language"] is None
    assert model.calls[0]["temperature"] == STUDIO_TEMPERATURES
    assert any("Detected language: Hindi" in message for _ratio, message in events)
    assert any("namaste" in message or "Transcribing" in message for _ratio, message in events)
    assert len(events) >= 2


def test_words_cache_keyed_by_language_and_model(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    wav = tmp_path / "source.wav"
    wav.write_bytes(b"RIFF" + b"\0" * 80)
    words_path = tmp_path / "words.json"
    save_words(words_path, [Word("alpha", 0.1, 0.4)], requested_language="auto", detected_language="hi")
    model = _FakeModel()
    _patch_model(monkeypatch, model)
    monkeypatch.setattr(
        "app.services.studio.transcribe_resume.transcribe_wav",
        lambda *_a, **_k: (_ for _ in ()).throw(AssertionError("should reuse cache")),
    )
    assert words_are_cached(words_path, requested_language="auto") is True
    assert ensure_words(wav, words_path, language=None, requested_language="auto") is False

    ran = {"n": 0}

    def fake_transcribe(*_a, **_k):
        ran["n"] += 1
        save_words(words_path, [Word("beta", 0.1, 0.4)], requested_language="en")
        return [Word("beta", 0.1, 0.4)]

    monkeypatch.setattr("app.services.studio.transcribe_resume.transcribe_wav", fake_transcribe)
    assert ensure_words(wav, words_path, language="en", requested_language="en") is True
    assert ran["n"] == 1


def test_window_fallback_uses_second_temperature(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    wav = tmp_path / "source.wav"
    wav.write_bytes(b"RIFF" + b"\0" * 80)
    model = _FakeModel()

    def flaky(_path: str, **kwargs):
        model.calls.append(kwargs)
        if kwargs.get("clip_timestamps"):
            words = [_Token("namaste", 0.0, 1.2)]
            return [_Seg(0.0, 1.2, "namaste", words)], _Info()
        return [], _Info()

    model.transcribe = flaky  # type: ignore[method-assign]
    _patch_model(monkeypatch, model)
    from app.services.studio.transcribe_resume import (
        ACCEPT_COMPRESSION_RATIO_THRESHOLD,
        STUDIO_TEMPERATURES,
        transcribe_wav,
    )

    words = transcribe_wav(wav, language="en")
    assert [word.text for word in words] == ["namaste"]
    assert all(word.confidence == "low" for word in words)
    assert model.calls[0]["temperature"] == STUDIO_TEMPERATURES
    assert any(call.get("compression_ratio_threshold") == ACCEPT_COMPRESSION_RATIO_THRESHOLD for call in model.calls)
