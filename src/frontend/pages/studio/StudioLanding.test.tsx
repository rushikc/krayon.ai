import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api/studio-client", () => ({
  listProjects: vi.fn(async () => ({ projects: [], current: null })),
  createProject: vi.fn(),
  importFile: vi.fn(),
  importPath: vi.fn(),
  pickFile: vi.fn(),
}));

describe("StudioLanding script field", () => {
  it("shows a live line count for the optional script", async () => {
    const { StudioLanding } = await import("@/pages/studio/StudioLanding");
    render(
      <MemoryRouter>
        <StudioLanding />
      </MemoryRouter>,
    );
    const details = await screen.findByTestId("script-optional");
    details.setAttribute("open", "");
    const area = screen.getByTestId("script-textarea");
    await userEvent.type(area, "hello world{Enter}{Enter}second line");
    expect(screen.getByTestId("script-line-count")).toHaveTextContent("2 lines");
  });

  it("creates an untitled project, shows a client error, and lists recent projects", async () => {
    const client = await import("@/lib/api/studio-client");
    vi.mocked(client.createProject).mockRejectedValueOnce(new Error("name already used"));
    const { StudioLanding } = await import("@/pages/studio/StudioLanding");
    const { unmount } = render(
      <MemoryRouter>
        <StudioLanding />
      </MemoryRouter>,
    );
    expect(screen.getByPlaceholderText("Lecture 12")).toBeInTheDocument();
    const path = screen.getByPlaceholderText("/path/to/recording.mp4");
    await userEvent.type(path, "/tmp/talk.mp4");
    await userEvent.click(screen.getByRole("button", { name: "Create" }));
    expect(await screen.findByText("name already used")).toHaveClass("text-destructive");
    expect(client.createProject).toHaveBeenCalledWith("Untitled", "");
    unmount();

    vi.mocked(client.listProjects).mockResolvedValue({
      projects: [
        {
          slug: "demo",
          title: "Demo lecture",
          sourcePath: null,
          revision: 1,
          status: "ready",
          statusMessage: "ready",
        },
      ],
      current: "demo",
    });
    render(
      <MemoryRouter>
        <StudioLanding />
      </MemoryRouter>,
    );
    expect(await screen.findByRole("button", { name: /Demo lecture/ })).toBeInTheDocument();
  });
});
