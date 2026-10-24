# Krayon

Krayon is a local video editor that turns long talking-head recordings into short, teachable reels. It transcribes speech, removes silence, groups similar retakes, and flags false starts so you pick the best delivery. A portrait 9:16 canvas then turns spoken concepts into boxes, numbers, and arrows timed to the narration—animated moving explainers built for visual learning, running entirely on your machine with no uploads to any remote cloud service.

**Canvas / visual learning.** On the reel canvas, the same explanation becomes a 9:16 scene: boxes for ideas, number badges for steps, arrows for flow. Elements are timed to the narration so they appear when you say them and stay while they still matter. You paste JSON (or edit the inspector), play it back as moving diagrams, and export a visual explainer that sits next to the audio—not a multi-track NLE, a teaching overlay.
Local stack: React + Vite frontend, a Python FastAPI audio backend, and a TypeScript Fastify reel pipeline. Recordings stay on your machine. Reel **generate → review → fix** calls Gemini only when you pass a Google AI Studio key from the UI.

**Audio.** Krayon takes a long talking-head video, transcribes it locally with Whisper, then cuts on silence so you get speech clips instead of a raw timeline. Similar takes of the same line are grouped so you can compare deliveries; mid-sentence restarts are split and marked as false starts. You preview clip audio, keep transcript and runs on disk, and rebuild grouping without re-transcribing.


## Quick start

```bash
pnpm install
pnpm dev
```

`pnpm dev` (and `pnpm dev:all`) starts the frontend, the Python audio backend, and the reel Fastify backend together. To run one of them alone:

```bash
pnpm frontend       # http://localhost:5173
pnpm backend        # FastAPI audio, :8000
pnpm reel-backend   # Fastify reel pipeline, 127.0.0.1:8788
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
├── frontend/       # React + Vite UI
├── backend/        # Python FastAPI + ffmpeg/Whisper
└── reel-backend/   # Fastify generate → review → fix (Gemini Developer API)
```

### Layout

**Home (`/`)** — two tiles: Audio analysis, Reel animations

**Audio library (`/audio`)** — video library + preview + metadata panel

**Editor (`/editor/:mediaId`)** — single-video workspace with processing controls; clips sidebar appears after generation

**Reel animations (`/reel-animations`)** — 9:16 teaching canvas. Scene JSON can be pasted in the inspector, or produced by the local reel pipeline (see [docs/reel-pipeline.md](docs/reel-pipeline.md)).

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
- [What is Krayon?](docs/what-is-kyaon.md)
- [Reel generate/review pipeline](docs/reel-pipeline.md)
- [Reel animation JSON](docs/reel-animation-json.md)

## Configuration

Edit [`src/backend/krayon.toml`](src/backend/krayon.toml) for Whisper model, device, and silence defaults. Optional `KRAYON_*` env vars override individual settings.

| Setting (krayon.toml) | Default | Description |
|-----------------------|---------|-------------|
| `whisper.model` | `base` | faster-whisper model size |
| `whisper.device` | `cpu` | Inference device |
| `whisper.compute_type` | `int8` | Quantization |
| `paths.ffmpeg` | `ffmpeg` | Path to ffmpeg binary |
