# Skill: Build Krayon reel-animation JSON from a subtitle file

You are generating an **animated explainer scene** for the Krayon reel editor (`/reel-animations`).

The user gives you:

1. **This skill file** (the full spec — everything you need is here).
2. **A subtitle file** (`.srt`, sometimes `.vtt` or a plain list of timestamped lines).

You must return **one JSON array** of scene elements. The user pastes that array into Krayon's inspector **JSON** tab, presses Cmd/Ctrl+Enter, and the animation plays back in sync with the narration the subtitle came from.

Everything below is the real contract enforced by the app's parser. If you break a rule, the paste is rejected and nothing renders.

---

## 1. The job in one paragraph

Read the subtitle cues. Work out what is being *explained* (services, components, steps, data flows). Turn each concept into a **box**, each enumeration into a **number badge**, and each stated flow into an **arrow**. Then time every element so it **appears exactly when the narrator says it** and stays on screen while it is still relevant. Lay everything out on a fixed **18-column x 32-row grid** inside a 9:16 vertical frame. Output the JSON array only.

---

## 2. Output contract (read this twice)

- Output **a single JSON array**: `[ { ... }, { ... } ]`.
- **No** wrapper object. `{"elements": [...]}` is invalid.
- **No** comments, no trailing commas, no markdown prose inside the code block, no `...` placeholders.
- All keys are **camelCase** exactly as spelled in this doc.
- All `matrix` values are **integers**.
- Put the array in one fenced ```json block so it can be copied in one action.
- Do not include `duration`, `trackCount`, `theme`, `x`, `y`, `width`, or `height`. Those are not part of the element schema. Optional `size` is allowed **only** on `number` (badge diameter as % of canvas width).

Before answering, run the validation checklist in §12.

---

## 3. The canvas

The reel frame is a **9:16 portrait rectangle** (1080 x 1920 on export). Two render layers share one coordinate system:

| Layer | What lives there | How it is drawn |
| --- | --- | --- |
| SVG underlay | `arrow` elements | `<svg viewBox="0 0 100 100" preserveAspectRatio="none">`, one SVG unit = 1% of the frame |
| HTML overlay | `box` and `number` elements | absolutely positioned `<div>`s with `left/top/width/height` in `%` |

Because the SVG viewBox is `0 0 100 100` with `preserveAspectRatio="none"`, SVG unit `50,50` is the same physical point as CSS `left: 50%; top: 50%`. That is why arrows can attach to HTML boxes precisely.

**HTML always paints above SVG.** Boxes and badges cover arrow shafts where they overlap. That is intentional: draw an arrow "through" a box and the box wins.

---

## 4. The grid system (`matrix`)

You never write percentages. You write **grid cells**. The app converts them.

| Property | Value |
| --- | --- |
| Columns | **18** — valid indices `0..17` |
| Rows | **32** — valid indices `0..31` |
| Cell width | `100 / 18` = **5.5556%** of frame width |
| Cell height | `100 / 32` = **3.125%** of frame height |
| Cell size at export | **60 x 60 px** (1080/18 = 60, 1920/32 = 60) |
| Origin | Top-left cell is `[0, 0]` |

**Cells are square.** This matters: an N x N cell span is a true square, so a 2x2 badge is a perfect circle and a 4x4 box is a square tile.

### 4.1 Matrix format

`matrix` is **0-indexed and inclusive on both ends**.

| Element | Accepted shape | Meaning |
| --- | --- | --- |
| `box` | `[X1, Y1, X2, Y2]` — **exactly 4 numbers** | occupies every cell from column `X1` row `Y1` through column `X2` row `Y2` |
| `number` | `[X, Y]` (single cell) **or** `[X1, Y1, X2, Y2]` | `[X, Y]` is treated as `[X, Y, X, Y]` |
| `arrow` | **no `matrix` at all** | endpoints are computed from its two boxes |

### 4.2 Cell to percent math

This is exactly what `matrixToPercents` does:

```text
left   = X1 * (100 / 18)
top    = Y1 * (100 / 32)
width  = (X2 - X1 + 1) * (100 / 18)
height = (Y2 - Y1 + 1) * (100 / 32)
```

Worked example — `matrix: [2, 5, 15, 7]`:

```text
left   = 2  * 5.5556 = 11.11%
top    = 5  * 3.125  = 15.63%
width  = (15 - 2 + 1) * 5.5556 = 77.78%   (14 columns)
height = (7  - 5 + 1) * 3.125  = 9.38%    (3 rows)
```

So that box is a wide banner: 14 cells across, 3 cells tall, starting one-ninth from the left.

### 4.3 Hard validation rules

An element whose `matrix` breaks any of these makes the **whole paste fail**:

- Every entry must be an **integer** (`3.5` fails, `"3"` fails).
- `0 <= X1 <= X2 <= 17`.
- `0 <= Y1 <= Y2 <= 31`.
- **Never invert a range.** `X2 < X1` or `Y2 < Y1` is rejected; the app does not swap them for you.
- `box` matrix length must be **4**. `number` matrix length must be **2 or 4**.

### 4.4 Safe zones

Instagram/YouTube reel chrome covers the edges, and Krayon's optional preview overlay mimics it. Keep meaningful content inside these bands:

| Zone | Rows / cols | Use |
| --- | --- | --- |
| Status bar / app header | rows `0-2` | leave empty |
| Title band | rows `3-5` | optional headline box |
| Main content | rows `6-25`, cols `0-17` | the diagram |
| Right action rail | cols `16-17`, rows `14-25` | avoid critical text here |
| Caption / username | rows `26-31` | leave empty |

Practical default: build inside **rows 3-26**, and prefer **cols 0-15** in the lower half.

---

## 5. Element catalog

Exactly **three** element types exist: `box`, `number`, `arrow`. Any other `type` value fails the paste.

Every element, regardless of type, requires:

| Key | Type | Notes |
| --- | --- | --- |
| `id` | string | Unique, stable, kebab-case (e.g. `"dynamodb-table"`). Arrows reference box ids. |
| `type` | `"box" \| "number" \| "arrow"` | discriminator |
| `time` | object | `{ start, end, track }` — see §7 |

### 5.1 `box` — labeled rectangle (the workhorse)

A rounded rectangle with a bold primary label and an optional second line. Use it for services, components, datastores, headings, and callouts.

| Key | Required | Type | What it controls |
| --- | --- | --- | --- |
| `id` | yes | string | identity; arrow endpoints reference this |
| `type` | yes | `"box"` | — |
| `matrix` | yes | `[X1, Y1, X2, Y2]` | position and size on the grid |
| `label` | yes | string | **primary text**, bold, centered (or top-left if `sublabel` is present) |
| `sublabel` | no | string | second line under the label, rendered at **75% of the label size** and slightly faded. Empty string = treated as absent |
| `fontSize` | no | number | label size in **CSS px**. Default **14**. Accepted range **10-48** |
| `colorTheme` | yes | enum | fill color, see §6 |
| `time` | yes | object | visibility window + z-order |

**Text truncation warning.** In the default filled skin the label and sublabel are **single-line with ellipsis** — long text is cut, not wrapped. Keep labels to **2-4 words**. Rough capacity at the default 14px:

| Box width | Comfortable label length |
| --- | --- |
| 14 cols (banner) | up to ~28 characters |
| 10 cols | up to ~20 characters |
| 7 cols (callout) | up to ~14 characters, drop `fontSize` to `12` |
| 4-5 cols | 1 short word |

If you need more words, widen the box, lower `fontSize`, or move the detail into `sublabel`.

```json
{
  "id": "dynamodb-table",
  "type": "box",
  "matrix": [2, 6, 15, 8],
  "label": "DynamoDB Table",
  "sublabel": "item-level writes",
  "colorTheme": "blue",
  "time": { "start": 2.4, "end": 30, "track": 3 }
}
```

### 5.2 `number` — circular step badge

A circle with a number inside. Use it to enumerate narration steps ("first", "second", "then"). The **only** visible content is `value`; a badge has no label field.

| Key | Required | Type | What it controls |
| --- | --- | --- | --- |
| `id` | yes | string | identity |
| `type` | yes | `"number"` | — |
| `matrix` | yes | `[X, Y]` or `[X1, Y1, X2, Y2]` | position. Prefer a 2x2 cell for the origin, e.g. `[0, 6, 1, 7]` |
| `size` | no | number | diameter as **% of canvas width** (4–40). When present, overrides matrix-derived width. Prefer **6**. |
| `value` | yes | number | the digit(s) drawn in the center |
| `colorTheme` | yes | enum | fill color, see §6. `ink` (dark fill, light text) is the conventional badge look |
| `time` | yes | object | visibility window + z-order |

The badge forces `aspect-ratio: 1` from its **width**. Prefer `size` for diameter so matrix can stay a compact 2x2 origin cell.

**There is no `fontSize` for badges.** The digit is fixed at 14px regardless of circle size.

**A `number` cannot be an arrow endpoint.** `sourceId`/`targetId` accept box ids only.

```json
{
  "id": "step-1",
  "type": "number",
  "size": 6,
  "matrix": [0, 6, 1, 7],
  "value": 1,
  "colorTheme": "ink",
  "time": { "start": 2.4, "end": 9.8, "track": 1 }
}
```

### 5.3 `arrow` — connector between two boxes

An SVG line with an arrowhead. It has **no geometry of its own** — it is defined purely by which two boxes it links, and it re-computes itself if those boxes move.

| Key | Required | Type | What it controls |
| --- | --- | --- | --- |
| `id` | yes | string | identity |
| `type` | yes | `"arrow"` | — |
| `sourceId` | yes | string | `id` of the **box** the shaft starts at |
| `targetId` | yes | string | `id` of the **box** the arrowhead points at |
| `variant` | no | `"solid" \| "dashed"` | `"dashed"` renders `stroke-dasharray: 6 5`. Any other string is dropped |
| `time` | yes | object | visibility window + z-order |

**How the line is computed** (`getArrowGeometry`):

1. Look up both boxes by id. **If either id does not exist, the arrow draws nothing** (silent no-op).
2. Convert each box `matrix` to a percent rect, take its center.
3. Cast a ray between the two centers and clip it to each box's rectangle, so the line touches **edges**, not centers.
4. Pull each end back by `0.75%` so the stroke does not sit on the border.
5. If the two centers coincide, draw nothing.
6. Emit `<line>` in the `0 0 100 100` viewBox with a `marker-end` arrowhead at the target.

Consequences you must design around:

- Arrows are **straight only**. No elbows, no waypoints. Two boxes stacked vertically give a clean vertical arrow; diagonal pairs give a diagonal line that may cross other boxes.
- Leave a **1-2 row gap** between stacked boxes so the arrow is visible.
- The arrow uses the box's stored matrix even if that box is not currently visible, but the arrow itself only shows during its own `time` window.

```json
{
  "id": "table-to-stream",
  "type": "arrow",
  "sourceId": "dynamodb-table",
  "targetId": "stream",
  "variant": "solid",
  "time": { "start": 3.2, "end": 30, "track": 7 }
}
```

---

## 6. `colorTheme` palette

Applies to **`box` and `number` only**. Arrows have no color field; they stroke with the canvas ink color.

Allowed values (anything else fails the paste):

`ink` · `violet` · `green` · `blue` · `sky` · `lavender` · `mint` · `tan` · `yellow` · `orange` · `pink` · `salmon`

`ink` is the dark, high-contrast fill and renders its text inverted (light on dark). The rest are pastel fills with dark text.

Suggested semantic mapping — stay consistent within one reel:

| Role in the story | Theme |
| --- | --- |
| Step badges, titles, emphasis | `ink` |
| Client / user / entry point | `sky` |
| API / gateway / routing | `violet` |
| Compute / functions / workers | `green` |
| Databases / storage | `blue` |
| Streams / queues / events | `lavender` |
| Search / analytics | `tan` |
| Success / result states | `mint` |
| Warnings, "don't do this" | `salmon` |
| Callout chips | `yellow`, `orange`, `pink` |

Do not use more than about five distinct fills in one reel, or it stops reading as a diagram.

---

## 7. `time` — the animation model

```json
"time": { "start": 2.4, "end": 12.0, "track": 3 }
```

All three keys are **required on every element** and must be finite numbers.

### 7.1 `start` / `end`

- Seconds on the reel clock. Decimals are fine and encouraged (`2.4`, `13.75`).
- Visibility is the **half-open interval `[start, end)`** — visible at `start`, gone exactly at `end`.
- `start` is when the element **animates in**: it fades from 0 opacity and slides up a short distance over **300ms**. This is automatic; there is no animation field to set.
- `end` is a **hard cut** — no fade out. To retire something gracefully, end it on a narration boundary or when a new element takes its place.
- Nothing enforces `end > start`, but a non-positive span means the element never appears. Always give at least **~0.8s** of screen time, and **1.5s+** for anything with text to read.

Since the only transition is the 300ms enter animation, **staggering `start` values is how you build the reveal**. Give sequential elements 0.3-0.8s of separation so they land one at a time rather than all at once.

### 7.2 `track` — z-order, not a lane

- **`track: 0` is the front-most layer.** Higher numbers render further back (HTML `z-index` is `100 - track`).
- Valid range for this project: **`0` through `9`** (the timeline shows 10 rows). A higher number still draws, but you cannot see or edit it in the timeline, so never emit `track > 9`.
- Multiple elements may share a track. Prefer sharing a track between elements whose `time` ranges **do not overlap**, so the timeline stays readable.

Conventional allocation — follow it unless you have a reason not to:

| Track | Contents |
| --- | --- |
| `0` | callout chips and anything that must sit on top |
| `1` | number badges |
| `2` | titles / first box |
| `3-6` | main diagram boxes |
| `7-9` | arrows |

Arrows are on the SVG underlay regardless, so z-order between arrows rarely matters; their track is mostly a timeline-organization choice.

### 7.3 Reel duration

Duration is **not** a JSON field. After the user pastes the array, the editor sets the reel clock to the **latest `time.end`** in the list. Playback and export stop on the last frame that is still inside `[start, end)`, so the video does not end on an empty canvas.

- Use the **true subtitle seconds**. An 80s narration should have elements whose last `end` is about `80`.
- Do not compress a long script into 30 seconds.
- Do not add a duration note, and do not emit a `duration` key.

---

## 8. Reading the subtitle file

Standard SRT cue:

```text
7
00:00:16,400 --> 00:00:20,200
The stream instantly triggers
an AWS Lambda function
```

Convert timestamps to seconds:

```text
seconds = HH*3600 + MM*60 + SS + mmm/1000
00:00:16,400 -> 16.4
00:01:04,000 -> 64.0
```

A cue's text may span multiple lines — join them with a space; the line breaks are display wrapping, not meaning.

Build a working table before you write any JSON:

| Cue | Start | End | Narration | Concepts introduced | Flow stated |
| --- | --- | --- | --- | --- | --- |
| 1 | 0.0 | 3.0 | "Want your database to react instantly to changes?" | hook | — |
| 2 | 3.0 | 5.0 | "Enter DynamoDB Streams." | DynamoDB Streams | — |
| 7 | 16.4 | 20.2 | "The stream instantly triggers an AWS Lambda function" | Lambda | stream -> Lambda |

---

## 9. Subtitle to scene: the algorithm

Follow these steps in order.

**Step 1 — Segment the script into beats.**
Group consecutive cues into beats. Ordinal language is the strongest signal: "First massive use case", "Second use case", "Third", "Fourth", plus "Enter X", "Imagine", "So", and closing lines ("Go build something awesome"). A beat is typically 3-6 seconds and 1-3 cues. Record each beat's `[beatStart, beatEnd)`.

**Step 2 — Extract nouns as boxes.**
Every named service, component, or artifact spoken in a beat becomes a `box`: DynamoDB, Lambda, OpenSearch, Kinesis, S3, "search bar", "leaderboard". Skip abstractions that have no place in a diagram ("compliance", "heavy lifting") unless they work as a callout chip.

**Step 3 — Extract verbs as arrows.**
Phrases like "triggers", "pushes into", "feeds into", "dumps into", "connect the stream to", "saved to" become `arrow` elements between the two boxes named in that sentence. Only emit an arrow if **both** boxes exist in your scene.

**Step 4 — Extract enumerations as badges.**
"First/Second/Third/Fourth use case" becomes a `number` badge with `value` 1/2/3/4, alive for that beat only. Sequential process steps ("a user signs up, their profile is saved, the stream triggers...") can also be badged 1..N.

**Step 5 — Assign timings.**

| Element | `start` | `end` |
| --- | --- | --- |
| Box for a concept | the **start of the cue where the concept is first spoken** (optionally +0.1-0.3s so it lands with the word, not before it) | end of the last beat where it stays relevant; use the reel end for persistent architecture pieces |
| Arrow | **0.4-0.8s after both endpoint boxes have appeared**, and no earlier than the cue that states the flow | same as the later of its two boxes, or the end of that beat |
| Number badge | start of its beat | end of its beat (badges are transient) |
| Callout chip | the cue that mentions the detail | 2-5s later; chips are punchy, not permanent |
| Title box | `0` or the first cue | until the first diagram box appears, or keep it if it's the reel's header |

Rules of thumb:

- **Never** introduce an element before the narrator mentions it. Early reveals kill the payoff.
- Boxes that form the architecture should **persist** once introduced, so the diagram accumulates.
- If a beat replaces the previous topic (a new use case), end the previous beat's transient elements at the new beat's start so the frame does not get crowded.
- Round to one decimal place. Snap to cue boundaries wherever possible.

**Step 6 — Lay out on the grid.**
Pick a template from §10. Assign matrices so the visual order matches the narration order (top to bottom for pipelines). Keep 1-2 empty rows between stacked boxes for arrows.

**Step 7 — Assign tracks.**
Use the table in §7.2. Pack elements onto shared tracks when their time ranges do not overlap.

**Step 8 — Validate** with §12, then output.

---

## 10. Layout templates (copy these matrices)

### 10.1 Vertical pipeline — the default for "A flows to B flows to C"

Badge column at left, wide boxes stacked with a 2-row gap.

| Stage | Badge `matrix` | Box `matrix` |
| --- | --- | --- |
| 1 | `[0, 4, 1, 5]` | `[3, 4, 15, 6]` |
| 2 | `[0, 9, 1, 10]` | `[3, 9, 15, 11]` |
| 3 | `[0, 14, 1, 15]` | `[3, 14, 15, 16]` |
| 4 | `[0, 19, 1, 20]` | `[3, 19, 15, 21]` |
| 5 | `[0, 24, 1, 25]` | `[3, 24, 15, 26]` |

Arrows connect consecutive boxes; the 2-row gaps are where they show.

### 10.2 Hub and spoke — one source feeding many consumers

| Role | `matrix` |
| --- | --- |
| Hub (center) | `[4, 13, 13, 16]` |
| Spoke top-left | `[0, 5, 7, 7]` |
| Spoke top-right | `[10, 5, 17, 7]` |
| Spoke bottom-left | `[0, 22, 7, 24]` |
| Spoke bottom-right | `[10, 22, 17, 24]` |

Good for "the stream feeds Lambda, OpenSearch, Kinesis, and S3".

### 10.3 Two-column comparison

| Row pair | Left `matrix` | Right `matrix` |
| --- | --- | --- |
| Header | `[1, 5, 8, 7]` | `[9, 5, 16, 7]` |
| Row 1 | `[1, 9, 8, 11]` | `[9, 9, 16, 11]` |
| Row 2 | `[1, 13, 8, 15]` | `[9, 13, 16, 15]` |
| Row 3 | `[1, 17, 8, 19]` | `[9, 17, 16, 19]` |

Use `fontSize: 12` in 8-column boxes.

### 10.4 Title and callouts

| Role | `matrix` | Notes |
| --- | --- | --- |
| Headline | `[1, 3, 16, 5]` | `fontSize` 18-24, `colorTheme: "ink"` |
| Right callout chip | `[10, R, 16, R+2]` | overlaps a box; `track: 0`, `fontSize: 12` |
| Left callout chip | `[1, R, 7, R+2]` | same, mirrored |
| Bottom takeaway | `[1, 23, 16, 25]` | closing line |

---

## 11. Worked example

Subtitle excerpt (real cues):

```text
1
00:00:00,000 --> 00:00:03,000
Want your database to react
instantly to changes?

2
00:00:03,000 --> 00:00:05,000
Enter DynamoDB Streams.

3
00:00:05,000 --> 00:00:08,200
It is a time-ordered flow of every
single item-level change in your
DynamoDB table.

5
00:00:10,000 --> 00:00:13,200
First massive use case:
Event-driven serverless compute.

7
00:00:16,400 --> 00:00:20,200
The stream instantly triggers
an AWS Lambda function
```

Beat analysis:

- Cue 1 (0.0-3.0) — hook, no diagram yet: show a headline.
- Cue 2 (3.0-5.0) — introduce the subject box `DynamoDB Streams`.
- Cue 3 (5.0-8.2) — the table is named: add `DynamoDB Table` above the stream, arrow table -> stream, chip "item-level changes".
- Cue 5 (10.0-13.2) — enumeration: badge `1` plus a use-case label.
- Cue 7 (16.4-20.2) — new box `AWS Lambda`, arrow stream -> Lambda at 17.0 (0.6s after the box lands).

Resulting JSON:

```json
[
  {
    "id": "headline",
    "type": "box",
    "matrix": [1, 3, 16, 5],
    "label": "React to data changes",
    "colorTheme": "ink",
    "fontSize": 20,
    "time": { "start": 0.2, "end": 5, "track": 2 }
  },
  {
    "id": "dynamodb-table",
    "type": "box",
    "matrix": [2, 7, 15, 9],
    "label": "DynamoDB Table",
    "colorTheme": "blue",
    "time": { "start": 5.2, "end": 30, "track": 3 }
  },
  {
    "id": "streams",
    "type": "box",
    "matrix": [2, 13, 15, 15],
    "label": "DynamoDB Streams",
    "sublabel": "time-ordered change log",
    "colorTheme": "lavender",
    "time": { "start": 3.2, "end": 30, "track": 4 }
  },
  {
    "id": "table-to-streams",
    "type": "arrow",
    "sourceId": "dynamodb-table",
    "targetId": "streams",
    "variant": "solid",
    "time": { "start": 6, "end": 30, "track": 7 }
  },
  {
    "id": "chip-item-level",
    "type": "box",
    "matrix": [10, 10, 16, 12],
    "label": "every write",
    "colorTheme": "yellow",
    "fontSize": 12,
    "time": { "start": 6.4, "end": 10, "track": 0 }
  },
  {
    "id": "step-1",
    "type": "number",
    "size": 6,
    "matrix": [0, 19, 1, 20],
    "value": 1,
    "colorTheme": "ink",
    "time": { "start": 10.1, "end": 22.5, "track": 1 }
  },
  {
    "id": "lambda",
    "type": "box",
    "matrix": [3, 19, 15, 21],
    "label": "AWS Lambda",
    "sublabel": "event-driven compute",
    "colorTheme": "green",
    "time": { "start": 16.5, "end": 30, "track": 5 }
  },
  {
    "id": "streams-to-lambda",
    "type": "arrow",
    "sourceId": "streams",
    "targetId": "lambda",
    "variant": "solid",
    "time": { "start": 17.1, "end": 30, "track": 8 }
  }
]
```

Notice: the headline retires exactly when the subject box arrives; the arrow trails its boxes by 0.6-0.8s; the chip is transient; the badge spans its whole use-case beat; persistent architecture runs to the reel end.

---

## 12. Validation checklist

Check every item before you answer.

**Structure**

- [ ] Output is a bare JSON array in one ```json block.
- [ ] Valid JSON: no comments, no trailing commas, all keys quoted.
- [ ] Every element has `id`, `type`, `time`.
- [ ] All `id` values are unique.
- [ ] `type` is only `box`, `number`, or `arrow`.

**Geometry**

- [ ] Every `box` has `matrix` with exactly 4 integers; every `number` has 2 or 4 integers.
- [ ] No `arrow` has a `matrix`.
- [ ] All columns in `0..17`, all rows in `0..31`.
- [ ] `X1 <= X2` and `Y1 <= Y2` for every matrix.
- [ ] No `x`, `y`, `width`, or `height` keys. `size` only on `number` (diameter % of canvas width, prefer 6).
- [ ] Badges use square cell spans.
- [ ] Content sits in rows 3-26; nothing important under the right rail (cols 16-17, rows 14-25).
- [ ] Stacked boxes that an arrow connects have a 1-2 row gap between them.

**Content**

- [ ] Every `box` has a `label`; labels are 2-4 words and will not be truncated at their width.
- [ ] Every `number` has a numeric `value`.
- [ ] `fontSize`, if present, is 10-48.
- [ ] Every `colorTheme` is from the §6 list (boxes and badges only).

**Arrows**

- [ ] Every `sourceId` and `targetId` matches an existing **box** id (never a badge id).
- [ ] `variant`, if present, is `"solid"` or `"dashed"`.
- [ ] Each arrow starts after both of its boxes have appeared.

**Timing**

- [ ] Every element's `start` matches the cue where the concept is first spoken.
- [ ] Every span gives at least ~0.8s of screen time (1.5s+ for text).
- [ ] `track` is an integer in `0..9`.
- [ ] Reveals are staggered by 0.3s or more; nothing pops in all at once.
- [ ] The latest `time.end` matches the last subtitle cue (that is the reel length).

---

## 13. Common mistakes

| Mistake | Why it breaks |
| --- | --- |
| Emitting `x`/`y`/`width`/`height` | Old schema. Boxes now require `matrix`; the element is invalid and the paste is rejected. |
| Non-integer or out-of-range matrix | Parser rejects the whole array. |
| Inverted matrix (`[15, 8, 2, 6]`) | Rejected; the app does not normalize it. |
| Arrow pointing at a `number` id | Arrow silently renders nothing. |
| Boxes flush against each other | The connecting arrow is hidden behind the boxes. |
| Long sentences in `label` | Truncated with an ellipsis in the default skin. |
| Everything starting at `0` | No reveal; the whole diagram appears at once and the reel looks static. |
| `track: 12` | Draws on canvas but has no timeline row, so it cannot be edited. |
| Wrapping the array in an object | `JSON must be an array of elements.` |
| Compressing a long script into 30s | Playback and export now follow the latest `time.end`; keep real subtitle seconds. |

---

## 14. How the user applies your output

1. Open `http://localhost:5174/reel-animations`.
2. In the right inspector, click the **JSON** tab.
3. Select all existing JSON, paste the new array over it.
4. Press **Cmd/Ctrl+Enter** (or click outside the textarea) to apply.
5. Press **Space** to play.

If the JSON is invalid the inspector shows a message such as `Element 3 is not a valid box.` and the canvas keeps the previous scene. Fix that index and re-apply.
