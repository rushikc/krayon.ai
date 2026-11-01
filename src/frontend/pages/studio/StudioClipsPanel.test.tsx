import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { StudioClip, StudioGroup } from "@/lib/api/studio-client";
import { StudioClipsPanel } from "@/pages/studio/StudioClipsPanel";

function clip(partial: Partial<StudioClip> & Pick<StudioClip, "id" | "status" | "text">): StudioClip {
  return {
    parentIds: [],
    sourceStart: 0,
    sourceEnd: 2,
    ranges: [{ sourceStart: 0, sourceEnd: 2 }],
    duration: 2,
    words: [],
    groupId: "g-0001",
    label: "none",
    score: 1,
    reasons: [],
    decidedBy: "algorithm",
    note: "",
    ...partial,
  };
}

const groups: StudioGroup[] = [
  { id: "g-0001", label: "alpha beta", clipIds: ["c-0001", "c-0002"], recommendedClipId: "c-0001" },
];

describe("StudioClipsPanel", () => {
  it("selects on click, collapses on double click, and cycles filters", async () => {
    const onSelect = vi.fn();
    const onFilterChange = vi.fn();
    render(
      <StudioClipsPanel
        clips={[
          clip({ id: "c-0001", status: "selected", text: "accepted take" }),
          clip({ id: "c-0002", status: "rejected", text: "rejected take" }),
        ]}
        groups={groups}
        selectedClipId={null}
        filter="all"
        onFilterChange={onFilterChange}
        onSelect={onSelect}
        onPlay={vi.fn()}
      />,
    );
    expect(screen.getAllByTestId("status-dot").length).toBe(2);
    await userEvent.click(screen.getByText("accepted take"));
    expect(onSelect).toHaveBeenCalledWith("c-0001");
    await userEvent.dblClick(screen.getByText("accepted take"));
    expect(screen.getByRole("button", { name: /alpha beta/ })).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(screen.getByTestId("toggle-all-groups"));
    expect(screen.getByTestId("toggle-all-groups")).toHaveAttribute("aria-label", "Collapse all");
    await userEvent.click(screen.getByRole("button", { name: "1 accepted" }));
    expect(onFilterChange).toHaveBeenCalled();
  });

  it("shows an empty list and keeps long text truncated", () => {
    const long = "alpha ".repeat(40);
    render(
      <StudioClipsPanel
        clips={[clip({ id: "c-0001-very-long-identifier", status: "undecided", text: long })]}
        groups={[{ id: "g-0001", label: long, clipIds: ["c-0001-very-long-identifier"], recommendedClipId: null }]}
        selectedClipId={null}
        filter="all"
        onFilterChange={vi.fn()}
        onSelect={vi.fn()}
        onPlay={vi.fn()}
      />,
    );
    const truncated = document.querySelector(".truncate");
    expect(truncated).toBeTruthy();
    expect(truncated?.textContent).toContain("alpha alpha");
    expect(truncated?.className).toMatch(/truncate/);
    render(
      <StudioClipsPanel
        clips={[]}
        groups={[]}
        selectedClipId={null}
        filter="all"
        onFilterChange={vi.fn()}
        onSelect={vi.fn()}
        onPlay={vi.fn()}
      />,
    );
    expect(screen.getAllByTestId("studio-clips").length).toBeGreaterThan(0);
  });

  it("activates a row from the keyboard", async () => {
    const onSelect = vi.fn();
    render(
      <StudioClipsPanel
        clips={[clip({ id: "c-0001", status: "undecided", text: "keyboard take" })]}
        groups={[{ id: "g-0001", label: "line", clipIds: ["c-0001"], recommendedClipId: "c-0001" }]}
        selectedClipId={null}
        filter="all"
        onFilterChange={vi.fn()}
        onSelect={onSelect}
        onPlay={vi.fn()}
      />,
    );
    const row = screen.getByRole("button", { name: "Take 1" });
    row.focus();
    await userEvent.keyboard("{Enter}");
    expect(onSelect).toHaveBeenCalledWith("c-0001");
  });
});
