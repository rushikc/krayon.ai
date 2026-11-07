import { render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ReelWorkspace } from "@/components/reel/ReelWorkspace";
import { useCanvasStore } from "@/stores/canvas-store";

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
    listDiagrams: vi.fn().mockResolvedValue([
      {
        reelArg: "_examples/uber-ttl",
        title: "Uber System Design",
        hasStatus: true,
        ok: true,
        builtAt: "2026-01-01T00:00:00Z",
        stepCount: 5,
      },
    ]),
    getDiagramMeta: vi.fn(),
    subscribeToJob: vi.fn(() => () => undefined),
  };
});

import * as reelClient from "@/lib/api/reel-client";

const uberMeta = {
  reelArg: "_examples/uber-ttl",
  title: "Uber System Design",
  cards: [
    {
      id: "redis-dynamo",
      caption: "Not a precise timer",
      steps: [
        { step: 1, at: 4.2 },
        { step: 2, at: 5.0 },
        { step: 3, at: 6.1 },
        { step: 4, at: 7.0 },
        { step: 5, at: 8.4 },
      ],
    },
  ],
  status: { ok: true, builtAt: "2026-01-01T00:00:00Z", issues: [] },
};

describe("ReelWorkspace diagrams", () => {
  beforeEach(() => {
    useCanvasStore.getState().reset();
    vi.mocked(reelClient.getDiagramMeta).mockReset();
  });

  it("loads uber-ttl steps onto one timeline row and shows step 3 at t=6.5", async () => {
    vi.mocked(reelClient.getDiagramMeta).mockResolvedValue(uberMeta);
    render(
      <MemoryRouter>
        <ReelWorkspace
          audio={{ kind: "none" }}
          diagramReelId="_examples/uber-ttl"
        />
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(document.querySelectorAll('[data-segment-type="diagram"]')).toHaveLength(5);
    });
    expect(screen.getByText("Track 1")).toBeInTheDocument();
    expect(screen.queryByText("Track 2")).not.toBeInTheDocument();
    useCanvasStore.getState().setCurrentTime(6.5);
    await waitFor(() => {
      expect(screen.getByTestId("rushk-png")).toHaveAttribute(
        "src",
        expect.stringContaining("step=3"),
      );
    });
    expect(screen.getByTestId("rushk-title")).toHaveTextContent("Uber System Design");
    expect(screen.getByTestId("rushk-caption")).toHaveTextContent("Not a precise timer");
  });

  it("shows a CLI hint for an unbuilt reel and does not seed boxes", async () => {
    vi.mocked(reelClient.getDiagramMeta).mockResolvedValue({
      ...uberMeta,
      status: { ok: false, builtAt: null, issues: [{ message: "CHROME_NOT_FOUND" }] },
    });
    render(
      <MemoryRouter>
        <ReelWorkspace audio={{ kind: "none" }} diagramReelId="_examples/uber-ttl" />
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(screen.getByTestId("diagram-unbuilt")).toHaveTextContent("npm run diagram -- build _examples/uber-ttl");
    });
    expect(screen.getByText("CHROME_NOT_FOUND")).toBeInTheDocument();
    expect(useCanvasStore.getState().elements.some((el) => el.type === "box")).toBe(false);
    expect(screen.queryByTestId("rushk-png")).not.toBeInTheDocument();
  });
});
