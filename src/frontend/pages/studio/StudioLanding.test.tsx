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
});
