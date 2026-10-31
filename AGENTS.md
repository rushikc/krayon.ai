# Krayon

Local talking-head editor: Whisper transcription, silence cuts, retake grouping, and a 9:16 teaching canvas (boxes, numbers, arrows timed to narration). React + Vite frontend, Python FastAPI backend. Nothing is uploaded.

## Run

```bash
pnpm install
pnpm dev            # frontend + Python audio + reel Fastify
pnpm dev:all        # same as pnpm dev
pnpm frontend       # Vite only, http://localhost:5173
pnpm backend        # FastAPI audio only
pnpm reel-backend   # Fastify reel pipeline, 127.0.0.1:8788
```

Audio logs: `src/backend/logs/` (gitignored). Audio config: `src/backend/krayon.toml`.
Reel logs: `src/reel-backend/logs/` (gitignored). Reel config: `src/reel-backend/krayon-reel.toml`.
Vite proxies `/api/reel` → `:8788` and `/api` → `:8000`.

## Layout

- `src/frontend/` — UI. Reel workspace chrome: top bar, far-left 9:16 canvas (explicit pixel fit, always 9:16), Timeline | Chat right pane, `components/canvas/Canvas.tsx` (9:16 frame only). Double-click a timeline block to edit. Chat talks to `/api/reel` through the Vite proxy. The Gemini key is a first-party cookie (`krayon_gemini_api_key`), never localStorage.
- `src/frontend/components/canvas/designs/` — five canvas skins. Each folder owns paint for that skin (box, number, arrow, markers, background, palette, fonts). Duplicate files across folders on purpose; do not share paint code between skins.
  - `bright/`, `dark/`, `calidraw-light/`, `calidraw-dark/`, `canary/`
  - Switch via `getCanvasDesign(renderTheme)` in `designs/index.ts`.
- `src/backend/` — FastAPI + ffmpeg/Whisper pipeline.
- `src/reel-backend/` — Fastify generate → render keyframes → Gemini review → fix. Key via `X-Gemini-Api-Key` (never persisted). See `docs/reel-pipeline.md`.

App chrome theme (`lib/theme.ts`, light/dark OS UI) is separate from canvas `RenderTheme`.

Each skin folder has a `SKILL.md` (look, font, background, composition). A change to a skin’s paint, palette, frame, or layout guidance must update that folder’s `SKILL.md` in the same change. Canary’s skill includes a **soft** reel-preview keep-out (guidance for generated JSON; the editor still allows placing elements anywhere).

## Docs

`README.md`, `install.md`, `docs/` (UI, ffmpeg, silence removal, reel JSON, reel pipeline).
