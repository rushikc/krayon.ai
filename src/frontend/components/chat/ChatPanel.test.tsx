import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { ChatPanel } from "@/components/chat/ChatPanel";
import { ChatRunCard } from "@/components/chat/ChatRunCard";
import { useReelChatStore } from "@/stores/reel-chat-store";
import type { JobState } from "@/types/reel-pipeline";

function job(partial: Partial<JobState>): JobState {
  return {
    id: "j1",
    status: "running",
    script: "explain search",
    maxRounds: 2,
    passScore: 7,
    models: { generate: "g", review: "r", fix: "f" },
    progress: { phase: "render", message: "Rendering frames", round: 1, ratio: 0.4 },
    rounds: [],
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...partial,
  };
}

describe("reel chat", () => {
  beforeEach(() => {
    useReelChatStore.setState({
      healthOk: true,
      jobIds: [],
      jobsById: {},
      historyJobs: [],
      keyDialogOpen: false,
    });
  });

  it("shows the missing-key dialog", () => {
    useReelChatStore.setState({ keyDialogOpen: true });
    render(<ChatPanel onApplied={() => undefined} />);
    expect(screen.getByRole("dialog", { name: "Gemini API key" })).toBeInTheDocument();
    expect(screen.getByText("Reel assistant")).toBeInTheDocument();
  });

  it("shows running, failed, review, and fixed cards", () => {
    const { rerender } = render(<ChatRunCard job={job({ status: "running" })} onApplied={() => undefined} />);
    expect(screen.getByText(/Rendering frames/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();

    rerender(
      <ChatRunCard
        job={job({
          status: "error",
          progress: { phase: "review", message: "Review failed", round: 1, ratio: 1 },
          error: { code: "SCHEMA_INVALID", message: "Scene JSON is invalid" },
        })}
        onApplied={() => undefined}
      />,
    );
    expect(screen.getByText("Gemini returned a scene that didn't match the schema.")).toHaveClass(
      "text-destructive",
    );

    rerender(
      <ChatRunCard
        job={job({
          status: "running",
          progress: { phase: "review", message: "Reviewing the reel", round: 1, ratio: 0.6 },
        })}
        onApplied={() => undefined}
      />,
    );
    expect(screen.getByText(/Reviewing the reel/)).toBeInTheDocument();
    expect(screen.getByText("review").className).toMatch(/text-primary/);

    rerender(
      <ChatRunCard
        job={job({
          status: "running",
          progress: { phase: "fix", message: "Applying the review", round: 1, ratio: 0.8 },
        })}
        onApplied={() => undefined}
      />,
    );
    expect(screen.getByText("fix").className).toMatch(/text-primary/);
    expect(screen.getByText(/Applying the review/)).toBeInTheDocument();

    rerender(
      <ChatRunCard
        job={job({
          status: "done",
          progress: { phase: "done", message: "Fixed", round: 1, ratio: 1 },
          result: { round: 1, scene: [], scores: { overall: 8 } } as JobState["result"],
        })}
        onApplied={() => undefined}
      />,
    );
    expect(screen.getByRole("button", { name: "Apply to timeline" })).toBeInTheDocument();
    expect(screen.getByText(/Best round 1/)).toBeInTheDocument();
  });
});
