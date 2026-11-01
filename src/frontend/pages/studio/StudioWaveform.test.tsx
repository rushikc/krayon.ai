import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { applyTheme } from "@/lib/theme";
import { StudioWaveform } from "@/pages/studio/StudioWaveform";

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => {
    const store: Record<string, unknown> = {};
    return new Proxy(store, {
      get(target, prop) {
        if (typeof prop !== "string") return undefined;
        if (!(prop in target)) target[prop] = () => undefined;
        return target[prop];
      },
      set(target, prop, value) {
        target[prop as string] = value;
        return true;
      },
    }) as unknown as CanvasRenderingContext2D;
  });
});

function renderWave(editing: boolean) {
  const onSeek = vi.fn();
  render(
    <StudioWaveform
      peaks={[0, 0.4, -0.2, 0.8]}
      duration={4}
      currentTime={1}
      editing={editing}
      cuts={[1.2]}
      sourceStart={0}
      sourceEnd={4}
      pad={0.05}
      onSeek={onSeek}
    />,
  );
  return onSeek;
}

describe("StudioWaveform", () => {
  it("draws peaks, marks cuts only while editing, and uses the theme playhead", () => {
    renderWave(false);
    expect(HTMLCanvasElement.prototype.getContext).toHaveBeenCalled();
    expect(screen.getByTestId("studio-waveform")).toHaveAttribute("data-editing", "false");
    expect(screen.queryByRole("button")).toBeNull();
    const playhead = screen.getByTestId("waveform-playhead");
    expect(playhead.className).toMatch(/bg-foreground/);
    applyTheme("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    applyTheme("dark");
    expect(playhead.className).toMatch(/bg-foreground/);
  });

  it("shows a cut marker in edit mode", () => {
    renderWave(true);
    expect(screen.getByTestId("studio-waveform")).toHaveAttribute("data-editing", "true");
    expect(screen.getByRole("button", { name: /×/ })).toBeInTheDocument();
  });
});
