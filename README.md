# Krayon

Krayon is a local video editor that turns long talking-head recordings into short, teachable pieces. It transcribes speech, removes silence, groups similar retakes, and flags false starts so you pick the best delivery. Studio cuts a recording down to the chosen takes. A portrait 9:16 canvas turns spoken concepts into boxes, numbers, and arrows timed to the narration. Recordings stay on your machine.

**Canvas / visual learning.** On the reel canvas, the same explanation becomes a 9:16 scene: boxes for ideas, number badges for steps, arrows for flow. Elements are timed to the narration so they appear when you say them and stay while they still matter. You paste JSON, edit a block from the timeline, play it back, and export a visual explainer. The Gemini key is a first-party cookie and is never stored on disk.

**Audio.** Krayon takes a long talking-head video, transcribes it locally with Whisper, then cuts on silence so you get speech clips instead of a raw timeline. Similar takes of the same line are grouped so you can compare deliveries; mid-sentence restarts are split and marked as false starts. You preview clip audio, keep transcript and runs on disk, and rebuild grouping without re-transcribing.

**Studio.** One project, one source video, an optional script. Pipeline 1 groups retakes from the transcript. Pipeline 2 lines the recording up to the script. You accept takes, then render one video.

Local stack: React + Vite frontend, a Python FastAPI audio backend, a TypeScript Fastify reel pipeline, and a TypeScript Fastify studio API. Reel **generate → review → fix** calls Gemini only when you pass a Google AI Studio key from the UI.

## Quick start

```bash
pnpm install
pnpm dev
```

`pnpm dev` (and `pnpm dev:all`) starts the frontend, the Python audio backend, the reel Fastify backend, and the studio Fastify backend together. To run one of them alone:

```bash
pnpm frontend         # http://localhost:5173
pnpm backend          # FastAPI audio, :8000
pnpm reel-backend     # Fastify reel pipeline, 127.0.0.1:8788
pnpm studio-backend   # Fastify studio API, 127.0.0.1:8789
pnpm krayon           # studio CLI (status, clips, op, render, …)
pnpm studio:doctor    # studio + python + ffmpeg + av + Whisper checks
pnpm test             # unit tests (frontend, reel, studio)
pnpm test:backend     # Python backend tests
pnpm test:e2e         # Playwright; needs pnpm dev already running
```

Open **http://localhost:5173**

## Prerequisites

- **Node.js 20+** and **pnpm**
- **Python 3.12 recommended** (`brew install python@3.12`)
- **ffmpeg** and **ffprobe** on your PATH (`brew install ffmpeg`)

On first silence-removal run, **faster-whisper** downloads its model automatically.

## Architecture

```
src/
├── frontend/        # React + Vite UI
├── backend/         # Python FastAPI + ffmpeg/Whisper
├── reel-backend/    # Fastify generate → review → fix (Gemini Developer API)
└── studio-backend/  # Fastify project store, ops API, krayon CLI
```

Studio heavy audio (transcribe, segment, snap, script align, render) runs on the Python app at `/api/audio-studio`. The studio Fastify process owns `studio/<slug>/` and calls Python. The browser talks to Fastify only.

### Proxies

| Prefix | Target |
|---|---|
| `/api/reel` | `127.0.0.1:8788` |
| `/api/studio` | `127.0.0.1:8789` |
| `/api` | `localhost:8000` |

### Layout

**Home (`/`)** — three tiles: Audio analysis (silence removal and clip grouping), Reel animations (subtitle “Coming soon”), Studio (pick the best takes from a long recording).

**Audio library (`/audio`)** — video library + preview + metadata panel.

**Editor (`/editor/:mediaId`)** — single-video workspace with processing controls; clips sidebar appears after generation.

**Reel animations (`/reel-animations`)** — 9:16 teaching canvas pinned to the left, with Timeline | Chat on the right. Double-click a timeline block to edit it. Chat generates a scene from a script (local reel pipeline; Gemini key is a first-party cookie). See [docs/reel-pipeline.md](docs/reel-pipeline.md) and [docs/ui-design.md](docs/ui-design.md).

**Studio (`/studio`, `/studio/:slug`)** — landing (project name, video path, optional script) and a workspace (clip list, waveform, controls). See [docs/studio.md](docs/studio.md).

## Studio pipelines

Both live under `src/backend/app/services/studio/`. Shared helpers are in `common/`.

- **Pipeline 1, transcript.** No script, or an explicit transcript rebuild. Entry points: `analyze.py` and `reanalyze.py`. Cuts snap to quiet audio when `snapToAudio` is on.
- **Pipeline 2, scripted.** A script is present (one sentence per line) and the run is `auto` or `scripted`. Entry point: `scripted_pipeline.py`.

`auto` picks scripted when the project has script lines, otherwise transcript. A forced scripted run with an empty script falls back to transcript.

## Debugging / logs

Backend session logs are written to [`src/backend/logs/`](src/backend/logs/).

- One log file per **5-minute window** while the server runs (e.g. `krayon_2026-08-23T17-05-00.log`)
- Max **30** log files kept; oldest are auto-deleted
- **Terminal** shows one-liner API calls and errors
- **Log files** contain full detail (tracebacks, debug context) for LLM/Cursor analysis

When debugging backend issues, read the most recent `src/backend/logs/krayon_*.log`.

Log files are gitignored — do not commit them.

## Docs

- [Install guide](install.md)
- [UI design](docs/ui-design.md)
- [FFmpeg & media processing](docs/ffmpeg-backend.md)
- [Silence removal pipeline](docs/silence-removal.md)
- [Analyze silence stages](docs/pipeline-stages.md)
- [What is Krayon?](docs/what-is-krayon.md)
- [Studio](docs/studio.md)
- [Studio CLI](docs/studio-cli.md)
- [Reel generate/review pipeline](docs/reel-pipeline.md)
- [Reel animation JSON](docs/reel-animation-json.md)
- [End-to-end tests](test/README.md)

## Configuration

Edit [`src/backend/krayon.toml`](src/backend/krayon.toml) for Whisper, silence, and clip defaults. Optional `KRAYON_*` env vars override individual settings. Studio listen address and the Python base URL live in [`src/studio-backend/krayon-studio.toml`](src/studio-backend/krayon-studio.toml).

| Setting | Default | Description |
|---|---|---|
| `whisper.model` | `base` | faster-whisper model size |
| `whisper.device` | `cpu` | Inference device |
| `whisper.compute_type` | `int8` | Quantization |
| `whisper.warmup_on_startup` | `true` | Load the model when the backend starts |
| `whisper.beam_size` | `1` | Decode beam size |
| `whisper.condition_on_previous_text` | `false` | Condition each window on prior text |
| `silence.threshold` | `0.4` | Max gap (seconds) still treated as one segment |
| `silence.pad` | `0.05` | Seconds added around each word |
| `silence.min_segment_seconds` | `0.05` | Drop speech spans shorter than this |
| `silence.tail_max_extend_s` | `0.3` | Studio cap on how far a segment tail may extend |
| `clips.similarity_threshold` | `0.7` | Retake grouping similarity |
| `paths.ffmpeg` | `ffmpeg` | Path to ffmpeg |
| `paths.ffprobe` | `ffprobe` | Path to ffprobe |
| `krayon-studio.toml` `host` | `127.0.0.1` | Studio API bind address |
| `krayon-studio.toml` `port` | `8789` | Studio API port |
| `krayon-studio.toml` `python_base` | `http://127.0.0.1:8000` | Python app the studio API calls |
