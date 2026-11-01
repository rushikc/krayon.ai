"""Legacy /api/silence and /api/clips against the fixture.

The golden file stores segments, clip bounds, text, and groups. Absolute paths
and wall-clock fields are left out so the compare stays stable.
"""

from __future__ import annotations

import json
import shutil
from pathlib import Path

from app.services.segments import Word
from tests.fixtures import build_fixture

GOLDEN = Path(__file__).parent / "golden" / "legacy_fixture.json"


def _round(value: float) -> float:
    return round(float(value), 3)


def canonical(silence: dict, clips: dict) -> dict:
    return {
        "segments": [
            {"sourceStart": _round(item["sourceStart"]), "sourceEnd": _round(item["sourceEnd"])}
            for item in silence["segments"]
        ],
        "removedSeconds": _round(silence["removedSeconds"]),
        "clips": [
            {
                "id": item["id"],
                "text": item["text"],
                "sourceStart": _round(item["sourceStart"]),
                "sourceEnd": _round(item["sourceEnd"]),
                "groupId": item["groupId"],
                "falseStart": bool(item.get("falseStart", False)),
            }
            for item in clips["clips"]
        ],
        "groups": [
            {"id": group["id"], "label": group["label"], "clipIds": group["clipIds"]}
            for group in clips["groups"]
        ],
    }


def test_legacy_silence_and_clips_match_golden(tmp_path: Path, client, monkeypatch) -> None:
    fixture = build_fixture(tmp_path)

    def fake_transcribe(_source, wav_path, **_kwargs):
        wav_path.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(fixture.wav, wav_path)
        return [Word(item["text"], item["start"], item["end"]) for item in fixture.words]

    monkeypatch.setattr("app.services.analysis.transcribe_words", fake_transcribe)
    silence = client.post("/api/silence/analyze", json={"path": str(fixture.source)})
    generated = client.post("/api/clips/generate", json={"path": str(fixture.source)})
    assert silence.status_code == 200
    assert generated.status_code == 200
    payload = canonical(silence.json(), generated.json())
    assert "sourcePath" not in json.dumps(payload)
    expected = json.loads(GOLDEN.read_text())
    assert payload == expected
