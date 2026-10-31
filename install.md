# Krayon — Install Guide

Local-only setup for macOS (Apple Silicon or Intel). Linux should work with the same commands.

## Prerequisites

### 1. Xcode Command Line Tools (macOS)

```bash
xcode-select --install
```

### 2. Node.js + pnpm

```bash
node -v   # should be v20+
corepack enable
corepack prepare pnpm@latest --activate
pnpm -v
```

### 3. Python 3.12 (recommended)

```bash
brew install python@3.12
python3.12 --version
```

Krayon’s backend venv prefers `python3.12`, then `python3.11`. After upgrading, delete `src/backend/.krayonenv` and re-run `pnpm backend`.

### 4. FFmpeg

```bash
brew install ffmpeg
ffmpeg -version
ffprobe -version
```

## Clone & install

```bash
git clone <your-repo-url> krayon
cd krayon

# Frontend
pnpm install

# Backend
pnpm backend
```

## Run locally

**Both together**

```bash
pnpm dev
```

**One process at a time**

```bash
pnpm frontend        # Vite, http://localhost:5173
pnpm backend         # FastAPI audio, :8000
pnpm reel-backend    # Fastify reel pipeline, 127.0.0.1:8788
```

`pnpm dev:all` is the same as `pnpm dev`. Open **http://localhost:5173**. Vite proxies `/api/reel` to the reel backend on port 8788 and `/api` to the FastAPI server on port 8000.

## First use

1. Click **Open** in the left sidebar — the native macOS folder picker appears.
2. Select a folder with `.mov` or `.mp4` files.
3. Pick a video from the list — it plays in the center player.
4. Use **Analyze silence** on the right panel.

The last selected folder is saved in browser `localStorage`.

## Large files

The **dashboard** streams the original file with playback capped at 20 seconds in the UI. The **editor** does not preview full video — after **Analyze silence**, each speech clip gets an extracted WAV under:

```
<your-folder>/.krayon/state/{mediaId}/versions/{versionId}/audio/{clipId}.wav
```

Transcripts are cached under:

```
<your-folder>/.krayon/<stem>.wav
```

Analysis state (segment timestamps, groups) is saved under `<your-folder>/.krayon/state/{mediaId}/`.

## Configuration

Edit [`src/backend/krayon.toml`](src/backend/krayon.toml):

```toml
[whisper]
model = "base"    # or small, medium, large-v3
device = "cpu"
compute_type = "int8"
```

Whisper model sizes: `tiny`, `base`, `small`, `medium`, `large-v3`. Larger = more accurate but slower.

On first backend start, the Whisper model is downloaded once (~150 MB for `base`). Set `warmup_on_startup = false` in krayon.toml to skip startup loading.

Optional env overrides: `KRAYON_FFMPEG`, `KRAYON_WHISPER_MODEL`, etc.

## Build for production

```bash
pnpm build
# Frontend output: dist/

# Backend runs as-is:
pnpm backend
```

Serve `dist/` with any static file server, keeping the API proxy pointed at localhost:8000.

## Troubleshooting

| Issue | Fix |
|-------|-----|
| `ffmpeg not found` | Install ffmpeg and ensure it is on PATH |
| Backend connection refused | Start uvicorn on port 8000 |
| Whisper slow | Delete `.krayonenv`, recreate with Python 3.12; check `krayon.pipeline` logs for `realtime_factor` |
| Video won't seek | Ensure ffprobe works and the file is readable |
