# rushk design system

`rushk` is the visual and spoken style of Rushi's tech-education reels: a voiceover over a dark frame, with a white whiteboard card where hand-drawn architecture diagrams build up one piece at a time.

This folder documents the style so it can be reproduced by hand (Excalidraw + VN editor) and later by Krayon (reel JSON generator, canvas skin, review prompts).

## Files

| File | What it covers |
| --- | --- |
| [`visual-style.md`](./visual-style.md) | How the reel looks and how the visuals are made: frame, title, white card, diagram style, text, badges, animation, transitions, timing. |
| [`script-style.md`](./script-style.md) | How the narration is written: formula, section lengths, voice, phrasing, CTA. Kept separate on purpose. |
| [`tokens.json`](./tokens.json) | Colours, sizes and timings as machine-readable values (measured from the references; see notes inside). |
| [`assets/`](./assets/) | Reference contact sheets and detail frames from the two source reels. |

Visual style and script style are independent: any script can be dressed in the visual style and vice versa.

## Source reels this was derived from

| Reel | File (in `~/Documents/VN/grok/`) | Length | Frame |
| --- | --- | --- | --- |
| Airbnb: server-driven auth flows | `airbnb-auth.mp4` | 54 s | 1080 x 1920 (9:16) |
| Uber: DynamoDB TTL vs Redis | `uber-system-design.mp4` | 93 s | 1512 x 2688 (9:16) |

Reference frames: `assets/airbnb-auth-sheet.jpg`, `assets/uber-system-design-sheet.jpg` (one frame every 4 s) and `assets/detail-frames.jpg` (four full-size frames showing the title, card, badge and screenshot treatment).

## How a reel is produced (workflow)

1. **Script** is written and voiced first (see `script-style.md`). The voiceover is the timeline: everything else is cut to it.
2. **Diagrams** are drawn on the Excalidraw website, one state at a time, with the default hand-drawn look (sketchy strokes, hand font). Each state is exported as an image with a white background, cropped tight to the drawing.
3. **Assembly** happens in the VN editor on a 9:16 project: black grid background, fixed title text at the top, the Excalidraw exports layered as the card, text and bullet layers, badge layers, then the pop-in animation and the slide transition between sections (see `visual-style.md`).
4. Export as MP4, 9:16. No background music, no sound effects, no captions, no talking head.

## Provenance and confidence

- Diagrams come from Excalidraw and the text fonts and text styling come from VN editor text presets (confirmed by Rushi).
- Layout percentages and colours were measured from frames of the two reels.
- Narration, timings and animation behaviour were read from a video-analysis pass plus keyframes. Anything marked **(inferred)** or **(to confirm)** in these docs was not directly confirmed.
- Exact VN font names were not identified. They are marked **(to confirm)** and should be filled in from the VN project files.
