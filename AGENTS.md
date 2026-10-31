# Krayon

Local talking-head editor: Whisper transcription, silence cuts, retake grouping, and a 9:16 teaching canvas (boxes, numbers, arrows timed to narration). React + Vite frontend, Python FastAPI backend. Nothing is uploaded.

## Run

```bash
pnpm install
pnpm dev            # frontend + Python audio + reel Fastify + studio Fastify
pnpm dev:all        # same as pnpm dev
pnpm frontend       # Vite only, http://localhost:5173
pnpm backend        # FastAPI audio only
pnpm reel-backend   # Fastify reel pipeline, 127.0.0.1:8788
pnpm studio-backend # Fastify studio API, 127.0.0.1:8789
pnpm krayon         # studio CLI (status, clips, op, render, …)
```

Audio logs: `src/backend/logs/` (gitignored). Audio config: `src/backend/krayon.toml`.
Reel logs: `src/reel-backend/logs/` (gitignored). Reel config: `src/reel-backend/krayon-reel.toml`.
Studio projects: `./studio/<slug>/` (gitignored). Studio config: `src/studio-backend/krayon-studio.toml`.
Vite proxies `/api/reel` → `:8788`, `/api/studio` → `:8789`, and `/api` → `:8000`. Python studio audio is `/api/audio-studio` on `:8000` (not proxied as `/api/studio`).

## Layout

- `src/frontend/` — UI. Reel workspace chrome: top bar, far-left 9:16 canvas (explicit pixel fit, always 9:16), Timeline | Chat right pane, `components/canvas/Canvas.tsx` (9:16 frame only). Double-click a timeline block to edit. Chat talks to `/api/reel` through the Vite proxy. The Gemini key is a first-party cookie (`krayon_gemini_api_key`), never localStorage.
- `src/frontend/components/canvas/designs/` — five canvas skins. Each folder owns paint for that skin (box, number, arrow, markers, background, palette, fonts). Duplicate files across folders on purpose; do not share paint code between skins.
  - `bright/`, `dark/`, `calidraw-light/`, `calidraw-dark/`, `canary/`
  - Switch via `getCanvasDesign(renderTheme)` in `designs/index.ts`.
- `src/backend/` — FastAPI + ffmpeg/Whisper pipeline. Studio heavy audio lives under `/api/audio-studio` and reuses this pipeline.
- `src/reel-backend/` — Fastify generate → render keyframes → Gemini review → fix. Key via `X-Gemini-Api-Key` (never persisted). See `docs/reel-pipeline.md`.
- `src/studio-backend/` — Fastify project store, clip IDs, history, and the `krayon` CLI. UI route `/studio`. See `docs/studio.md` and `docs/studio-cli.md`.

## Studio

A project is `studio/<slug>/`: `meta.json`, `cuts.json`, `analysis/` (WAV + `words.json`), `history/`, `output/`. The source file is referenced, never modified.

Clip ids look like `c-0007` and group ids like `g-0001`. They are never reused in that project. Split and merge mint new ids and set `parentIds`. Re-analysis keeps an id when the new span overlaps the old one with IoU ≥ 0.7.

Grok loop, all local: `krayon status` → `krayon lint` → `krayon clip <id>` and `play-info` (audio with padding) → `reanalyze` / `split` / `merge` / `trim` → `select` → `render --preview` → check → `render --final`. Send `X-Krayon-Actor: grok` (the CLI does this by default). Ops need `baseRevision` from status.

`canvasDraft` on `cuts.json` is reserved and unused. Do not edit the Gemini reel pipeline or the existing audio editor as part of Studio work.

App chrome theme (`lib/theme.ts`, light/dark OS UI) is separate from canvas `RenderTheme`.

Each skin folder has a `SKILL.md` (look, font, background, composition). A change to a skin’s paint, palette, frame, or layout guidance must update that folder’s `SKILL.md` in the same change. Canary’s skill includes a **soft** reel-preview keep-out (guidance for generated JSON; the editor still allows placing elements anywhere).

## Docs

`README.md`, `install.md`, `docs/` (UI, ffmpeg, silence removal, reel JSON, reel pipeline, studio, studio CLI).
