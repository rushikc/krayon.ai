# rushk diagram skeleton (author spec)

Write `diagrams/<reel-id>/diagram.skeleton.json`. Krayon lays it out in portrait, writes one `.excalidraw` file per reveal step, and renders cropped white PNGs. **Do not write x/y/width/height.** Positions come from the layout engine.

CLI (from `src/reel-backend`):

```bash
npm run diagram -- validate <reel-id>
npm run diagram -- build <reel-id>
npm run diagram -- list
```

`<reel-id>` is a path under `diagrams/`, for example `_examples/uber-ttl`.

## File contract

```
diagrams/<reel-id>/
  script.md                 # voiceover (optional)
  diagram.skeleton.json     # you write this
  script.words.json         # optional [{ word, start, end }]
  states/<card>/step-NN.excalidraw   # generated
  review/<card>/step-NN.png          # generated
  status.json                        # generated report
```

## Root

| Field | Rule |
| --- | --- |
| `version` | `1` |
| `reelId` | kebab-case |
| `title` | Fixed top title. Informational; not drawn on the PNG. |
| `cards` | One or more cards. Clear and start a **new card** instead of shrinking. |

## Card

| Field | Rule |
| --- | --- |
| `id` | kebab-case, unique in the reel |
| `caption` | Optional, ≤ 60 chars. Under-card line; not drawn on the PNG. |
| `direction` | `"down"` (default) or `"right"` |
| `nodes` | At least one |
| `edges` | Optional |
| `badges` | Optional. One blue pill per takeaway. |
| `annotations` | Optional. Red handwriting for numbers and side notes. |
| `marks` | Optional. `"x"` (red) or `"check"` (green) |
| `steps` | Contiguous from 1. `at` is seconds, strictly increasing. |

An element appears at its `step` and **stays** until the end of the card (cumulative states).

## Nodes, edges, attachments

**Shapes:** `rect`, `rounded`, `diamond`, `ellipse`, `pill`. No cylinder.

**Tones:** `blue` (structure), `red`, `green`, `ink`.

**Text:** node label ≤ 28 chars (up to 2 lines), badge ≤ 40, annotation ≤ 24, caption ≤ 60.

**Ids** unique on the card. Edges `from`/`to` must be **nodes**. `attachTo` on badges, annotations, and marks must be a node or edge id.

**Placement:** `above` | `below` | `left` | `right`.

**Edge style:** `solid` | `dashed`. `label` may be `null`.

## Rushk rules

- 3–6 shapes (nodes + badges + annotations) visible at once. Above 6 is a warning; above 10 is an error. Start a new card.
- One blue badge per takeaway.
- Red annotation for numbers, inputs, limits.
- Green check for success; red X for the wrong choice.
- Do not shrink old content to make room.

## Optional word timings

If `script.words.json` exists as `[{ "word": "Redis", "start": 4.2, "end": 4.6 }]`, each `steps[].at` should sit within **0.8s** of a word start (`STEP_NOT_ON_WORD` warning). Do not invent this file here.

## Report codes (`status.json` → `issues`)

| Code | Meaning | What to do |
| --- | --- | --- |
| `SCHEMA_INVALID` | JSON/zod failed | Fix types and required fields |
| `DUPLICATE_ID` | Id reused on the card | Rename |
| `UNKNOWN_REF` | `from`/`to`/`attachTo` missing | Point at a real id |
| `EDGE_ENDPOINT_NOT_NODE` | Edge attached to a badge/mark | Edges connect nodes only |
| `INVALID_STEP` | Element `step` not in `steps[]` | Add the step or change `step` |
| `STEPS_NOT_CONTIGUOUS` | Steps not 1..N | Renumber |
| `STEPS_NOT_INCREASING` | `at` not strictly increasing | Fix times |
| `TEXT_TOO_LONG` | Over the char limit | Shorten |
| `DENSITY` | Too many visible pieces | Split into a new card |
| `TEXT_TOO_SMALL` | Will not fit 880px at 20px font | Fewer/shorter labels |
| `OVERLAP` | Boxes collide | Split card or shorten labels |
| `OUT_OF_BOUNDS` | Past the 880px card | Split or use `direction: "down"` |
| `TEXT_OVERFLOW` | Real font wider than the box | Shorten label |
| `EDGE_CROSSES_NODE` | Arrow through a node | Change connections or split |
| `STEP_NOT_ON_WORD` | `at` not near a word start | Nudge `at` |
| `CHROME_NOT_FOUND` | No system Chrome | Install Chrome or set `KRAYON_CHROME_PATH` |
| `REEL_NOT_FOUND` | Missing skeleton file | Create `diagram.skeleton.json` |

`ok` is false if any issue has `severity: "error"`. Rebuild increments `round` and keeps `status.prev.json`.

## Worked example: Uber TTL

See [`diagrams/_examples/uber-ttl/diagram.skeleton.json`](../../diagrams/_examples/uber-ttl/diagram.skeleton.json).

Five cumulative steps on one card:

1. Redis (ellipse) + DynamoDB (rounded)
2. Arrow Redis → DynamoDB
3. Blue badge `TTL - Time To Live` below DynamoDB
4. Red `10 sec` to the right of DynamoDB
5. Red X on DynamoDB

## Worked example: Airbnb auth flow

See [`diagrams/_examples/airbnb-flow/diagram.skeleton.json`](../../diagrams/_examples/airbnb-flow/diagram.skeleton.json).

1. Client
2. Auth Backend + arrow from Client
3. UI Screen (diamond) + arrow from Auth Backend
4. Red `Policy Engine` to the right of Auth Backend
