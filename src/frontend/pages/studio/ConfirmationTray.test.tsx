import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { ConfirmationItem } from "@/lib/api/studio-client";
import { ConfirmationTray } from "@/pages/studio/ConfirmationTray";

const item: ConfirmationItem = {
  id: "q-0001",
  seq: 1,
  kind: "confirm",
  title: "Reject c-0003?",
  message: "Drop the **weak** take `c-0003`.",
  clipIds: ["c-0003"],
  options: [
    { id: "accept", label: "Accept", style: "primary", applyOps: true },
    { id: "decline", label: "Decline", style: "danger", applyOps: false },
  ],
  defaultOptionId: "accept",
  proposedOps: { baseRevision: 1, ops: [{ op: "reject", clipId: "c-0003" }] },
  allowNote: true,
  status: "pending",
  answer: null,
  result: null,
  createdBy: "grok",
  createdAt: new Date().toISOString(),
  expiresAt: null,
};

describe("ConfirmationTray", () => {
  it("renders the oldest pending card and answers", async () => {
    const onAnswer = vi.fn();
    render(
      <ConfirmationTray
        items={[item]}
        onAnswer={onAnswer}
        onSelectClip={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );
    expect(screen.getByTestId("confirmation-card")).toHaveTextContent("Reject c-0003?");
    expect(screen.getAllByText("c-0003").length).toBeGreaterThan(0);
    expect(screen.getByText("reject c-0003")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Accept" }));
    expect(onAnswer).toHaveBeenCalledWith(item, "accept", "");
  });
});
