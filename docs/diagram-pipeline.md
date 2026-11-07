# Excalidraw diagram pipeline

Deterministic file-drop pipeline in [`src/reel-backend/src/diagram/`](../src/reel-backend/src/diagram/). An external author writes skeleton JSON; Krayon validates, lays out, writes `.excalidraw` states, and renders PNGs. **No LLM calls, no HTTP routes, no API keys.** The existing Gemini generate/review/fix flow is unchanged.

## Architecture

```text
diagram.skeleton.json
        │
        ▼
   zod + semantic validate
        │
        ▼
   elkjs layered layout (DOWN / RIGHT, orthogonal)
        │
        ▼
   convertToExcalidrawElements  →  states/<card>/step-NN.excalidraw
        │
        ▼
   headless Chrome + exportToBlob  →  review/<card>/step-NN.png
        │
        ▼
   status.json  (+ status.prev.json)
```

Package: `@krayon/reel-backend`. Diagrams root: repo `diagrams/` (override `KRAYON_DIAGRAMS_DIR`). Chrome: `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome` (override `KRAYON_CHROME_PATH` or `[diagram].chrome_path` in `krayon-reel.toml`).

## Folder contract

Per reel (`diagrams/<reel-id>/`, reel-id may be `_examples/uber-ttl`):

| Path | Who writes it |
| --- | --- |
| `script.md` | author (tracked) |
| `diagram.skeleton.json` | author (tracked) |
| `script.words.json` | optional, not generated here |
| `states/<card-id>/step-NN.excalidraw` | pipeline (gitignored) |
| `review/<card-id>/step-NN.png` | pipeline (gitignored) |
| `status.json` / `status.prev.json` | pipeline (gitignored) |

Tracked examples live in `diagrams/_examples/`. Generated `states/`, `review/`, and status files are gitignored.

Each `.excalidraw` file is valid Excalidraw (`type: "excalidraw"`, `version: 2`, white `viewBackgroundColor`). Reveal metadata is `customData.rushk = { cardId, step, at }` on every element.

PNGs: white background, tight crop, 24px padding, scale 2. Max expected width `880*2 + 96`.

## CLI

From `src/reel-backend`:

```bash
npm run diagram -- validate <reel-id>
npm run diagram -- build <reel-id>
npm run diagram -- list
```

No prompts. Human logs on stderr; one JSON line on stdout `{ ok, reelId, issues, statusPath }`.

| Exit | When |
| --- | --- |
| 0 | `ok` |
| 2 | validation / layout errors |
| 3 | environment (`CHROME_NOT_FOUND`) |

`build` = validate → layout → excalidraw → render → `status.json`.

## How to add a shape

1. Add the name to `SHAPES` in [`src/reel-backend/src/diagram/skeleton.ts`](../src/reel-backend/src/diagram/skeleton.ts).
2. Size it in `measureNode` ([`layout.ts`](../src/reel-backend/src/diagram/layout.ts)).
3. Map it in `nodeType` / roundness in [`excalidraw.ts`](../src/reel-backend/src/diagram/excalidraw.ts) using Excalidraw skeleton types (`rectangle`, `ellipse`, `diamond`).
4. Document it in [`docs/rushk/diagram-skeleton.md`](./rushk/diagram-skeleton.md).

Colours come from [`docs/rushk/tokens.json`](./rushk/tokens.json). Font family id is read from `@excalidraw/excalidraw` `FONT_FAMILY` at runtime (hand-drawn / Excalifont).

## Known limits

- Title and caption are stored, not painted into the PNG (VN layer later).
- Badges use the Excalidraw hand font, not the VN bold sans from the reels.
- No timeline loader, no canvas UI, no Gemini in this flow.
- Fonts are self-hosted from the npm package (`EXCALIDRAW_ASSET_PATH`); the render page must not hit the Excalidraw CDN.
- Layout is ELK layered only. Nested containers / cylinders are out of scope for v1.
