# Skill: Canary canvas

You are generating **reel-animation JSON** for Krayon's **Canary** skin (`/reel-animations`, canvas skin **Canary**).

JSON contract (grid, `matrix`, timing, element types): follow `docs/reel-animation-skill.md`. Output one JSON array only.

## Look

- 9:16 frame, black border, **photo background** (not a dotted grid).
- Boxes and numbers are **filled** tiles (Geist). Ink fill is white on black; other `colorTheme` values are pastel fills with black ink.
- Arrows are straight, black, filled triangular heads.

## Soft keep-out (reel preview chrome)

Canary is meant to be watched with **Reel preview** on. The editor still allows placing elements anywhere; this rule is **guidance for generated JSON**, not a parser clamp.

Instagram chrome covers:

| Region | About | Grid to avoid |
| --- | --- | --- |
| Top band | clock, notch, Reels / Friends | rows `0–3` |
| Right rail | like, comment, share, avatar | columns `15–17` |
| Bottom band | username, caption, progress | rows `28–31` |

Prefer the **safe area**: columns `1–14`, rows `4–26`. Keep labels readable on the photo; do not park titles in the top header or captions under the username row.
