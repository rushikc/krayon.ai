# Reel generate → review → fix pipeline

Local TypeScript Fastify service that turns a teaching **script** into reel scene JSON (boxes, numbers, arrows), renders Bright-skin PNG keyframes, asks Gemini to score them, and redraws anything below threshold.

Nothing is stored in the cloud except the script, scene JSON, and keyframe images sent to **Gemini Developer API** when the UI supplies an API key. Audio analysis stays on the Python backend. This service does not generate video.

## Run

```bash
pnpm install
pnpm reel-backend          # http://127.0.0.1:8788
pnpm dev                   # frontend :5173 + Python :8000 + reel :8788
pnpm dev:all               # same as pnpm dev
```

Vite proxies `/api/reel` to `127.0.0.1:8788` and `/api` to the Python app on port 8000.

Package: [`src/reel-backend/`](../src/reel-backend/) (`@krayon/reel-backend`). Bind address is **127.0.0.1 only**. CORS origins: `http://localhost:5173`, `http://127.0.0.1:5173`.

## Architecture

```text
POST /api/reel/jobs  +  X-Gemini-Api-Key
        │
        ▼
  in-process job (AbortController)
        │
        ├─ Gemini structured JSON  →  Zod scene schema
        ├─ SVG layout (ported 18×32 math) → resvg-js PNG (1080×1920)
        ├─ Gemini multimodal review (clarity / readability / accuracy)
        └─ if min(score) < 8: fix JSON, re-render, re-review (default 2 rounds)
        │
        ▼
  SQLite  src/reel-backend/data/reel.sqlite3
  PNGs    src/reel-backend/data/jobs/{id}/r{n}/
  logs    src/reel-backend/logs/   (app.log + app.jsonl, secrets redacted)
```

### Why SVG + resvg, not a browser

Review stills only need the **Bright** filled look. Editor skins are React/Tailwind (and calidraw sketch paths). Sharing `matrixToPercents` / `getArrowGeometry` in the reel package and painting one SVG is enough for Gemini. Sharp is not an SVG layout engine. A headless browser would match all five skins but is heavier than this loop needs.

### Loop

1. **Generate** scene JSON (`{ elements: [...] }` from Gemini, stored as a flat array).
2. Pick up to **8** timeline instants (starts, mids, last visible frame).
3. **Review** with PNGs attached. Scores 0–10 for **clarity**, **readability**, **accuracy**. **overall** = min of the three. Pass if overall ≥ **8**.
4. If it fails and rounds remain, **fix** from the issue list, validate, render, review again.
5. Keep every round’s JSON, images, scores, and issues. The job **result** is the best round (highest overall, then fewest issues).

**Refine** (`POST .../refine`) starts from the parent’s best scene. The first model call is a fix with extra instructions, then the same review/fix loop. Send the API key again; it is never persisted.

## Gemini key (what the UI must do)

The server **never** reads an env var for the key and **never** writes it to SQLite, files, or logs.

1. Store the Google AI Studio key in a first-party cookie named `krayon_gemini_api_key`.
2. Cookie flags: `SameSite=Strict`. Add `Secure` when the page is HTTPS. Do **not** set `HttpOnly` so the app can read it.
3. On every create/refine request, send header **`X-Gemini-Api-Key`** with that value.
4. The server only looks at the header. It does not set this cookie.

Use the official `@google/genai` SDK against the **Gemini Developer API** (not Vertex). Default model: `gemini-2.5-flash` for generate, review, and fix (overridable per request and in config).

## Config

[`src/reel-backend/krayon-reel.toml`](../src/reel-backend/krayon-reel.toml). Env overrides use prefix `KRAYON_REEL_` (for example `KRAYON_REEL_PORT`, `KRAYON_REEL_GEMINI_MODEL`, `KRAYON_REEL_MAX_ROUNDS`). There is **no** key setting.

| Key | Default | Meaning |
| --- | --- | --- |
| `host` / `port` | `127.0.0.1` / `8788` | Listen |
| `cors_origins` | Vite origins | Allowed browser origins |
| `gemini.model` | `gemini-2.5-flash` | Generate |
| `gemini.review_model` / `fix_model` | same | Review / fix |
| `gemini.timeout_ms` | `90000` | Per call |
| `pipeline.max_rounds` | `2` | Review rounds |
| `pipeline.pass_score` | `8` | Min of the three scores |
| `pipeline.max_keyframes` | `8` | Stills per round |
| `pipeline.generate_attempts` | `3` | Schema-repair tries |
| `render.width` / `height` | `1080` / `1920` | PNG size |

## Scene validation

Stricter than inspector paste: unique ids; 18×32 integer `matrix`; arrows only between **box** ids; `colorTheme` allowlist; `time.end > time.start`; `track` 0–9; no `x`/`y`/`width`/`height`; optional number `size` 4–40; optional box `fontSize` 10–48.

## API contract

Base path (also used through the Vite proxy): **`/api/reel`**.

JSON errors: `{ "code": string, "message": string }`.

### `GET /health`

```json
{ "ok": true, "service": "reel-backend" }
```

No Gemini call.

### `POST /jobs` → **202** `{ "jobId": "uuid" }`

Header: `X-Gemini-Api-Key` (required).

```json
{
  "script": "spoken or written teaching script",
  "maxRounds": 2,
  "models": { "generate": "gemini-2.5-flash", "review": "gemini-2.5-flash", "fix": "gemini-2.5-flash" }
}
```

`maxRounds` and `models` are optional.

### `GET /jobs` → `{ "jobs": JobSummary[] }`

Newest first. No images.

```ts
type JobSummary = {
  id: string
  status: "queued" | "running" | "done" | "error" | "cancelled"
  createdAt: string
  updatedAt: string
  parentJobId?: string
  error?: { code: string; message: string }
}
```

### `GET /jobs/:id` → `JobState`

```ts
type JobState = {
  id: string
  status: "queued" | "running" | "done" | "error" | "cancelled"
  script: string
  parentJobId?: string
  refineInstructions?: string
  maxRounds: number
  passScore: number
  models: { generate: string; review: string; fix: string }
  progress: { phase: string; message: string; round: number; ratio: number }
  rounds: Array<{
    n: number
    scene: unknown[] // CanvasElement[]
    scores: { clarity: number; readability: number; accuracy: number; overall: number } | null
    pass: boolean | null
    issues: Array<{ problem: string; severity: "low" | "medium" | "high"; frameIndex?: number }>
    keyframes: Array<{ index: number; time: number; url: string }>
  }>
  result?: { scene: unknown[]; scores: JobState["rounds"][0]["scores"]; round: number }
  error?: { code: string; message: string }
  createdAt: string
  updatedAt: string
}
```

Keyframe `url` is a path such as `/api/reel/jobs/{id}/rounds/1/images/0`.

### `GET /jobs/:id/events` (SSE)

`Content-Type: text/event-stream`. `id:` is a monotonic seq. Send `Last-Event-ID` to replay. First event is a snapshot. Heartbeat comments `: ping`. The stream ends after `done`, `error`, or `cancelled`.

```ts
type ReelEvent =
  | { type: "snapshot"; job: JobState }
  | { type: "progress"; phase: string; message: string; round: number; ratio: number }
  | { type: "round"; round: number; phase: "generate" | "render" | "review" | "fix" }
  | { type: "done"; job: JobState }
  | { type: "error"; code: string; message: string }
  | { type: "cancelled" }
```

Phases: `generate` → `render` → `review` → (`fix` → `render` → `review`)* → `done`.

### `GET /jobs/:id/rounds/:n/images/:index` → `image/png`

### `POST /jobs/:id/cancel` → `{ "ok": true }`

409 if the job is already terminal.

### `POST /jobs/:id/refine` → **202** `{ "jobId", "parentJobId" }`

Header: `X-Gemini-Api-Key`. Body: `{ "instructions": string, "maxRounds"?: number, "models"?: { ... } }`. Parent must be `done` with a `result.scene`.

### HTTP status and `code`

| code | Typical status | When |
| --- | --- | --- |
| `UNAUTHORIZED` | 401 | Missing `X-Gemini-Api-Key` |
| `BAD_API_KEY` | 401 | Gemini rejected the key |
| `BAD_REQUEST` | 400 | Missing script/instructions, invalid body |
| `NOT_FOUND` | 404 | Job or image |
| `CONFLICT` | 409 | Cancel/refine on a job in the wrong state |
| `SCHEMA_INVALID` | 422 | Scene/review JSON failed Zod after retries |
| `NOT_JSON` | 422 | Empty or malformed model JSON |
| `RATE_LIMITED` | 429 | 429/503 after 4 backoff tries (4/8/16/32s ± jitter, `Retry-After` honored) |
| `QUOTA` | 429 | Quota language on 429 |
| `MAX_TOKENS` | 502 | `finishReason` MAX_TOKENS (not retried) |
| `SAFETY_BLOCKED` | 502 | Safety / prohibited content |
| `TIMEOUT` | 502 | Call aborted on timeout |
| `CANCELLED` | 409 | Job cancelled |
| `UPSTREAM` | 502 | Other Gemini/server failures |

Create/refine still return **202** if the job was accepted; later Gemini failures appear on job `status: "error"` and SSE `error`. Missing key fails the HTTP request immediately.

## Tests

```bash
pnpm test:reel                         # fake Gemini, no network
pnpm --filter @krayon/reel-backend test:live   # only if KRAYON_GEMINI_API_KEY is set
pnpm --filter @krayon/reel-backend lint
pnpm --filter @krayon/reel-backend typecheck
```

Default tests inject a fake Gemini client. The live file is skipped unless `KRAYON_GEMINI_API_KEY` is present (that env is for developers running the opt-in test, not for the server).
