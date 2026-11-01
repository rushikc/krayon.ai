import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const listProjects = vi.fn(async () => ({ projects: [], current: null }));
const createProject = vi.fn();
const importFile = vi.fn();
const importPath = vi.fn();
const pickFile = vi.fn();
const checkProjectName = vi.fn(async () => ({ available: true }));
const deleteProject = vi.fn(async () => ({ deleted: "demo" }));
const deleteAllProjects = vi.fn(async () => ({ deleted: [], skipped: [] }));

vi.mock("@/lib/api/studio-client", () => ({
  listProjects: (...args: unknown[]) => listProjects(...args),
  createProject: (...args: unknown[]) => createProject(...args),
  importFile: (...args: unknown[]) => importFile(...args),
  importPath: (...args: unknown[]) => importPath(...args),
  pickFile: (...args: unknown[]) => pickFile(...args),
  checkProjectName: (...args: unknown[]) => checkProjectName(...args),
  deleteProject: (...args: unknown[]) => deleteProject(...args),
  deleteAllProjects: (...args: unknown[]) => deleteAllProjects(...args),
}));

const navigate = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...actual, useNavigate: () => navigate };
});

describe("StudioLanding", () => {
  beforeEach(() => {
    navigate.mockReset();
    listProjects.mockResolvedValue({ projects: [], current: null });
    checkProjectName.mockResolvedValue({ available: true });
    createProject.mockReset();
    importFile.mockReset();
    importPath.mockReset();
    deleteProject.mockReset();
    deleteAllProjects.mockReset();
  });

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

  it("disables create when the name is empty and shows a create error", async () => {
    createProject.mockRejectedValueOnce(new Error("name already used"));
    const { StudioLanding } = await import("@/pages/studio/StudioLanding");
    render(
      <MemoryRouter>
        <StudioLanding />
      </MemoryRouter>,
    );
    expect(screen.getByRole("button", { name: "Create" })).toBeDisabled();
    await userEvent.type(screen.getByPlaceholderText("Lecture 12"), "Talk");
    const path = screen.getByPlaceholderText("/path/to/recording.mp4");
    await userEvent.type(path, "/tmp/talk.mp4");
    await userEvent.click(screen.getByRole("button", { name: "Create" }));
    expect(await screen.findByText("name already used")).toHaveClass("text-destructive");
    expect(createProject).toHaveBeenCalledWith("Talk", "");
  });

  it("lists projects and does not open one when delete is clicked", async () => {
    listProjects.mockResolvedValue({
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
    const { StudioLanding } = await import("@/pages/studio/StudioLanding");
    render(
      <MemoryRouter>
        <StudioLanding />
      </MemoryRouter>,
    );
    expect(await screen.findByText("Demo lecture", {}, { timeout: 3000 })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Delete project Demo lecture" }));
    expect(navigate).not.toHaveBeenCalled();
    expect(await screen.findByText(/Your original video is not touched/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(deleteProject).toHaveBeenCalledWith("demo"));
  });

  it("requires typing DELETE before delete-all confirms", async () => {
    listProjects.mockResolvedValue({
      projects: [{ slug: "a", title: "A", status: "empty", sourcePath: null, revision: 0, statusMessage: "" }],
      current: null,
    });
    const { StudioLanding } = await import("@/pages/studio/StudioLanding");
    render(
      <MemoryRouter>
        <StudioLanding />
      </MemoryRouter>,
    );
    await userEvent.click(await screen.findByRole("button", { name: "Delete all" }));
    const confirm = screen.getByRole("button", { name: "Delete all", hidden: false });
    const dialogConfirm = screen.getAllByRole("button", { name: "Delete all" }).at(-1)!;
    expect(dialogConfirm).toBeDisabled();
    await userEvent.type(screen.getByLabelText("Type DELETE to confirm"), "DELETE");
    expect(dialogConfirm).not.toBeDisabled();
    await userEvent.click(dialogConfirm);
    await waitFor(() => expect(deleteAllProjects).toHaveBeenCalled());
    void confirm;
  });

  it("shows a duplicate-name error from check-name", async () => {
    checkProjectName.mockResolvedValue({ available: false, reason: "taken" });
    const { StudioLanding } = await import("@/pages/studio/StudioLanding");
    render(
      <MemoryRouter>
        <StudioLanding />
      </MemoryRouter>,
    );
    await userEvent.type(screen.getByPlaceholderText("Lecture 12"), "Taken");
    expect(await screen.findByText("A project with this name already exists")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create" })).toBeDisabled();
  });

  it("prefills a dropped duplicate name instead of creating", async () => {
    checkProjectName.mockResolvedValue({ available: false });
    const { StudioLanding } = await import("@/pages/studio/StudioLanding");
    render(
      <MemoryRouter>
        <StudioLanding />
      </MemoryRouter>,
    );
    const zone = screen.getByText("Drop a video here");
    const file = new File(["x"], "Lecture.mp4", { type: "video/mp4" });
    fireEvent.drop(zone, { dataTransfer: { files: [file] } });
    expect(createProject).not.toHaveBeenCalled();
    expect(await screen.findByDisplayValue("Lecture")).toBeInTheDocument();
    expect(await screen.findByText("A project with this name already exists")).toBeInTheDocument();
  });

  it("deletes a half-created project when import fails", async () => {
    createProject.mockResolvedValue({ slug: "orphan" });
    importPath.mockRejectedValue(new Error("bad path"));
    const { StudioLanding } = await import("@/pages/studio/StudioLanding");
    render(
      <MemoryRouter>
        <StudioLanding />
      </MemoryRouter>,
    );
    await userEvent.type(screen.getByPlaceholderText("Lecture 12"), "Orphan");
    await userEvent.type(screen.getByPlaceholderText("/path/to/recording.mp4"), "/tmp/missing.mp4");
    await userEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => expect(deleteProject).toHaveBeenCalledWith("orphan"));
    expect(navigate).not.toHaveBeenCalled();
  });
});
