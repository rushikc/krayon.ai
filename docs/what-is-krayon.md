# What is Krayon?

Krayon is a local app for long talking-head recordings. Nothing is uploaded. The home page has three tiles.

**Audio analysis** opens a folder of videos, transcribes one file, drops silence, and groups similar lines so you can compare takes. Preview in the editor is the extracted clip audio.

**Reel animations** is a 9:16 teaching canvas. Boxes, numbers, and arrows appear and leave with the narration. You paste scene JSON or generate it from a script in Chat. The Gemini key stays in the browser cookie `krayon_gemini_api_key` and is never written to disk.

**Studio** takes one recording, an optional script, and a cut list. Without a script it groups retakes from the transcript. With a script it matches each line to a take. You keep the takes you want and render one video.

The three workspaces do not feed each other. Audio analysis does not draw the canvas. Studio does not animate the canvas. The canvas export does not cut the talking-head file.

For how the code is put together, see [ABOUT.MD](../ABOUT.MD). Studio details are in [studio.md](studio.md). The reel service is in [reel-pipeline.md](reel-pipeline.md).
