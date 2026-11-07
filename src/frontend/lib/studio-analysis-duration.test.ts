import { describe, expect, it } from "vitest";
import type { StudioProject } from "@/lib/api/studio-client";
import { resolveAnalysisDurationSeconds } from "@/lib/studio-analysis-duration";

function project(partial: Partial<StudioProject> = {}): StudioProject {
  return {
    meta: {
      slug: "demo",
      title: "demo",
      sourcePath: "/tmp/video.mp4",
      revision: 1,
      status: "ready",
      statusMessage: "ok",
      ...partial.meta,
    },
    revision: 1,
    status: "ready",
    clips: [],
    groups: [],
    order: [],
    history: [],
    ...partial,
  };
}

describe("resolveAnalysisDurationSeconds", () => {
  it("prefers saved duration on meta", () => {
    expect(
      resolveAnalysisDurationSeconds(
        project({
          hasTranscript: true,
          meta: { analysisDurationSeconds: 754 },
        }),
      ),
    ).toBe(754);
  });

  it("derives duration from analysisStartedAt and the latest analyze history entry", () => {
    expect(
      resolveAnalysisDurationSeconds(
        project({
          hasTranscript: true,
          meta: { analysisStartedAt: "2026-11-01T14:15:39.885Z" },
          history: [
            {
              revision: 1,
              actor: "human",
              label: "analyze",
              summary: "Analyzed 2 clips",
              at: "2026-11-01T14:28:14.584Z",
              current: true,
            },
          ],
        }),
      ),
    ).toBe(755);
  });
});
