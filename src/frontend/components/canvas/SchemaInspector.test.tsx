import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SchemaInspector } from "@/components/canvas/SchemaInspector";
import { useCanvasStore } from "@/stores/canvas-store";
import { isNumberNode } from "@/types/canvas";

vi.mock("@/components/ui/scroll-area", () => ({
  ScrollArea: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ScrollBar: () => null,
}));

describe("SchemaInspector rail", () => {
  beforeEach(() => {
    useCanvasStore.getState().reset();
  });

  it("lists seed elements until one is selected", () => {
    render(<SchemaInspector />);
    expect(screen.getByRole("button", { name: "Config" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByText("API Gateway")).toBeInTheDocument();
    expect(screen.getByText("Lambda Function")).toBeInTheDocument();
  });

  it("shows a time range on each element row", () => {
    render(<SchemaInspector />);
    const row = screen.getByRole("button", { name: /^Client/ });
    const { start, end } = useCanvasStore
      .getState()
      .elements.find((element) => element.id === "client")!.time;
    expect(row).toHaveTextContent(`${start}–${end}s`);
  });

  it("filters the element list by label, type, and id", async () => {
    const user = userEvent.setup();
    render(<SchemaInspector />);

    const search = screen.getByRole("textbox", { name: "Search elements" });
    await user.type(search, "lambda");
    expect(screen.getByText("Lambda Function")).toBeInTheDocument();
    expect(screen.queryByText("API Gateway")).not.toBeInTheDocument();

    await user.clear(search);
    await user.type(search, "arrow");
    expect(screen.getByText(/gw-to-lambda/)).toBeInTheDocument();
    expect(screen.queryByText("Lambda Function")).not.toBeInTheDocument();

    await user.clear(search);
    await user.type(search, "nothing-here");
    expect(screen.getByText(/no elements match/i)).toBeInTheDocument();
  });

  it("opens a form from the list and returns with Back", async () => {
    const user = userEvent.setup();
    render(<SchemaInspector />);

    await user.click(screen.getByRole("button", { name: /^API Gateway/ }));
    expect(screen.getByDisplayValue("API Gateway")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /back to element list/i }));
    expect(screen.queryByDisplayValue("API Gateway")).not.toBeInTheDocument();
    expect(screen.getByText("Lambda Function")).toBeInTheDocument();
  });

  it("opens the selected canvas element config", () => {
    render(<SchemaInspector />);
    act(() => {
      useCanvasStore.getState().selectElement("lambda");
    });
    expect(screen.getByDisplayValue("Lambda Function")).toBeInTheDocument();
    expect(screen.getByText("Color Theme")).toBeInTheDocument();
  });

  it("shows a size slider for number elements", () => {
    render(<SchemaInspector />);
    act(() => {
      useCanvasStore.getState().selectElement("step-2");
    });
    expect(screen.getByRole("slider", { name: /size/i })).toBeInTheDocument();
    expect(screen.getByRole("spinbutton", { name: /size/i })).toBeInTheDocument();
    const before = useCanvasStore
      .getState()
      .elements.find((el) => el.id === "step-2");
    const matrixBefore =
      before && isNumberNode(before) ? JSON.stringify(before.matrix) : null;
    fireEvent.change(screen.getByRole("slider", { name: /size/i }), {
      target: { value: "12" },
    });
    const step = useCanvasStore.getState().elements.find((el) => el.id === "step-2");
    expect(step && isNumberNode(step)).toBe(true);
    if (step && isNumberNode(step)) {
      expect(step.size).toBe(12);
      expect(JSON.stringify(step.matrix)).toBe(matrixBefore);
    }
  });

  it("shows raw scene JSON on the JSON tab", async () => {
    const user = userEvent.setup();
    render(<SchemaInspector />);
    await user.click(screen.getByRole("button", { name: "JSON" }));
    const editor = screen.getByRole("textbox", { name: "Scene JSON" });
    expect(editor).toHaveValue(JSON.stringify(useCanvasStore.getState().elements, null, 2));
  });

  it("does not write the store when JSON is invalid", async () => {
    const user = userEvent.setup();
    render(<SchemaInspector />);
    await user.click(screen.getByRole("button", { name: "JSON" }));
    const editor = screen.getByRole("textbox", { name: "Scene JSON" });
    const before = useCanvasStore.getState().elements;
    await user.clear(editor);
    await user.type(editor, "{{");
    await user.tab();
    expect(screen.getByText("JSON is not valid.")).toBeInTheDocument();
    expect(useCanvasStore.getState().elements).toEqual(before);
  });

  it("copies the JSON draft to the clipboard", async () => {
    if (!navigator.clipboard) {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: { writeText: vi.fn() },
      });
    }
    const writeText = vi
      .spyOn(navigator.clipboard, "writeText")
      .mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<SchemaInspector />);
    await user.click(screen.getByRole("button", { name: "JSON" }));
    await user.click(screen.getByRole("button", { name: "Copy" }));
    expect(writeText).toHaveBeenCalledWith(
      JSON.stringify(useCanvasStore.getState().elements, null, 2),
    );
  });
});
