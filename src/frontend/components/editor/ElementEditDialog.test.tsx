import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ElementEditDialog } from "@/components/editor/ElementEditDialog";
import { useCanvasStore } from "@/stores/canvas-store";

describe("ElementEditDialog", () => {
  beforeEach(() => {
    useCanvasStore.getState().reset();
  });

  it("saves a label as one undo step", async () => {
    const user = userEvent.setup();
    render(
      <ElementEditDialog elementId="client" onClose={() => undefined} />,
    );

    const input = screen.getByDisplayValue("Client");
    await user.clear(input);
    await user.type(input, "Browser");
    expect(
      useCanvasStore.getState().elements.find((el) => el.id === "client"),
    ).toMatchObject({ label: "Client" });

    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(
      useCanvasStore.getState().elements.find((el) => el.id === "client"),
    ).toMatchObject({ label: "Browser" });

    useCanvasStore.getState().undo();
    expect(
      useCanvasStore.getState().elements.find((el) => el.id === "client"),
    ).toMatchObject({ label: "Client" });
  });

  it("discards draft changes on Cancel", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<ElementEditDialog elementId="client" onClose={onClose} />);

    const input = screen.getByDisplayValue("Client");
    await user.clear(input);
    await user.type(input, "Nope");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalled();
    expect(
      useCanvasStore.getState().elements.find((el) => el.id === "client"),
    ).toMatchObject({ label: "Client" });
  });

  it("disables Save when the time range is invalid", async () => {
    const user = userEvent.setup();
    render(
      <ElementEditDialog elementId="client" onClose={() => undefined} />,
    );

    const start = screen.getByRole("spinbutton", { name: /start/i });
    await user.clear(start);
    await user.type(start, "40");
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(screen.getByText(/duration must be at least/i)).toBeInTheDocument();
  });

  it("deletes the element after confirm", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const onClose = vi.fn();
    render(<ElementEditDialog elementId="client" onClose={onClose} />);

    await user.click(screen.getByRole("button", { name: "Delete element" }));
    expect(
      useCanvasStore.getState().elements.find((el) => el.id === "client"),
    ).toBeUndefined();
    expect(onClose).toHaveBeenCalled();
  });
});
