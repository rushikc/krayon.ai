import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { act } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { exportReelMp4 } from "@/lib/export-reel";
import {
  RENDER_THEME_STORAGE_KEY,
  SHOW_EDITOR_STORAGE_KEY,
  SHOW_REEL_PREVIEW_STORAGE_KEY,
  WORKSPACE_SIDE_VIEW_STORAGE_KEY,
} from "@/lib/workspace-chrome";
import { HomePage } from "@/pages/HomePage";
import { ReelAnimationsPage } from "@/pages/ReelAnimationsPage";
import { useCanvasStore } from "@/stores/canvas-store";

vi.mock("@/components/ui/scroll-area", () => ({
  ScrollArea: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ScrollBar: () => null,
}));

vi.mock("@/lib/export-reel", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/export-reel")>();
  return {
    ...actual,
    exportReelMp4: vi.fn(actual.exportReelMp4),
  };
});

vi.mock("@/lib/api/reel-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/reel-client")>();
  return {
    ...actual,
    health: vi.fn().mockResolvedValue({ ok: true, service: "reel-backend" }),
    listJobs: vi.fn().mockResolvedValue([]),
    getJob: vi.fn(),
    subscribeToJob: vi.fn(() => () => undefined),
  };
});

describe("home navigation", () => {
  it("links to audio analysis and reel animations", () => {
    render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>,
    );
    expect(screen.getByRole("link", { name: /audio analysis/i })).toHaveAttribute(
      "href",
      "/audio",
    );
    expect(screen.getByRole("link", { name: /reel animations/i })).toHaveAttribute(
      "href",
      "/reel-animations",
    );
    expect(screen.getByRole("heading", { name: "Krayon" })).toBeInTheDocument();
  });
});

describe("reel animations layout", () => {
  beforeEach(() => {
    localStorage.removeItem(RENDER_THEME_STORAGE_KEY);
    localStorage.removeItem(SHOW_EDITOR_STORAGE_KEY);
    localStorage.removeItem(SHOW_REEL_PREVIEW_STORAGE_KEY);
    localStorage.removeItem(WORKSPACE_SIDE_VIEW_STORAGE_KEY);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
    useCanvasStore.getState().reset();
  });

  afterEach(() => {
    vi.mocked(exportReelMp4).mockReset();
  });

  it("pins the reel left and shows the tool row", () => {
    render(
      <MemoryRouter>
        <ReelAnimationsPage />
      </MemoryRouter>,
    );
    expect(screen.getByRole("button", { name: "Timeline" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Chat" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(screen.getByRole("button", { name: "Toggle inspector" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Config" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Play" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Mute" })).not.toBeInTheDocument();
    expect(screen.getByText("00:00 / 00:30")).toBeInTheDocument();
    expect(screen.getAllByText("API Gateway").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole("button", { name: "Add track" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete track 1" })).toBeInTheDocument();
    expect(screen.getByText("Track 1")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Project name" })).toHaveValue(
      "krayon-reel",
    );
    expect(screen.getByRole("link", { name: "Back to home" })).toHaveAttribute(
      "href",
      "/",
    );
    expect(
      screen.getByRole("button", { name: /switch to (dark|light) mode/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Export MP4" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Takes" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Captions" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Zoom" })).toBeDisabled();
    const canvas = document.querySelector("[data-render-theme]");
    expect(canvas).toHaveClass("h-full", "aspect-[9/16]");
  });

  it("switches to chat without showing the timeline", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <ReelAnimationsPage />
      </MemoryRouter>,
    );
    await user.click(screen.getByRole("button", { name: "Chat" }));
    expect(screen.getByRole("heading", { name: "Reel assistant" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add track" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Play" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Toggle inspector" })).toBeDisabled();
  });

  it("hides the inspector when JSON is toggled off", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <ReelAnimationsPage />
      </MemoryRouter>,
    );
    await user.click(screen.getByRole("button", { name: "Toggle inspector" }));
    expect(screen.queryByRole("button", { name: "Config" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add track" })).toBeInTheDocument();
  });

  it("shows the reel preview overlay from Settings", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <ReelAnimationsPage />
      </MemoryRouter>,
    );
    await user.click(screen.getByRole("button", { name: "Settings" }));
    const toggle = await screen.findByRole("button", { name: /reel preview/i });
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByTestId("reel-preview-overlay")).not.toBeInTheDocument();
    await user.click(toggle);
    expect(screen.getByTestId("reel-preview-overlay")).toBeInTheDocument();
  });

  it("plays with Space and cuts with S only when the timeline is focused", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <ReelAnimationsPage />
      </MemoryRouter>,
    );

    await user.keyboard(" ");
    expect(useCanvasStore.getState().isPlaying).toBe(true);

    useCanvasStore.getState().pause();
    useCanvasStore.getState().setCurrentTime(20);
    const before = useCanvasStore.getState().elements.length;
    await user.keyboard("s");
    expect(useCanvasStore.getState().elements.length).toBe(before);

    const timeline = document.querySelector("[data-timeline-root]");
    expect(timeline).toBeInstanceOf(HTMLElement);
    (timeline as HTMLElement).focus();
    await user.keyboard("s");
    expect(useCanvasStore.getState().elements.length).toBeGreaterThan(before);
  });

  it("deletes the selected element with Delete unless an input is focused", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <ReelAnimationsPage />
      </MemoryRouter>,
    );

    act(() => {
      useCanvasStore.getState().selectElement("lambda");
    });
    const before = useCanvasStore.getState().elements.length;
    await user.keyboard("{Delete}");
    expect(useCanvasStore.getState().elements.length).toBe(before - 1);
    expect(useCanvasStore.getState().elements.find((el) => el.id === "lambda")).toBeUndefined();
    expect(useCanvasStore.getState().selectedId).toBeNull();

    act(() => {
      useCanvasStore.getState().selectElement("client");
    });
    const afterFirst = useCanvasStore.getState().elements.length;
    await user.click(screen.getByDisplayValue("Client"));
    await user.keyboard("{Backspace}");
    expect(useCanvasStore.getState().elements.length).toBe(afterFirst);
    expect(useCanvasStore.getState().elements.find((el) => el.id === "client")).toBeDefined();
  });

  it("switches canvas skins from the Canvas popover", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <ReelAnimationsPage />
      </MemoryRouter>,
    );

    const json = JSON.stringify(useCanvasStore.getState().elements);
    await user.click(screen.getByRole("button", { name: "Canvas" }));
    await user.click(await screen.findByRole("button", { name: "Dark" }));
    expect(document.querySelector("[data-render-theme]")).toHaveAttribute(
      "data-render-theme",
      "dark",
    );
    expect(JSON.stringify(useCanvasStore.getState().elements)).toBe(json);

    await user.click(screen.getByRole("button", { name: "Calidraw light" }));
    expect(document.querySelector("[data-render-theme]")).toHaveAttribute(
      "data-render-theme",
      "calidraw-light",
    );
    await user.click(screen.getByRole("button", { name: "Calidraw dark" }));
    expect(document.querySelector("[data-render-theme]")).toHaveAttribute(
      "data-render-theme",
      "calidraw-dark",
    );
    await user.click(screen.getByRole("button", { name: "Canary" }));
    const canaryCanvas = document.querySelector("[data-render-theme]");
    expect(canaryCanvas).toHaveAttribute("data-render-theme", "canary");
    expect((canaryCanvas as HTMLElement).style.backgroundImage).toMatch(/url\(/);
  });

  it("opens a view prompt dialog with copy buttons for the selected skin", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    render(
      <MemoryRouter>
        <ReelAnimationsPage />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole("button", { name: "Canvas" }));
    await user.click(await screen.findByRole("button", { name: "View prompt" }));
    expect(screen.getByRole("heading", { name: "Bright prompt" })).toBeInTheDocument();
    const copies = screen.getAllByRole("button", { name: "Copy" });
    expect(copies.length).toBeGreaterThanOrEqual(2);
    await user.click(copies[0]);
    expect(writeText).toHaveBeenCalledWith(
      expect.stringContaining("Bright canvas"),
    );
  });

  it("opens a blocking export dialog and cancel aborts the encoder", async () => {
    const user = userEvent.setup();
    vi.mocked(exportReelMp4).mockImplementation(async ({ signal }) => {
      await new Promise<void>((_, reject) => {
        signal?.addEventListener("abort", () => {
          reject(new DOMException("Export cancelled", "AbortError"));
        });
      });
    });

    render(
      <MemoryRouter>
        <ReelAnimationsPage />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole("button", { name: "Export MP4" }));
    expect(await screen.findByText("Exporting Video")).toBeInTheDocument();
    expect(screen.getByText("Please do not leave this tab until the export is complete.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => {
      expect(screen.queryByText("Exporting Video")).not.toBeInTheDocument();
    });
    const signal = vi.mocked(exportReelMp4).mock.calls[0][0].signal;
    expect(signal?.aborted).toBe(true);
  });
});
