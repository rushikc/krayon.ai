# Testing and local run

Operator runbook for starting, testing, and locally compiling Krayon. Nothing is uploaded. There is no cloud deploy, Docker production stack, or hosting pipeline.

Playwright details stay in [`test/README.md`](../test/README.md). This page is the hub.

## 1. The four local processes

They are separate. The browser should talk to Vite, not to the backends directly.

| Process | How to start | Port | Health | Role |
| --- | --- | --- | --- | --- |
| Vite frontend | `pnpm frontend` | 5174 (`pnpm fixed` → 5175) | open the URL | UI |
| Python audio | `pnpm backend` | 8000 | `GET /api/health` | Whisper, silence, Studio heavy audio at `/api/audio-studio`, legacy `/api/silence` |
| Reel Fastify | `pnpm reel-backend` | 127.0.0.1:8788 | `GET /api/reel/health` | Gemini generate/review/fix, and the Excalidraw diagram CLI package |
| Studio Fastify | `pnpm studio-backend` | 127.0.0.1:8789 | `GET /api/studio/health` | project store, ops, `pnpm krayon` CLI |

Vite proxies ([`vite.config.ts`](../vite.config.ts) `server.proxy`): `/api/reel` → 8788, `/api/studio` → 8789, other `/api` → 8000. This Vite version also applies that proxy to `pnpm preview`.

All four: `pnpm dev` (same as `pnpm dev:all`). Stable no-reload stack: `pnpm fixed` (UI at http://localhost:5175, `KRAYON_FIXED=1`, no HMR).

Prerequisites: Node 20+, pnpm, Python 3.12 preferred (venv at `src/backend/.krayonenv`), ffmpeg and ffprobe on PATH, Google Chrome at `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome` for diagram PNG render (override `KRAYON_CHROME_PATH` or `[diagram].chrome_path` in `src/reel-backend/krayon-reel.toml`). First backend start may download a Whisper model (~150 MB for `base`).

Doctor: `pnpm studio:doctor` (studio + python + ffmpeg + av + Whisper).

Logs: `src/backend/logs/` and `src/reel-backend/logs/` (gitignored). Studio projects: `studio/<slug>/` (gitignored). Diagrams: `diagrams/<reel-id>/`. Generated diagram `states/`, `review/`, and `status.json` are gitignored.

## 2. Start and know it is up

```bash
pnpm install
pnpm studio:doctor
pnpm dev
```

Reuse an already-running `pnpm dev`. Do not start a second stack on the same ports. If something is already bound, curl the health URLs and continue.

Health checks (use 5175 if you started `pnpm fixed`):

```bash
curl -sf http://localhost:5174 >/dev/null && echo frontend_ok
curl -sf http://127.0.0.1:8000/api/health
curl -sf http://127.0.0.1:8788/api/reel/health
curl -sf http://127.0.0.1:8789/api/studio/health
```

Frontend: http://localhost:5174. Home tiles: Audio analysis (`/audio`), Reel animations (`/reel-animations`, subtitle “9:16 diagram reels”), Studio (`/studio`).

## 3. Test each pipeline separately

These suites are independent. They do not all need the full stack.

### A. Frontend unit / component (no servers)

```bash
pnpm exec vitest run
```

That is the frontend half of `pnpm test`. Key files: `src/frontend/pages/reel-layout.test.tsx`, `home-shell.test.tsx`, `src/frontend/pages/studio/*.test.tsx`, `src/frontend/components/reel/ReelWorkspace.test.tsx`. Covers 9:16 layout, Timeline | Chat, Studio step chrome, and the rushk diagram loader.

### B. Studio Fastify unit (Python not required for most)

```bash
pnpm --filter @krayon/studio-backend test
```

Files under `src/studio-backend/test/` (routes, CLI, domain, confirmations, lint). Includes cut-audio and `canvasDraft`.

### C. Python audio + Studio heavy audio (no UI)

```bash
pnpm test:backend
```

That runs `src/backend/test.sh` → `pytest tests -q` inside `.krayonenv`. Files under `src/backend/tests/`: API, clips, ffmpeg, jobs, segments, studio audio / HTTP, scripted alignment and pipeline, boundary snap, cut quality, rebuild audio, transcribe resume, analysis timings, legacy golden, pipeline dispatch.

Two Studio analyze modes live here: transcript (`analyze.py` / `reanalyze.py`) and scripted (`scripted_pipeline.py`). `auto` picks scripted when `script.txt` has lines. This is not the Excalidraw pipeline.

### D. Gemini reel pipeline unit (no Chrome, no API key)

```bash
pnpm --filter @krayon/reel-backend test
```

Covers `src/reel-backend/test/http.test.ts`, `pipeline.test.ts`, `gemini.test.ts`, `schema.test.ts`, `render.test.ts` (the Gemini keyframe renderer, not the diagram CLI), plus `test/diagram/`. `src/reel-backend/test/live.test.ts` is opt-in and skipped unless `KRAYON_GEMINI_API_KEY` is already set:

```bash
pnpm --filter @krayon/reel-backend test:live
```

Do not set a key just to run it. The `/api/reel/jobs` generate → review → fix flow is separate from diagrams. UI e2e `test/e2e/reel.spec.ts` mocks `/api/reel` and must not hit Gemini.

### E. Excalidraw / rushk diagram pipeline (no Gemini, no Studio, no Vite)

Code: `src/reel-backend/src/diagram/`. The CLI builds. Read-only HTTP (`GET /api/reel/diagrams`, `/diagrams/meta`, `/diagrams/png`) only serves files the CLI already wrote. The UI does not spawn a build.

From `src/reel-backend`:

```bash
npm run diagram -- list
npm run diagram -- validate _examples/uber-ttl
npm run diagram -- validate _examples/airbnb-flow
npm run diagram -- build _examples/uber-ttl
npm run diagram -- build _examples/airbnb-flow
```

Human logs on stderr. One JSON line on stdout: `{ ok, reelId, issues, statusPath }`. Exit 0 ok, 2 validation/layout, 3 `CHROME_NOT_FOUND`.

Unit and Chrome render tests are in `src/reel-backend/test/diagram/` and run with the reel-backend test command above. The Chrome test skips only if Chrome is missing.

After build, inspect:

- `diagrams/_examples/uber-ttl/review/redis-dynamo/step-01.png` through `step-05.png`
- `diagrams/_examples/airbnb-flow/review/client-auth-ui/step-01.png` through `step-04.png`

A file preview can look cropped even when the PNG is complete. Check pixel size first. Uber step-01 should be about 1270×1308 and show full “Redis” and “DynamoDB” labels on a white card. Airbnb step-04 should be about 1830×1558 and show Client → Auth Backend → UI Screen plus the red “Policy Engine” box. Corners white; ink must not touch the right or bottom edge. Title and caption are HTML in the rushk stage, not painted into the PNG.

Loaded in the app at `/reel-animations/_examples/uber-ttl` (and the same workspace from Studio video).

### F. Combined JS/TS unit (no e2e, no Python)

```bash
pnpm test
pnpm typecheck
pnpm lint
```

`pnpm test` is frontend vitest, then reel-backend, then studio-backend. `pnpm lint` lints the two Fastify packages (not the frontend ESLint pass).

### G. Fast suite (units + Python, no Playwright)

```bash
pnpm test:fast
```

### H. Playwright e2e

Needs `pnpm dev` already running and installed Chrome. Full spec map, env table, and data-safety rules: [`test/README.md`](../test/README.md).

```bash
# terminal 1: pnpm dev   (or reuse)
pnpm test:e2e              # default suite, skips @slow, about 2 minutes
pnpm test:e2e:slow         # also @slow real render and Whisper
pnpm test:e2e:report
pnpm test:e2e test/e2e/studio-ui.spec.ts
pnpm test:e2e -g "waveform"
```

Safety:

- Default Studio specs create `e2e-fix-*` fixtures and delete only `e2e-*` folders afterwards.
- Never run `projects delete-all` against the default `studio/` directory. The delete-all e2e stays skipped unless `KRAYON_STUDIO_ROOT` points at a temp dir under `tmp/`.
- `E2E_REAL=1` uses an existing project and must not delete it.
- Do not point default `pnpm dev` at a temp `KRAYON_STUDIO_ROOT`.

Spec map (keep in sync with `test/README.md`): studio-api, studio-empty, studio-script, studio-ui, studio-flow, studio-edit, studio-rebuild, studio-render (`@slow`, needs `E2E_RENDER=1`), studio-a11y-and-theme, studio-errors, studio-whisper (`@slow`, `E2E_WHISPER=1`), studio-projects, legacy-audio (seeded Rebuild; Analyze-silence is `@slow` + Whisper), reel (mocked `/api/reel`), home-nav.

## 4. Studio audio CLI smoke (careful)

`pnpm krayon` talks to the Studio server (`KRAYON_STUDIO_URL` default `http://127.0.0.1:8789`). Read-only checks after the servers are up:

```bash
pnpm krayon doctor
pnpm krayon projects list
pnpm krayon schema
```

Do not run `analyze`, `reanalyze`, or `render` against existing user projects (`real`, `test1`, or anything not named `e2e-*`). Playwright covers analyze-with-cached-words via the fixture. Full Whisper and a real ffmpeg render belong to `pnpm test:e2e:slow`, not an ad-hoc CLI hit on user data.

Manual browser smoke: open `/studio`. Do not start Analyze on a large personal video. If you need a throwaway project, delete only that `e2e-*` or clearly temporary slug afterward.

When a project is `ready` and has a selection, **2 Video** and **Continue to visuals** open `/studio/:slug/video`. That page plays `GET /api/studio/projects/:slug/cut-audio.wav` (selected order, pad 0). The chosen diagram id is `canvasDraft` `{ version: 2, reelId }`. Version 1 `{ elements: [] }` still loads as the picker. Do not require an MP4 render to open visuals.

## 5. Local compile (“deploy”)

Krayon is a local app. `pnpm build` is the production frontend compile check. Playwright targets the dev server, not `dist/`.

```bash
pnpm build                 # tsc && vite build → dist/ (Vite root is src/frontend)
pnpm preview               # dist/ on http://127.0.0.1:4173, same /api proxy as dev
pnpm backend
pnpm reel-backend:fixed    # or pnpm reel-backend
pnpm studio-backend:fixed
```

`pnpm preview` prints `http://127.0.0.1:4173/` and, with the current Vite config, forwards `/api` to the same backends as dev (`GET /api/health` returns the Python `{ "status": "ok" }`). Playwright still targets `pnpm dev` (http://localhost:5174) or `pnpm fixed` (http://localhost:5175).

## 6. How the pipelines relate

- Legacy audio editor (`/audio`, `/editor/:mediaId`, Python `/api/silence`) is separate from Studio.
- Studio audio (Python `/api/audio-studio` + studio-backend + `/studio`) is the talking-head cut pipeline. `/studio/:slug/video` is the shared rushk workspace with that cut’s audio attached.
- Gemini reel (`/api/reel/jobs`, Chat on `/reel-animations`) is optional and key-gated (`X-Gemini-Api-Key` / cookie `krayon_gemini_api_key`, never localStorage). While a diagram reel is loaded, Apply does not replace the diagram timeline. The diagram CLI does not call Gemini.
- Excalidraw diagram CLI writes `diagrams/<reel-id>/states/`, `review/*.png`, and `status.json` from `diagram.skeleton.json`. The reel workspace reads those through the diagram GET routes.

## 7. Config

- `src/backend/krayon.toml` — Whisper, silence, ffmpeg paths
- `src/studio-backend/krayon-studio.toml` — host, port, CORS, python_base
- `src/reel-backend/krayon-reel.toml` — Gemini models, diagram `chrome_path`
- Env: `KRAYON_CHROME_PATH`, `KRAYON_DIAGRAMS_DIR`, `KRAYON_STUDIO_URL`, `KRAYON_FIXED`, and the `E2E_*` table in [`test/README.md`](../test/README.md)

## Last verified

2026-11-07, against the working tree (not committed).

- Docs: this file, plus pointers in `README.md`, `install.md`, `AGENTS.md`, `test/README.md`. `docs/diagram-pipeline.md` already described the read-only diagram HTTP routes.
- Implemented: shared rushk `ReelWorkspace` at `/reel-animations/*` and `/studio/:slug/video`; Studio **2 Video** when ready with a selection; `canvasDraft` v2 `reelId`; `GET /api/reel/diagrams` and `GET .../cut-audio.wav`. The already-running `pnpm fixed` processes on 5175 / 8788 / 8789 do not hot-reload, so those routes 404 until that stack is restarted. A current `pnpm frontend` on 5174 was used for the browser smoke.
- `pnpm studio:doctor` ok. Frontend vitest 212 passed (3 expected fail). Reel-backend 40 passed, 1 skipped (`live.test`, no Gemini key). Studio-backend 72 passed (3 expected fail). `pnpm test:backend` 138 passed, 1 xfailed. Diagram list/validate/build both examples exit 0. Uber step-01 1270×1308, Airbnb step-04 1831×1559, white corners, ink not on the right or bottom edge, full labels. `pnpm typecheck` and `pnpm lint` passed.
- Browser http://localhost:5174: home tiles, `/reel-animations/_examples/uber-ttl` rushk frame (build hint, because the old reel server 404s `/api/reel/diagrams/meta`), `/studio/test1` with **2 Video** enabled and **Continue to visuals**, `/studio/test1/video` empty picker plus cut-audio row, `/audio` library. No Analyze was started on `test1`.
- `pnpm test:e2e`: 46 passed, 1 skipped (delete-all), 1 failed then fixed. The failure was `reel.spec.ts`: an empty diagram reel forced `trackCount` to 1, so an applied box on track 1 was not drawn. That force was removed; the spec then passed.
- `pnpm build` passed. `pnpm preview` on http://127.0.0.1:4173 proxied `GET /api/health` to Python.
- Skipped: `pnpm test:e2e:slow`, live Gemini (`KRAYON_GEMINI_API_KEY` unset), analyze/render of user projects. `python3.12` is not on PATH; the backend venv reported Python 3.14.6 during pytest. A sandboxed first pass of reel Chrome launch and ffmpeg VideoToolbox failed; the same commands passed outside the sandbox.
