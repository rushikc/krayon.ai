# Krayon

Local talking-head editor and 9:16 teaching canvas. Recordings stay on the machine. React + Vite in the browser, Python FastAPI beside it, ffmpeg and faster-whisper on the same computer.

Share this with the team as the map of what the code already does, and as a list of techniques worth researching if you want to build something adjacent.

## What it does

Krayon has two workspaces.

**Audio analysis** (`/audio`, then `/editor/:mediaId`) takes a long talking-head recording and turns it into speech clips you can compare.

1. You open a folder. The library lists local video files and can preview the first 20 seconds.
2. **Analyze silence** transcribes the whole file with word timestamps, drops dead air, and keeps the speech as time ranges on the original file.
3. Similar lines are grouped as retakes. A restart in the middle of a sentence is split off and marked as a false start. Other takes in the same group can be flagged when the wording is incomplete or wrong.
4. Each speech clip gets its own audio preview. Every run is saved next to the video, so you can switch runs or rebuild the grouping from the transcript you already have.

**Reel animations** (`/reel-animations`) is the teaching canvas. Spoken ideas become boxes, numbered step badges, and arrows on a portrait 9:16 frame. Each shape has a start and end on a timeline, so it appears when the line is said and leaves when it no longer matters. You paste a JSON array, edit it in the inspector, play it with optional narration audio, and export an MP4 of the canvas.

The two workspaces are separate today. Audio analysis does not draw the canvas, and the canvas export does not cut the talking-head video. They share the same app and the same idea: a long explanation becomes a short, timed visual.

## Text tags

The canvas scene is a flat JSON array. Each object is one shape. The `type` string is the tag the parser accepts. Anything else is rejected.

### `box`

A labeled rectangle. This is the only shape that holds free text.

| Field | Role |
| --- | --- |
| `id` | Stable name. Arrows point at this. |
| `type` | `"box"` |
| `matrix` | `[X1, Y1, X2, Y2]` on an 18×32 grid. Inclusive cells, integers only. Columns 0–17, rows 0–31. |
| `label` | Primary text inside the box. |
| `sublabel` | Optional second line. Drawn smaller than the label. |
| `fontSize` | Label size in CSS pixels. Default 14. The inspector clamps 10–48. |
| `colorTheme` | Fill token. Listed below. |
| `time` | `{ start, end, track }` in seconds. `track` 0 is in front. |

### `number`

A circular step badge. The visible text is the number in `value`, not a label.

| Field | Role |
| --- | --- |
| `id` | Stable name. |
| `type` | `"number"` |
| `matrix` | `[X, Y]` for one cell, or `[X1, Y1, X2, Y2]` for a span. |
| `size` | Optional diameter as a percent of canvas width (4–40). Overrides the matrix width. |
| `value` | The digit drawn in the center. |
| `colorTheme` | Fill token. |
| `time` | Same `{ start, end, track }` object. |

A number cannot be an arrow endpoint.

### `arrow`

A connector between two boxes. It has no grid `matrix` and no text. The line is computed from the two boxes’ edges.

| Field | Role |
| --- | --- |
| `id` | Stable name. |
| `type` | `"arrow"` |
| `sourceId` | `id` of the box the line starts from. |
| `targetId` | `id` of the box the arrowhead points to. |
| `variant` | `"solid"` or `"dashed"`. |
| `time` | Same `{ start, end, track }` object. |

### `colorTheme` tokens

Used by `box` and `number` only. Arrows use the canvas ink color.

`ink` · `violet` · `green` · `blue` · `sky` · `lavender` · `mint` · `tan` · `yellow` · `orange` · `pink` · `salmon`

`ink` inverts the text (light type on a dark fill). These tokens are the element palette. They are separate from the five canvas skins: Bright, Dark, Calidraw light, Calidraw dark, and Canary.

### Clip labels in the audio editor

After analysis, each speech clip can carry one of these labels in the sidebar:

| Tag | Meaning |
| --- | --- |
| `falseStart` | The speaker restarted the line. The abandoned opening is its own clip. |
| `cut_off` | The take matches the reference, then stops early. |
| `starts_late` | The take is missing the opening of the reference line. |
| `missing_words` | Words are missing from the middle, or from both ends. |
| `misstatement` | A stretch of the line was replaced with different words. |

The sidebar shows those as **False start**, **Cut off**, **Starts late**, **Missing words**, and **Misstatement**.

## How video and audio are handled

The source file is never cut into smaller videos. Speech is a list of time ranges. Playback, transcription, and export each use a different path.

### 1. Stream the original file

The library player asks the API for the file with HTTP Range requests (`GET /api/media/stream/{id}`). The browser `<video>` element seeks inside the original `.mp4`, `.mov`, `.m4v`, `.webm`, `.mkv`, or `.avi`. The UI stops the library preview at 20 seconds so a long recording does not play through. The file on disk is unchanged.

### 2. Extract audio once for transcription

ffmpeg reads the video and writes a 16 kHz mono PCM WAV next to it, under `.krayon/{filename}.wav`. faster-whisper transcribes that WAV with word timestamps and a voice-activity filter, so non-speech regions are skipped. A later analysis reuses the WAV if it is still there.

Silence is not an ffmpeg silence detector. The word list is padded (default 0.05s), then words are merged when the gap is at most the silence threshold (default 0.4s). Gaps larger than that become the removed dead air. Spans shorter than 0.05s are dropped.

### 3. Keep clips as timestamps, then make preview WAVs

Each clip stores `sourceStart`, `sourceEnd`, and sometimes several `ranges` when a take was stitched from more than one span. Duration is the sum of those ranges. No per-clip MP4 is written.

Preview audio is a WAV per clip, served from `GET /api/media/clip/{mediaId}/{clipId}`:

- If the cached 16 kHz WAV exists, Python slices it by sample index and concatenates the ranges. This is the usual path.
- If that cache is missing, ffmpeg seeks each range (`-ss` / `-to`, audio only) and the slices are joined into one WAV.

### 4. Rebuild from the transcript you already have

Changing the silence threshold or the similarity threshold does not need another Whisper pass. **Rebuild** reads the word timings stored in that run’s manifest, rebuilds segments and groups, and extracts clip audio again. The new result is a new version folder. Older runs stay on disk.

### 5. Export the teaching canvas in the browser

Reel export does not use ffmpeg and does not include the talking-head picture. The page steps the canvas clock at 30 fps, snapshots the 9:16 frame with `html-to-image`, encodes H.264 with the WebCodecs `VideoEncoder`, and muxes an MP4 with `mp4-muxer`. Output size is 1080×1920, padded up to a 16-pixel multiple when the encoder needs it, at about 8 Mbps. The file downloads in the browser. Narration you attach for preview plays in sync during editing; that audio is not muxed into the exported MP4.

### Where the files land

```
your-folder/
├── recording.mov
└── .krayon/
    ├── recording.wav                         # audio extracted for Whisper
    └── state/{mediaId}/
        ├── index.json                        # run list + which run is active
        └── versions/{versionId}/
            ├── manifest.json                 # words, clips, groups, options
            ├── transcript.txt
            └── audio/{clipId}.wav            # preview audio for each clip
```

`mediaId` is the first 16 hex characters of the SHA-256 of the resolved file path.

## What we implemented

This is the product surface in the repo. Sample scripts in `docs/` that talk through cloud services are narration practice, not part of the app.

### Audio workspace

- Home tile **Audio analysis**, then a folder library with a native macOS folder picker.
- Video list, 20-second preview, and a details panel that opens the editor.
- Async **Analyze silence** job with live progress over server-sent events: transcribe, build speech segments, group takes, extract clip audio.
- Word-level transcript kept on the run, plus a plain `transcript.txt` for diffing runs.
- Fuzzy grouping of repeated lines: shared opening, shared ending, one line contained in another, and `difflib` similarity. Short filler words (`um`, `uh`, `you know`, and a few leading words like `so` and `well`) are stripped before the comparison.
- False-start splits when the same opening is said again inside one clip.
- Delivery flags against the best complete take in the group.
- Speech-clips list and an all-segments list that also shows the silent gaps.
- Per-clip audio player.
- Append-only run history. Reopening the editor restores the active run. You can switch runs or rebuild grouping without re-transcribing.

### Reel workspace

- 9:16 frame. Boxes and badges are HTML. Arrows are SVG on a 0–100 view box. The 18×32 grid is what you author; the app converts cells to percents.
- Inspector for the live JSON array, plus a config form for the selected shape.
- Timeline with tracks, drag, resize, and cut. Playback clock drives which shapes are visible (`start` inclusive, `end` exclusive).
- Five skins, each with its own paint code: Bright, Dark, Calidraw light, Calidraw dark, Canary. The app light/dark chrome is a separate setting from the canvas skin.
- Optional reel-preview frame (the keep-out used by short-form players). Canary treats that keep-out as guidance for generated JSON. The editor still lets you place a shape anywhere.
- Drop in a local audio file to hear narration while the canvas plays.
- Export the canvas to an H.264 MP4 in the browser, with a progress dialog and cancel.

### Stack, if you want to research outward

| Piece | Used for |
| --- | --- |
| React 19, Vite, Tailwind v4, Zustand, React Router | UI, editor state, routes |
| FastAPI, uvicorn, Pydantic | Local API |
| faster-whisper | Local speech-to-text with word times and VAD |
| ffmpeg / ffprobe | Probe, audio extract, range slice fallback |
| Python `wave` | Slice the cached WAV into clip previews |
| `difflib.SequenceMatcher` | Retake grouping and delivery flags |
| HTTP Range + `<video>` | Library playback of the original file |
| WebCodecs, `mp4-muxer`, `html-to-image` | Canvas-to-MP4 export |

Nearby projects this code can support: a retake picker for lecture recordings, a silence-cut preprocessor before any editor, a transcript-timed diagram tool, or a browser-only explainer exporter that never sends the picture off the machine. The audio pipeline and the canvas pipeline are independent, so either one can be lifted on its own.
