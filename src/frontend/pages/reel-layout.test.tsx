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
  SHOW_TIMELINE_STORAGE_KEY,
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
    localStorage.removeItem(SHOW_TIMELINE_STORAGE_KEY);
    localStorage.removeItem(SHOW_EDITOR_STORAGE_KEY);
    localStorage.removeItem(SHOW_REEL_PREVIEW_STORAGE_KEY);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
    useCanvasStore.getState().reset();
  });

  afterEach(() => {
    vi.mocked(exportReelMp4).mockReset();
  });

  it("shows the timeline, editor, and seed clips", () => {
    render(
      <MemoryRouter>
        <ReelAnimationsPage />
      </MemoryRouter>,
    );
    expect(screen.getByRole("button", { name: /timeline/i })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: /editor/i })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(
      screen.getByRole("button", { name: /reel preview/i }),
    ).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByTestId("reel-preview-overlay")).not.toBeInTheDocument();
    expect(screen.getByRole("separator", { name: /resize timeline/i })).toBeInTheDocument();
    expect(screen.queryByRole("separator", { name: /resize editor/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Config" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "JSON" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Play" })).toBeInTheDocument();
    const muteButton = screen.getByRole("button", { name: "Mute" });
    expect(muteButton).toBeInTheDocument();
    expect(muteButton).toHaveAttribute("aria-pressed", "false");
    expect(
      screen.getByRole("button", { name: "Play" }).compareDocumentPosition(
        muteButton,
      ) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.getByText("00:00 / 00:30")).toBeInTheDocument();
    expect(screen.getAllByText("API Gateway").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole("button", { name: "Add track" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete track 1" })).toBeInTheDocument();
    expect(screen.queryByText("Track 7")).not.toBeInTheDocument();
    expect(screen.queryByText("Track 1")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Bright" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Dark" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(screen.getByRole("button", { name: "Calidraw light" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(screen.getByRole("button", { name: "Calidraw dark" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(screen.getByRole("button", { name: "Canary" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(document.querySelector("[data-render-theme]")).toHaveAttribute(
      "data-render-theme",
      "bright",
    );
    const canvas = document.querySelector("[data-render-theme]");
    expect(canvas).toHaveClass("h-full", "aspect-[9/16]");
    const exportButton = screen.getByRole("button", { name: "Export MP4" });
    const uploadAudio = screen.getByRole("button", { name: "Upload audio" });
    const viewPrompt = screen.getByRole("button", { name: "View prompt" });
    expect(exportButton).toBeInTheDocument();
    expect(exportButton).not.toHaveAttribute("aria-pressed");
    expect(uploadAudio).toBeInTheDocument();
    expect(
      viewPrompt.compareDocumentPosition(uploadAudio) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      uploadAudio.compareDocumentPosition(exportButton) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Remove audio" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("group", { name: "Panels" }),
    ).toContainElement(screen.getByRole("button", { name: "Reel preview" }));
    expect(
      screen.getByRole("group", { name: "Canvas skin" }),
    ).toContainElement(
      screen.getByRole("button", { name: "Bright" }),
    );
    expect(screen.getByRole("link", { name: "Back to home" })).toHaveAttribute(
      "href",
      "/",
    );
    expect(screen.queryByRole("heading", { name: "Krayon" })).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /switch to (dark|light) mode/i }),
    ).not.toBeInTheDocument();
  });

  it("hides timeline and editor when toggled off", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <ReelAnimationsPage />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole("button", { name: /timeline/i }));
    expect(screen.queryByRole("button", { name: "Add track" })).not.toBeInTheDocument();
    expect(screen.queryByRole("separator", { name: /resize timeline/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Play" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^editor$/i }));
    expect(screen.queryByRole("button", { name: "Config" })).not.toBeInTheDocument();
    expect(screen.queryByRole("separator", { name: /resize editor/i })).not.toBeInTheDocument();
  });

  it("shows the reel preview overlay when toggled on", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <ReelAnimationsPage />
      </MemoryRouter>,
    );

    const toggle = screen.getByRole("button", { name: /reel preview/i });
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByTestId("reel-preview-overlay")).not.toBeInTheDocument();

    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-pressed", "true");
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

  it("switches canvas skins without changing element JSON", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <ReelAnimationsPage />
      </MemoryRouter>,
    );

    const json = JSON.stringify(useCanvasStore.getState().elements);
    await user.click(screen.getByRole("button", { name: "Dark" }));
    expect(screen.getByRole("button", { name: "Dark" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(document.querySelector("[data-render-theme]")).toHaveAttribute(
      "data-render-theme",
      "dark",
    );
    expect(JSON.stringify(useCanvasStore.getState().elements)).toBe(json);

    await user.click(screen.getByRole("button", { name: "Calidraw light" }));
    expect(screen.getByRole("button", { name: "Calidraw light" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Bright" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(document.querySelector("[data-render-theme]")).toHaveAttribute(
      "data-render-theme",
      "calidraw-light",
    );
    expect(JSON.stringify(useCanvasStore.getState().elements)).toBe(json);

    await user.click(screen.getByRole("button", { name: "Calidraw dark" }));
    expect(document.querySelector("[data-render-theme]")).toHaveAttribute(
      "data-render-theme",
      "calidraw-dark",
    );
    expect(JSON.stringify(useCanvasStore.getState().elements)).toBe(json);

    await user.click(screen.getByRole("button", { name: "Canary" }));
    expect(screen.getByRole("button", { name: "Canary" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    const canaryCanvas = document.querySelector("[data-render-theme]");
    expect(canaryCanvas).toHaveAttribute("data-render-theme", "canary");
    expect((canaryCanvas as HTMLElement).style.backgroundImage).toMatch(/url\(/);
    expect(JSON.stringify(useCanvasStore.getState().elements)).toBe(json);
  });

  it("opens a view prompt dialog with copy buttons for the selected skin", () => {
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

    fireEvent.click(screen.getByRole("button", { name: "View prompt" }));
    expect(screen.getByRole("heading", { name: "Bright prompt" })).toBeInTheDocument();
    expect(screen.getByText(/Bright canvas/)).toBeInTheDocument();
    const copyButtons = screen.getAllByRole("button", { name: "Copy" });
    expect(copyButtons).toHaveLength(2);
    fireEvent.click(copyButtons[0]);
    expect(writeText).toHaveBeenCalledWith(
      expect.stringContaining("Bright canvas"),
    );
    fireEvent.click(copyButtons[1]);
    expect(writeText).toHaveBeenCalledTimes(2);

    fireEvent.click(document.querySelector('[data-slot="dialog-overlay"]')!);
    fireEvent.click(screen.getByRole("button", { name: "Canary" }));
    fireEvent.click(screen.getByRole("button", { name: "View prompt" }));
    expect(screen.getByRole("heading", { name: "Canary prompt" })).toBeInTheDocument();
    expect(screen.getByText(/Soft keep-out/)).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "Copy" })[0]);
    expect(writeText).toHaveBeenLastCalledWith(
      expect.stringContaining("Soft keep-out"),
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
