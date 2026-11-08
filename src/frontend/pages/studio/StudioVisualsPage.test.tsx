import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { StudioClip, StudioProject } from "@/lib/api/studio-client";

const getProject = vi.fn();
const updateCanvasDraft = vi.fn();

vi.mock("@/lib/api/studio-client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api/studio-client")>("@/lib/api/studio-client");
  return {
    ...actual,
    getProject: (...args: unknown[]) => getProject(...args),
    updateCanvasDraft: (...args: unknown[]) => updateCanvasDraft(...args),
    cutAudioUrl: (slug: string, revision?: number) => `/cut/${slug}/${revision ?? 0}`,
  };
});

vi.mock("@/components/ui/scroll-area", () => ({
  ScrollArea: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ScrollBar: () => null,
}));

vi.mock("@/lib/api/reel-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/reel-client")>();
  return {
    ...actual,
    health: vi.fn().mockResolvedValue({ ok: true, service: "reel-backend" }),
    listJobs: vi.fn().mockResolvedValue([]),
    listDiagrams: vi.fn().mockResolvedValue([]),
    getDiagramMeta: vi.fn(),
    subscribeToJob: vi.fn(() => () => undefined),
  };
});

function clip(partial: Partial<StudioClip> & Pick<StudioClip, "id" | "status">): StudioClip {
  return {
    parentIds: [],
    sourceStart: 0,
    sourceEnd: 1,
    ranges: [{ sourceStart: 0, sourceEnd: 1 }],
    duration: 1,
    text: "hello",
    words: [],
    groupId: "g-0001",
    label: "none",
    score: 1,
    reasons: [],
    decidedBy: "algorithm",
    statusReason: "",
    statusAt: "",
    note: "",
    llm: {},
    ...partial,
  };
}

function project(): StudioProject {
  const selected = clip({ id: "c-0001", status: "selected" });
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
    clips: [selected],
    groups: [],
    order: ["c-0001"],
    canvasDraft: { version: 1, elements: [] },
    history: [],
  };
}

describe("StudioVisualsPage", () => {
  beforeEach(() => {
    getProject.mockReset().mockResolvedValue(project());
    updateCanvasDraft.mockReset().mockResolvedValue({ canvasDraft: { version: 2, reelId: "" } });
  });

  it("returns to clips when 1 Clips is clicked", async () => {
    const { StudioVisualsPage } = await import("@/pages/studio/StudioVisualsPage");
    render(
      <MemoryRouter initialEntries={["/studio/real/video"]}>
        <Routes>
          <Route path="/studio/:slug" element={<div>audio workspace</div>} />
          <Route path="/studio/:slug/video" element={<StudioVisualsPage />} />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByRole("button", { name: "1 Clips" })).toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: "1 Clips" }));
    expect(await screen.findByText("audio workspace")).toBeInTheDocument();
  });
});
