import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { StudioClip, StudioProject } from "@/lib/api/studio-client";

const applyOps = vi.fn();
const getClipPeaks = vi.fn();
const getProject = vi.fn();

vi.mock("@/lib/api/studio-client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api/studio-client")>("@/lib/api/studio-client");
  return {
    ...actual,
    applyOps: (...args: unknown[]) => applyOps(...args),
    getClipPeaks: (...args: unknown[]) => getClipPeaks(...args),
    getProject: (...args: unknown[]) => getProject(...args),
    undo: vi.fn(async () => ({ revision: 2 })),
    redo: vi.fn(async () => ({ revision: 3 })),
    eventsUrl: () => "/events",
    cutAudioUrl: () => "/cut.wav",
  };
});

function clip(partial: Partial<StudioClip> & Pick<StudioClip, "id" | "status">): StudioClip {
  return {
    parentIds: [],
    sourceStart: 0,
    sourceEnd: 2,
    ranges: [{ sourceStart: 0, sourceEnd: 2 }],
    duration: 2,
    text: "hello world",
    words: [{ text: "hello", start: 0.1, end: 0.4 }],
    groupId: "g-0001",
    label: "none",
    score: 1,
    reasons: [],
    decidedBy: "algorithm",
    statusReason: "",
    statusAt: "",
    note: "",
    llm: {},
    silenceBefore: 0,
    silenceAfter: 0,
    ...partial,
  };
}

function project(clips: StudioClip[]): StudioProject {
  return {
    meta: {
      slug: "real",
      title: "Real",
      sourcePath: "/tmp/talk.mp4",
      revision: 1,
      status: "ready",
      statusMessage: "ready",
    },
    revision: 1,
    status: "ready",
    hasTranscript: true,
    clips,
    groups: [{ id: "g-0001", label: "line", clipIds: clips.map((item) => item.id), recommendedClipId: clips[0]?.id ?? null }],
    order: clips.filter((item) => item.status === "selected").map((item) => item.id),
    history: [],
  };
}

class FakeEventSource {
  onmessage: ((event: MessageEvent) => void) | null = null;
  close() {}
}

vi.stubGlobal("EventSource", FakeEventSource);

describe("StudioEditPage", () => {
  beforeEach(() => {
    applyOps.mockReset().mockResolvedValue({ revision: 2, summary: "ok", order: ["c-0001"] });
    getClipPeaks.mockReset().mockResolvedValue({ duration: 2, peaks: Array.from({ length: 16 }, () => 0.2) });
    getProject.mockReset().mockResolvedValue(
      project([
        clip({ id: "c-0001", status: "selected", text: "kept take" }),
        clip({ id: "c-0002", status: "rejected", text: "skip this", sourceStart: 3, sourceEnd: 5 }),
      ]),
    );
  });

  it("shows the concatenated waveform, accept, and show-all toggle", async () => {
    const { StudioEditPage } = await import("@/pages/studio/StudioEditPage");
    render(
      <MemoryRouter initialEntries={["/studio/real/edit"]}>
        <Routes>
          <Route path="/studio/:slug/edit" element={<StudioEditPage />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByTestId("studio-edit-page")).toBeInTheDocument();
    expect(screen.getByTestId("studio-edit-waveform")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show all segments" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Accept" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "1 Clips" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "2 Edit" })).toBeInTheDocument();
    expect(screen.getByTestId("edit-transcript")).toHaveTextContent("kept take");
    await userEvent.click(screen.getByRole("button", { name: "Show all segments" }));
    expect(screen.getByRole("button", { name: "Show all segments" })).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(screen.getByRole("button", { name: "Accept" }));
    await waitFor(() => expect(applyOps).toHaveBeenCalled());
    expect(applyOps.mock.calls[0]?.[2]).toEqual([expect.objectContaining({ op: "select", clipId: "c-0001" })]);
  });
});
