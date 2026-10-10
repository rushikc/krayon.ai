import { beforeEach, describe, expect, it } from "vitest";

import {
  CELL_HEIGHT,
  CELL_WIDTH,
  clampBoxBounds,
  clampBoxFontSize,
  clampNumberBounds,
  getArrowGeometry,
  matrixToPercents,
  numberBadgeSize,
  percentsToMatrix,
  percentsToNumberMatrix,
  scaleBox,
} from "@/lib/canvas-geometry";
import { isZoomInKey, isZoomKey, isZoomOutKey } from "@/lib/canvas-keyboard";
import {
  durationFromElements,
  lastVisibleTime,
  useCanvasStore,
} from "@/stores/canvas-store";
import {
  getStoredRenderTheme,
  RENDER_THEME_STORAGE_KEY,
} from "@/lib/workspace-chrome";
import {
  getElementLabel,
  isArrowNode,
  isBoxNode,
  isNumberNode,
} from "@/types/canvas";

describe("canvas seed scene", () => {
  beforeEach(() => {
    useCanvasStore.getState().reset();
  });

  it("seeds overlapping explainer clips on a 30s reel", () => {
    const { elements, duration } = useCanvasStore.getState();
    expect(duration).toBe(30);
    expect(elements.map((el) => [el.id, el.time])).toEqual([
      ["client", { start: 0.4, end: 30, track: 2 }],
      ["step-1", { start: 0, end: 3, track: 1 }],
      ["api-gateway", { start: 1, end: 30, track: 3 }],
      ["client-to-gw", { start: 2.2, end: 30, track: 7 }],
      ["step-2", { start: 3.5, end: 6.5, track: 1 }],
      ["lambda", { start: 5, end: 30, track: 4 }],
      ["gw-to-lambda", { start: 6.5, end: 30, track: 8 }],
      ["callout-rest", { start: 7, end: 12, track: 0 }],
      ["step-3", { start: 8.5, end: 11.5, track: 1 }],
      ["dynamo", { start: 10, end: 30, track: 5 }],
      ["lambda-to-dynamo", { start: 11.5, end: 30, track: 9 }],
      ["callout-query", { start: 14, end: 19, track: 0 }],
      ["step-4", { start: 16, end: 19, track: 1 }],
      ["ok", { start: 18, end: 30, track: 6 }],
      ["step-5", { start: 21, end: 24.5, track: 1 }],
      ["callout-fast", { start: 23, end: 30, track: 0 }],
    ]);
    expect(elements.some(isBoxNode)).toBe(true);
    expect(elements.some(isNumberNode)).toBe(true);
    expect(elements.some(isArrowNode)).toBe(true);
    expect(elements.filter(isBoxNode).every((box) => box.sublabel === undefined)).toBe(
      true,
    );
    expect(useCanvasStore.getState().trackCount).toBe(10);
    expect(useCanvasStore.getState().renderTheme).toBe("bright");
  });

  it("updates time through onChange-style setElements and preserves type", () => {
    const store = useCanvasStore.getState();
    store.updateElement("api-gateway", {
      time: { start: 12, end: 22, track: 1 },
    });
    const box = useCanvasStore.getState().elements.find((el) => el.id === "api-gateway");
    expect(box?.type).toBe("box");
    expect(box?.time).toEqual({ start: 12, end: 22, track: 1 });
  });

  it("rejects duration below 1s", () => {
    expect(durationFromElements([])).toBe(1);
    expect(
      durationFromElements([
        {
          id: "n",
          type: "number",
          matrix: [0, 0],
          value: 1,
          colorTheme: "ink",
          time: { start: 0, end: 0, track: 0 },
        },
      ]),
    ).toBe(1);
  });

  it("grows duration to the latest element end", () => {
    const store = useCanvasStore.getState();
    store.setElements([
      {
        id: "headline",
        type: "box",
        matrix: [1, 3, 16, 5],
        label: "Headline",
        colorTheme: "ink",
        time: { start: 0, end: 80, track: 2 },
      },
    ]);
    expect(useCanvasStore.getState().duration).toBe(80);
    expect(useCanvasStore.getState().currentTime).toBeLessThan(80);
    expect(useCanvasStore.getState().currentTime).toBeLessThanOrEqual(
      lastVisibleTime(80),
    );
  });

  it("locks reel duration to preview audio instead of later JSON ends", () => {
    const store = useCanvasStore.getState();
    store.setElements([
      {
        id: "headline",
        type: "box",
        matrix: [1, 3, 16, 5],
        label: "Headline",
        colorTheme: "ink",
        time: { start: 0, end: 125, track: 2 },
      },
    ]);
    expect(useCanvasStore.getState().duration).toBe(125);

    store.setPreviewAudioDuration(88.4);
    expect(useCanvasStore.getState().duration).toBe(88.4);
    expect(useCanvasStore.getState().currentTime).toBeLessThanOrEqual(
      lastVisibleTime(88.4),
    );

    store.setElements(useCanvasStore.getState().elements);
    expect(useCanvasStore.getState().duration).toBe(88.4);

    store.setPreviewAudioDuration(null);
    expect(useCanvasStore.getState().duration).toBe(125);
  });

  it("plays from the marker and restarts at the end", () => {
    const store = useCanvasStore.getState();
    store.setCurrentTime(12);
    store.play();
    expect(useCanvasStore.getState().isPlaying).toBe(true);
    expect(useCanvasStore.getState().currentTime).toBe(12);

    store.pause();
    expect(useCanvasStore.getState().isPlaying).toBe(false);

    store.setCurrentTime(60);
    store.play();
    expect(useCanvasStore.getState().currentTime).toBe(0);
    expect(useCanvasStore.getState().isPlaying).toBe(true);
  });

  it("undoes and redoes element edits without recording playback", () => {
    const store = useCanvasStore.getState();
    store.updateElement("api-gateway", { label: "Gateway" });
    expect(
      useCanvasStore.getState().elements.find((el) => el.id === "api-gateway"),
    ).toMatchObject({ label: "Gateway" });

    store.play();
    store.undo();
    expect(
      useCanvasStore.getState().elements.find((el) => el.id === "api-gateway"),
    ).toMatchObject({ label: "API Gateway" });
    expect(useCanvasStore.getState().isPlaying).toBe(true);

    store.redo();
    expect(
      useCanvasStore.getState().elements.find((el) => el.id === "api-gateway"),
    ).toMatchObject({ label: "Gateway" });
  });

  it("adds tracks and deletes a track while reindexing clips", () => {
    const store = useCanvasStore.getState();
    expect(store.trackCount).toBe(10);
    store.addTrack();
    expect(useCanvasStore.getState().trackCount).toBe(11);

    store.deleteTrack(0);
    const next = useCanvasStore.getState();
    expect(next.trackCount).toBe(10);
    expect(next.elements.find((el) => el.id === "callout-rest")).toBeUndefined();
    expect(next.elements.find((el) => el.id === "callout-query")).toBeUndefined();
    expect(next.elements.find((el) => el.id === "callout-fast")).toBeUndefined();
    expect(next.elements.find((el) => el.id === "api-gateway")?.time.track).toBe(2);
    expect(next.elements.find((el) => el.id === "lambda")?.time.track).toBe(3);
    expect(next.elements.find((el) => el.id === "step-1")?.time.track).toBe(0);
  });

  it("cuts clips at the playhead", () => {
    const store = useCanvasStore.getState();
    store.setCurrentTime(20);
    store.cutAtPlayhead();
    expect(
      useCanvasStore.getState().elements.find((el) => el.id === "api-gateway")
        ?.time,
    ).toEqual({ start: 1, end: 20, track: 3 });
    expect(
      useCanvasStore.getState().elements.some((el) => el.time.start === 20),
    ).toBe(true);
    expect(useCanvasStore.getState().selectedId).toBe("client");
  });

  it("changes render theme without recording history or mutating JSON", () => {
    const store = useCanvasStore.getState();
    const json = JSON.stringify(store.elements);
    store.setRenderTheme("calidraw-dark");
    expect(useCanvasStore.getState().renderTheme).toBe("calidraw-dark");
    expect(JSON.stringify(useCanvasStore.getState().elements)).toBe(json);
    store.undo();
    expect(useCanvasStore.getState().renderTheme).toBe("calidraw-dark");
    store.reset();
    expect(useCanvasStore.getState().renderTheme).toBe("bright");
  });

  it("uses a stored canary value as the initial skin", () => {
    localStorage.setItem(RENDER_THEME_STORAGE_KEY, "canary");
    expect(getStoredRenderTheme()).toBe("canary");
    useCanvasStore.getState().setRenderTheme(getStoredRenderTheme());
    expect(useCanvasStore.getState().renderTheme).toBe("canary");
    expect(localStorage.getItem(RENDER_THEME_STORAGE_KEY)).toBe("canary");
  });

  it("deletes the selected element without removing connected arrows", () => {
    const store = useCanvasStore.getState();
    store.selectElement("lambda");
    store.deleteSelectedElement();
    const next = useCanvasStore.getState();
    expect(next.elements.find((el) => el.id === "lambda")).toBeUndefined();
    expect(next.elements.find((el) => el.id === "gw-to-lambda")).toBeDefined();
    expect(next.elements.find((el) => el.id === "lambda-to-dynamo")).toBeDefined();
    expect(next.selectedId).toBeNull();

    store.undo();
    expect(useCanvasStore.getState().elements.find((el) => el.id === "lambda")).toBeDefined();
    expect(useCanvasStore.getState().selectedId).toBe("lambda");
  });

  it("does nothing when deleting with no selection", () => {
    const store = useCanvasStore.getState();
    const before = store.elements;
    store.deleteSelectedElement();
    expect(useCanvasStore.getState().elements).toBe(before);
  });
});

describe("canvas geometry", () => {
  it("keeps boxes inside the 0–100 frame", () => {
    expect(clampBoxBounds({ x: -10, y: 90, width: 50, height: 50 })).toEqual({
      x: 0,
      y: 50,
      width: 50,
      height: 50,
    });
  });

  it("keeps number badges inside the 9:16 frame", () => {
    const clamped = clampNumberBounds({ x: 99, y: 99, size: 50 });
    expect(clamped.size).toBe(40);
    expect(clamped.x).toBeLessThanOrEqual(60);
    expect(clamped.y).toBeLessThanOrEqual(100 - clamped.size * (9 / 16));
  });

  it("scales a box around its center then clamps", () => {
    const scaled = scaleBox({ x: 40, y: 40, width: 20, height: 20 }, 2);
    expect(scaled.width).toBe(40);
    expect(scaled.height).toBe(40);
    expect(scaled.x).toBe(30);
    expect(scaled.y).toBe(30);
  });

  it("maps inclusive grid cells to percent of the reel", () => {
    expect(matrixToPercents([0, 0, 0, 0])).toEqual({
      left: 0,
      top: 0,
      width: CELL_WIDTH,
      height: CELL_HEIGHT,
    });
    expect(matrixToPercents([0, 1])).toEqual(matrixToPercents([0, 1, 0, 1]));
    expect(matrixToPercents([2, 1, 15, 3])).toEqual({
      left: 2 * CELL_WIDTH,
      top: 1 * CELL_HEIGHT,
      width: 14 * CELL_WIDTH,
      height: 3 * CELL_HEIGHT,
    });
    expect(
      percentsToMatrix({
        left: 2 * CELL_WIDTH,
        top: 1 * CELL_HEIGHT,
        width: 14 * CELL_WIDTH,
        height: 3 * CELL_HEIGHT,
      }),
    ).toEqual([2, 1, 15, 3]);
  });

  it("uses number size when present instead of matrix width", () => {
    expect(
      numberBadgeSize({
        id: "n",
        type: "number",
        matrix: [0, 0, 1, 1],
        size: 6,
        value: 1,
        colorTheme: "ink",
        time: { start: 0, end: 1, track: 0 },
      }),
    ).toBe(6);
    expect(
      numberBadgeSize({
        id: "n",
        type: "number",
        matrix: [0, 0],
        value: 1,
        colorTheme: "ink",
        time: { start: 0, end: 1, track: 0 },
      }),
    ).toBeCloseTo(CELL_WIDTH, 5);
  });

  it("keeps number size steps of 1 percent without snapping to a full column", () => {
    const matrix = percentsToNumberMatrix({
      left: 0,
      top: 0,
      width: 12,
      height: 12,
    });
    expect(matrixToPercents(matrix).width).toBeCloseTo(12, 2);
    expect(
      matrixToPercents(
        percentsToMatrix({ left: 0, top: 0, width: 12, height: 12 }),
      ).width,
    ).toBeCloseTo(CELL_WIDTH * 2, 5);
  });

  it("builds arrow endpoints that do not sit on box centers", () => {
    const source = {
      id: "a",
      type: "box" as const,
      matrix: [2, 3, 5, 5] as const,
      label: "A",
      colorTheme: "ink" as const,
      time: { start: 0, end: 10, track: 0 },
    };
    const target = {
      ...source,
      id: "b",
      matrix: [2, 16, 5, 18] as const,
      label: "B",
    };
    const geom = getArrowGeometry(source, target);
    const sourceRect = matrixToPercents(source.matrix);
    const targetRect = matrixToPercents(target.matrix);
    expect(geom).not.toBeNull();
    expect(geom!.y1).toBeGreaterThan(sourceRect.top);
    expect(geom!.y2).toBeLessThan(targetRect.top + targetRect.height);
  });

  it("clamps box font size", () => {
    expect(clampBoxFontSize(3)).toBe(10);
    expect(clampBoxFontSize(99)).toBe(48);
  });
});

describe("element labels and zoom keys", () => {
  it("labels boxes, numbers, and arrows", () => {
    expect(
      getElementLabel({
        id: "b",
        type: "box",
        matrix: [0, 0, 1, 3],
        label: "API Gateway",
        colorTheme: "violet",
        time: { start: 0, end: 10, track: 0 },
      }),
    ).toBe("API Gateway");
    expect(
      getElementLabel({
        id: "n",
        type: "number",
        matrix: [0, 0],
        value: 2,
        colorTheme: "ink",
        time: { start: 0, end: 10, track: 0 },
      }),
    ).toBe("2");
    expect(
      getElementLabel({
        id: "a",
        type: "arrow",
        sourceId: "api-gateway",
        targetId: "lambda",
        time: { start: 0, end: 10, track: 0 },
      }),
    ).toBe("api-gateway → lambda");
  });

  it("treats +/= and -/_ as zoom keys", () => {
    expect(isZoomInKey({ key: "=", ctrlKey: false, metaKey: false })).toBe(true);
    expect(isZoomOutKey({ key: "-", ctrlKey: false, metaKey: false })).toBe(true);
    expect(isZoomKey({ key: "a", ctrlKey: false, metaKey: false })).toBe(false);
  });
});
