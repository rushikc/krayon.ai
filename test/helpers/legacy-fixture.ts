import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { ensureFixtureMedia, FIXTURE_DURATION_S, FIXTURE_WORDS, renderWavBytes } from "./fixture-project";

export function fixtureMediaId(sourcePath: string): string {
  return createHash("sha256").update(fs.realpathSync(sourcePath)).digest("hex").slice(0, 16);
}

export function seedLegacyEditor(folder: string, videoName = "source.mp4"): { videoPath: string; mediaId: string } {
  const dest = path.join(folder, videoName);
  const media = ensureFixtureMedia();
  fs.copyFileSync(media.mp4, dest);
  const videoPath = fs.realpathSync(dest);
  const wav = renderWavBytes();
  const mediaId = fixtureMediaId(videoPath);
  const versionId = "e2e-legacy-seed";
  const versionDir = path.join(folder, ".krayon", "state", mediaId, "versions", versionId);
  const audioDir = path.join(versionDir, "audio");
  fs.mkdirSync(audioDir, { recursive: true });
  const clips = [
    { id: "source_seg_000", index: 0, sourceStart: 1.03, sourceEnd: 4.76, duration: 3.73, text: "alpha beta gamma delta is the answer", groupId: "source_g000", words: FIXTURE_WORDS.slice(0, 7), falseStart: false, ranges: [{ sourceStart: 1.03, sourceEnd: 4.76 }] },
    { id: "source_seg_001", index: 1, sourceStart: 6.23, sourceEnd: 9.96, duration: 3.73, text: "alpha beta gamma delta is the answer", groupId: "source_g000", words: FIXTURE_WORDS.slice(7, 14), falseStart: false, ranges: [{ sourceStart: 6.23, sourceEnd: 9.96 }] },
    { id: "source_seg_002", index: 2, sourceStart: 11.43, sourceEnd: 13.43, duration: 2, text: "alpha beta gamma delta", groupId: "source_g000", words: FIXTURE_WORDS.slice(14, 18), falseStart: true, ranges: [{ sourceStart: 11.43, sourceEnd: 13.43 }] },
    { id: "source_seg_003", index: 3, sourceStart: 13.73, sourceEnd: 17.21, duration: 3.48, text: "alpha beta gamma delta is the answer", groupId: "source_g000", words: FIXTURE_WORDS.slice(18, 25), falseStart: false, ranges: [{ sourceStart: 13.73, sourceEnd: 17.21 }] },
    { id: "source_seg_004", index: 4, sourceStart: 18.73, sourceEnd: 20.84, duration: 2.11, text: "epsilon zeta eta", groupId: "source_g003", words: FIXTURE_WORDS.slice(25, 28), falseStart: false, ranges: [{ sourceStart: 18.73, sourceEnd: 20.84 }] },
    { id: "source_seg_005", index: 5, sourceStart: 23.53, sourceEnd: 26.36, duration: 2.83, text: "theta iota kappa", groupId: "source_g004", words: FIXTURE_WORDS.slice(28), falseStart: false, ranges: [{ sourceStart: 23.53, sourceEnd: 26.36 }] },
  ];
  const groups = [
    { id: "source_g000", label: "alpha beta gamma delta is the answer", clipIds: ["source_seg_000", "source_seg_001", "source_seg_002", "source_seg_003"] },
    { id: "source_g003", label: "epsilon zeta eta", clipIds: ["source_seg_004"] },
    { id: "source_g004", label: "theta iota kappa", clipIds: ["source_seg_005"] },
  ];
  const transcript = FIXTURE_WORDS.map((word) => word.text).join(" ");
  const manifest = {
    versionId,
    createdAt: "2026-01-01T00:00:00.000Z",
    mediaId,
    sourcePath: videoPath,
    options: { silenceThreshold: 0.4, pad: 0.05, language: "en", threads: 4 },
    similarityThreshold: 0.7,
    analysis: {
      sourceDuration: FIXTURE_DURATION_S,
      fps: 1,
      segments: clips.map((clip) => ({ sourceStart: clip.sourceStart, sourceEnd: clip.sourceEnd })),
      removedSeconds: 21.82,
      words: FIXTURE_WORDS,
    },
    clips,
    groups,
    clipCount: clips.length,
    removedSeconds: 21.82,
    processingDurationSeconds: 0.1,
    audioReady: true,
    transcript,
  };
  fs.writeFileSync(path.join(versionDir, "manifest.json"), JSON.stringify(manifest, null, 2));
  fs.writeFileSync(path.join(versionDir, "transcript.txt"), `${transcript}\n`);
  for (const clip of clips) {
    fs.writeFileSync(path.join(audioDir, `${clip.id}.wav`), wav);
  }
  fs.writeFileSync(
    path.join(folder, ".krayon", "state", mediaId, "index.json"),
    JSON.stringify({
      mediaId,
      sourcePath: videoPath,
      activeVersionId: versionId,
      versions: [
        {
          versionId,
          createdAt: manifest.createdAt,
          label: "Run 1 · seeded",
          clipCount: clips.length,
          removedSeconds: 21.82,
          options: manifest.options,
          runNumber: 1,
        },
      ],
    }),
  );
  return { videoPath, mediaId };
}
