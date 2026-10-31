# Studio

Studio turns one long talking-head recording into a single video made of the chosen takes. The browser, the `krayon` CLI, and Grok all edit the same cut list. Nothing is uploaded.

Canvas animation is not part of this phase. `cuts.json` keeps an empty `canvasDraft` for later.

## Folders

Projects live in `studio/<slug>/` (gitignored):

| Path | Role |
|---|---|
| `meta.json` | Title, source path, revision pointer, id counters, status |
| `cuts.json` | Clips, groups, selected order, `canvasDraft` |
| `analysis/source.wav` | 16 kHz mono cache. Reused if present |
| `analysis/words.json` | Word timestamps. Reused if present, so a rerun does not re-extract or re-transcribe |
| `history/0001.json` | Snapshot plus `actor`, `label`, `summary` |
| `output/` | Preview and final mp4 files and a JSON manifest of clip ids to output time |
| `confirmations.json` | Pending and answered Grok questions (not in undo) |

The original video path is stored and never modified.

## Clip model

Ids are `c-0007` for clips and `g-0001` for retake groups. A project never reuses an id. Split and merge retire the old ids, mint new ones, and set `parentIds`.

Re-analysis keeps an existing id when the new time span overlaps it with intersection-over-union of at least 0.7. Spans that do not match get new ids. Human `status`, `decidedBy`, and `note` stay on a matched clip.

| Field | Meaning |
|---|---|
| `sourceStart` / `sourceEnd` | Seconds on the original file |
| `ranges` | Stitched source spans when a clip is more than one piece |
| `words` | `{ text, start, end }` on the source timeline |
| `groupId` | Retake group |
| `label` | `falseStart`, `cut_off`, `starts_late`, `missing_words`, `misstatement`, or `none` |
| `score` / `reasons` | From the existing reference-take ranking |
| `status` | `selected`, `rejected`, or `undecided` |
| `decidedBy` | `algorithm`, `grok`, or `human` |
| `note` | Free text |

`order` is the selected clip ids in cut order. The first pass selects the clip whose reasons include `reference take`, otherwise the group's recommended clip, otherwise the only take. Non-reference takes with a flaw label (`falseStart`, `cut_off`, `starts_late`, `missing_words`, `misstatement`) are rejected; clean alternates stay undecided. Order follows the first appearance of each group.

Lint `edge_loud` uses the 150 ms windows *outside* the clip (`before` / `after`) and fires when RMS is louder than **-40 dBFS** (the cut landed in speech). `edge_clipped` fires when the clip's own first or last **20 ms** is louder than **-30 dBFS** *and* that neighbor window is also above -40 dBFS. Clip detail still reports 150 ms `start`/`end` plus 20 ms `startEdge`/`endEdge`.

## Setup

After pulling, reinstall the Python venv (`pip install -r src/backend/requirements.txt` inside `src/backend/.krayonenv`) because `av` is pinned below 17, then restart the backend.

## Services

- UI: `http://localhost:5173/studio` (Vite proxies `/api/studio` to `127.0.0.1:8789`)
- Studio API: Fastify on `127.0.0.1:8789`, CORS limited to the Vite origin
- Audio and render: Python `http://127.0.0.1:8000/api/audio-studio` (called by Fastify, not by the browser)

Final renders always re-encode video (`h264_videotoolbox` on a Mac, otherwise `libx264`) and apply short audio fades at joins. Preview is a faster, smaller encode.

## API

All project routes are under `/api/studio/projects/:slug`. Send `X-Krayon-Actor: grok` or `human`.

- `GET /api/studio/schema` — fields, ops, rules, error example
- `GET/POST /api/studio/projects`, `POST /api/studio/projects/use`
- `GET /projects/:slug` — clips, groups, order, revision, history
- `POST /projects/:slug/import` — `{ "path" }` or a multipart file streamed to `imported/`
- `POST /projects/:slug/analyze`
- `GET /projects/:slug/clips?group=&label=&status=`
- `GET /projects/:slug/clips/:id` — words, neighbours, group mates, reasons
- `GET /projects/:slug/clips/:id/audio.wav?pad=0.5`
- `GET /projects/:slug/clips/:id/transcript`
- `GET /projects/:slug/clips/:id/frame.png?at=`
- `POST /projects/:slug/ops` — `{ baseRevision, ops, label }`. Mismatch is HTTP 409. Validation errors include `clipId`, `field`, `message`, `allowed`.
- `POST /projects/:slug/reanalyze` — `mode` is `retranscribe`, `resegment`, or `regroup`
- `POST /projects/:slug/render` — `{ "quality": "preview" \| "final" }`
- `GET /projects/:slug/render/:id`, `GET /projects/:slug/output`
- `GET /projects/:slug/lint`, `GET /projects/:slug/history`
- `POST /projects/:slug/undo`, `/redo`, `/restore`
- `GET /projects/:slug/events` — server-sent events for progress, revisions, and confirmations
- `GET/POST /projects/:slug/confirmations`, `POST …/answer`, `POST …/cancel`, `GET …/wait`, `GET …/wait-any`
- `POST /projects/:slug/reset-status`

## Confirmations

Grok never asks for confirmation in chat. It writes a question to `confirmations.json` (`krayon ask … --wait`). The workspace shows the oldest pending item; a human click answers it. If the option has `applyOps`, the server applies `proposedOps` as one history revision with actor `human`. If the project revision moved, the item is `stale` and nothing is applied.

Ops: `select`, `reject`, `undecided`, `reorder`, `split` (`at` or `wordIndex`), `merge`, `trim` (word snap unless `sampleAccurate`), `ungroup`, `moveToGroup`, `note`.

Undo and redo move the history pointer. Restore copies an older snapshot forward as a new revision. A new edit drops the redo branch. Id counters only increase, including across undo.

## Grok loop

1. `krayon status`
2. `krayon lint`
3. `krayon clip c-0007` and `krayon play-info c-0007` (padded wav)
4. `reanalyze`, `split`, `merge`, or `trim`
5. `krayon select c-0007`
6. `krayon render --preview`, then listen and look
7. `krayon render` for the final file

The UI updates from the event stream when the CLI writes a revision.
