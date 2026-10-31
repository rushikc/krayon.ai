# rushk: visual style

How a rushk reel looks and how its visuals are built. For narration style see [`script-style.md`](./script-style.md). Numbers are measured from the Airbnb and Uber reference reels; see [`tokens.json`](./tokens.json).

## 1. Principle

"Whiteboard in the dark." A calm, static black frame holds one bright white card. All teaching happens on that card. Visuals appear only when the voiceover says the matching word, and the card is cleared when a concept is finished. Nothing moves except elements appearing.

## 2. Frame

- Format: 9:16 portrait (1080 x 1920 or any 9:16 size, such as 1512 x 2688). No landscape.
- Background: pure black `#000000` with a faint, thin grey perspective grid (a dark "floor" grid, low contrast). The grid is a background layer behind everything and never changes.
- Camera: fully static. No zoom, pan, shake or Ken Burns.
- No captions or subtitles burned into the video. No talking head. No watermarks.

## 3. Layout (percent of frame)

| Zone | Position | Notes |
| --- | --- | --- |
| Title | Top centre, about 8% to 15% of frame height | Two lines, centred. Line 1 is the company or topic ("Uber", "Airbnb"), line 2 is the subject ("System Design", "Server Driven Auth Flows"). The title stays fixed for the whole reel, except that it can change text between sections (Airbnb changes "Server Driven Auth Flows" to "Identify-Then-Challenge" and back). |
| Card / content area | Centre, about 8% to 92% of frame width (about 82% to 84% wide) | Vertical extent follows the diagram: from about 13% to 17% down to about 75% to 83% down. The card is centred vertically in the space below the title. |
| Caption line under the card | Directly under the card, white bold sans text | Used for one-line takeaways such as "Based on Region, Device & History metadata". |
| Bottom | Empty | Kept clear (platform UI sits here on reels). |

Measured on the Uber reel (1512 x 2688): title text spans y 208 to 413, card spans x 123 to 1390 and y 469 to 2218. On the Airbnb reel (1080 x 1920): card spans x 95 to 984 for the diagram frame at 30 s.

## 4. The white card (Excalidraw export)

- The card is the Excalidraw drawing exported as an image with a **white background**, cropped close to the drawing, and placed centred at about 82% to 84% of frame width. There is no separate "UI card" drawn in the editor.
- Corners are square to very slightly rounded (a couple of px at 1080 wide). They come from the exported image, not from a styled container (Airbnb is square; Uber looks slightly rounded **(to confirm)**).
- Each diagram state is its own image. A build-up such as Redis -> DynamoDB -> "TTL" badge -> red X is a series of exports that each add one thing, swapped in on the keyword. **(inferred from repeated near-identical frames)**
- Card height varies with the drawing. Cards are not forced to a fixed height, but are always centred horizontally and kept inside the width band above.

## 5. Diagram language (Excalidraw)

Drawn on the Excalidraw website with its default sketch look: rough strokes, hand-drawn font (Excalidraw's default, previously Virgil, now Excalifont), no theme change.

| Element | Style |
| --- | --- |
| Normal node (service, store, step) | Rounded rectangle, thin dark outline (black or near-black), white fill, hand-font label in black or dark blue |
| Key node (client, hero concept) | Same shape with a thin **blue** outline (about `#1971c2` family) so it reads as the actor |
| Container / group (e.g. "Redis" holding "Passive Expiration" and "DriverId - 165") | Larger blue-outlined rounded rectangle containing smaller blue-outlined boxes; container title in red hand text on top |
| Decision / unresolved UI state | Diamond ("UI Screen"), which is replaced by a rectangle ("OTP Screen") once resolved |
| Circle | Used for infra nodes like "Redis" in the Uber reel, hand-drawn blue outline |
| Arrow | Thin, single stroke, hand-drawn, simple open V head, straight down or across. Black in Airbnb, blue in Uber. One arrow per relationship. |
| Annotation text (data, inputs, constraints) | Red hand-font text placed beside a node: `Email`, `Policy Engine`, `{ challenge: "otp" }`, `TTL - 10 sec` |
| Success marker | Green check |
| Failure marker | Large red hand-drawn **X** over the wrong choice |
| Density | 3 to 6 shapes per diagram state. Many diagrams are a single vertical flow (top to bottom). |

Colour semantics: blue ink = structure and the main actors, black = neutral machinery, red = data, inputs, limits and warnings, green = results and approval.

## 6. Text (VN editor)

Text is set in the VN editor, not Excalidraw. Exact font names are **(to confirm)** from the VN project; the look is:

| Text role | Look |
| --- | --- |
| Title | Bold clean sans-serif (Inter / SF-like), centred, two lines, about 6% of frame height per line. White (Airbnb) or neon green (Uber; Airbnb on the results slide). |
| Section title swaps | Same style as the title, text changes at section boundaries (a slide transition carries the change). |
| Under-card caption | White, bold-ish sans, left or centre aligned directly under the card, prefixed with `>` (for example `> Auth flows hardcoded in client`). |
| Result bullets | Large white bold sans lines directly on the black background (no card), each prefixed with `>`; as the narrator says the result it turns into a green check box emoji style bullet (checkmark in a green square). Measured results slide: three lines, about 3% of frame height each, vertically spaced evenly. |
| Badge / callout | Solid blue rectangle (about `#0A62F0`), slightly rounded corners (about 4 to 5 px at 1080), no border, white bold sans text, one or two lines, centred. Sits on the card over or under the node it comments on. Examples: `TTL - Time To Live`, `Locked for hours`, `Stale Reads`, `Lazy Eviction / Post expiry read query`, `Upto 48hrs delay is okay`. |
| Checklist item | Green filled square with white check followed by hand-sized sans text (Uber: `Clear Session Logs`, `Old Receipt Archival`) |
| Name card (outro) | White card (Airbnb) or dark card with rounded blue outline (Uber) containing `Rushi` in large hand font (green in Uber), and `Senior SDE @Warner Bros` in blue hand font |

## 7. Screenshots as proof

Real screenshots are dropped in as proof beats and are treated like a card:

- Airbnb: the Airbnb engineering article card (tag line, headline, date) at the start, then again scaled down beside the title.
- Uber: the YouTube thumbnail of the video being corrected, then a hand-drawn schema, then the AWS DynamoDB docs page (dark theme, with the "Important" callout visible and readable).
- Placement: centred in the card area, same width band as a diagram card (about 82% to 84%). Crop to the one paragraph that matters. Dark screenshots are allowed (they sit on the white card area or straight on black).

## 8. Animation

- **Entry:** every element hard-pops in, instantly or with a very small scale overshoot (a standard VN pop-in preset **(inferred)**). No stroke-drawing animation, no typewriter, no glide.
- **Sync:** an element appears on the exact word it illustrates, within a fraction of a second. If the sentence names three things, they appear on those three words.
- **Pace:** a new visual change roughly every 1.5 to 2.5 seconds.
- **State change in place:** small edits happen in place without a transition: a label changes (`Email` -> `OTP`), a diamond becomes a rectangle, a bullet turns into a green check, a red X lands on a node.
- **Clear / transition between sections:**
  - Airbnb: the whole slide (title + card) slides out to the left and the next slide comes in from the right, about 0.3 s.
  - Uber: a hard cut to a blank card (no slide).
  - Pick one per reel and keep it consistent.
- **Section length:** each section (one card state set) lasts roughly 10 to 15 seconds before the card clears.
- **Density rule:** at most 5 to 6 shapes or text blocks on the card at once (up to 10 to 12 total pieces including the title and caption). If more is needed, clear and start a new card instead of shrinking old content.
- **Never:** reuse the old diagram by shrinking or moving it to make room, add a second diagram beside it, or animate the camera.

## 9. Audio (as it affects the visuals)

- Voiceover only. No music, no sound effects (no whooshes or pops), so the visual timing alone carries the rhythm.
- Cuts and pops are placed on voice onsets, so keep the voiceover clean with no long silences.

## 10. Reel anatomy template (visual)

| Time (approx.) | Visual beat |
| --- | --- |
| 0 to 4 s | Hook visual: an article/video screenshot card plus the company mark or a bold line. |
| 4 to 14 s | Title shown. First diagram: the old or wrong way, with 1 to 2 caption lines under the card. |
| 14 to 40 s | New card per concept. Boxes, arrows and red annotations pop on keywords. One blue badge per key takeaway. |
| Proof beat (any time) | Real screenshot (docs or article). |
| Results / correction | Clear the card. Either bullets directly on black with green checks (Airbnb) or a checklist on the card (Uber). |
| Last 3 to 4 s | Name card (`Rushi`, `Senior SDE @Warner Bros`). |

## 11. Do and don't

Do:
- Keep the title fixed and legible, in the top band.
- Keep the card centred, with the same width band.
- Use red only for data, limits and errors, green only for positive results, blue for structure and badges.
- Let every element be caused by a spoken word.

Don't:
- Add music, captions, sound effects, avatars or talking heads.
- Fill the card past about 6 elements.
- Draw on the black area (only titles, captions and result bullets live there).
- Use gradients, shadows, glows or 3D. The look is flat and hand-drawn.

## 12. Mapping to Krayon (for later work)

Krayon already has boxes, numbers and arrows timed on an 18 x 32 grid, and Calidraw skins that are close to the hand-drawn look. Gaps against rushk are:

- fixed top title with change-on-section support;
- dark grid frame around a white content card;
- pill badge callout element (blue fill, white text);
- red handwritten annotation text element;
- image / screenshot element;
- check-list element with green checks;
- red X marker element;
- card clear transitions (slide-left and hard cut);
- shape morph (diamond to rectangle);
- name card for the outro.

A `rushk` canvas skin would define the frame, title, card and element paints from `tokens.json`.
