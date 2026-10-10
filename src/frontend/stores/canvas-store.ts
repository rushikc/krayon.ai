import { create } from "zustand";

import { clamp } from "@/components/editor/timeline/lib/clamp";
import { cutElementsAtTime } from "@/components/editor/timeline/lib/cutAtTime";
import editorTimelineJson from "@/data/editor-timeline.json";
import { parseCanvasElementsJson } from "@/lib/parse-canvas-json";
import type { RenderTheme } from "@/lib/render-theme";
import {
  durationFromElements,
  lastVisibleTime,
  reelDuration,
} from "@/lib/reel-duration";
import {
  getStoredRenderTheme,
  persistRenderTheme,
} from "@/lib/workspace-chrome";
import type { CanvasElement } from "@/types/canvas";

export {
  durationFromElements,
  lastVisibleTime,
  reelDuration,
} from "@/lib/reel-duration";

import {
  popTimelineHistoryRedo,
  popTimelineHistoryUndo,
  recordTimelineHistory,
  resetTimelineHistory,
  runWithTimelineHistoryRestore,
  type TimelineHistorySnapshot,
} from "./timeline-history";

interface CanvasState {
  elements: CanvasElement[];
  selectedId: string | null;
  duration: number;
  previewAudioDuration: number | null;
  currentTime: number;
  isPlaying: boolean;
  trackCount: number;
  renderTheme: RenderTheme;
  setElements: (elements: CanvasElement[]) => void;
  setPreviewAudioDuration: (duration: number | null) => void;
  selectElement: (id: string | null) => void;
  updateElement: (id: string, patch: Partial<CanvasElement>) => void;
  setCurrentTime: (time: number) => void;
  setRenderTheme: (theme: RenderTheme) => void;
  play: () => void;
  pause: () => void;
  togglePlayback: () => void;
  addTrack: () => void;
  deleteTrack: (index: number) => void;
  deleteSelectedElement: () => void;
  cutAtPlayhead: () => void;
  undo: () => void;
  redo: () => void;
  reset: () => void;
}

export const DEFAULT_TRACK_COUNT = 10;

const parsedSeed = parseCanvasElementsJson(JSON.stringify(editorTimelineJson));
if (!parsedSeed.ok) {
  throw new Error(`Invalid editor-timeline.json: ${parsedSeed.error}`);
}
const seedElements = parsedSeed.elements;

function snapshotOf(state: {
  elements: CanvasElement[];
  selectedId: string | null;
  trackCount: number;
}): TimelineHistorySnapshot {
  return {
    elements: state.elements,
    selectedId: state.selectedId,
    trackCount: state.trackCount,
  };
}

function commitElements(
  get: () => CanvasState,
  elements: CanvasElement[],
  extra: Partial<CanvasState> = {},
): Partial<CanvasState> {
  const previewAudioDuration =
    extra.previewAudioDuration !== undefined
      ? extra.previewAudioDuration
      : get().previewAudioDuration;
  const duration = reelDuration(elements, previewAudioDuration);
  return {
    elements,
    duration,
    currentTime: clamp(get().currentTime, 0, lastVisibleTime(duration)),
    ...extra,
  };
}

export const useCanvasStore = create<CanvasState>((set, get) => ({
  elements: structuredClone(seedElements),
  selectedId: null,
  duration: durationFromElements(seedElements),
  previewAudioDuration: null,
  currentTime: 0,
  isPlaying: false,
  trackCount: DEFAULT_TRACK_COUNT,
  renderTheme: getStoredRenderTheme(),

  setElements: (elements) => {
    recordTimelineHistory(snapshotOf(get()));
    set(commitElements(get, elements));
  },

  setPreviewAudioDuration: (audioDuration) => {
    set(
      commitElements(get, get().elements, {
        previewAudioDuration: audioDuration,
      }),
    );
  },

  selectElement: (id) => set({ selectedId: id }),

  updateElement: (id, patch) => {
    recordTimelineHistory(snapshotOf(get()));
    const elements = get().elements.map((element) => {
      if (element.id !== id) {
        return element;
      }

      return {
        ...element,
        ...patch,
        id: element.id,
        type: element.type,
      } as CanvasElement;
    });
    set(commitElements(get, elements));
  },

  setCurrentTime: (time) => {
    const { duration } = get();
    set({ currentTime: clamp(time, 0, lastVisibleTime(duration)) });
  },

  setRenderTheme: (theme) => {
    persistRenderTheme(theme);
    set({ renderTheme: theme });
  },

  play: () => {
    const { currentTime, duration } = get();
    set({
      currentTime:
        currentTime >= lastVisibleTime(duration) ? 0 : currentTime,
      isPlaying: true,
    });
  },

  pause: () => set({ isPlaying: false }),

  togglePlayback: () => {
    if (get().isPlaying) {
      get().pause();
    } else {
      get().play();
    }
  },

  addTrack: () => {
    recordTimelineHistory(snapshotOf(get()));
    set({ trackCount: get().trackCount + 1 });
  },

  deleteTrack: (index) => {
    const { trackCount, elements, selectedId } = get();
    if (trackCount <= 1 || index < 0 || index >= trackCount) {
      return;
    }

    recordTimelineHistory(snapshotOf(get()));

    const removedIds = new Set(
      elements.filter((el) => el.time.track === index).map((el) => el.id),
    );
    const nextElements = elements
      .filter((el) => el.time.track !== index)
      .map((el) =>
        el.time.track > index
          ? { ...el, time: { ...el.time, track: el.time.track - 1 } }
          : el,
      );

    set(
      commitElements(get, nextElements, {
        trackCount: trackCount - 1,
        selectedId:
          selectedId && removedIds.has(selectedId) ? null : selectedId,
      }),
    );
  },

  deleteSelectedElement: () => {
    const { selectedId, elements } = get();
    if (!selectedId) {
      return;
    }
    recordTimelineHistory(snapshotOf(get()));
    set(
      commitElements(get, elements.filter((element) => element.id !== selectedId), {
        selectedId: null,
      }),
    );
  },

  cutAtPlayhead: () => {
    const { elements, currentTime } = get();
    const result = cutElementsAtTime(elements, currentTime);
    if (result.splitIds.length === 0) {
      return;
    }
    recordTimelineHistory(snapshotOf(get()));
    set(
      commitElements(get, result.elements, {
        selectedId: result.splitIds[0] ?? null,
      }),
    );
  },

  undo: () => {
    const previous = popTimelineHistoryUndo(snapshotOf(get()));
    if (!previous) {
      return;
    }
    runWithTimelineHistoryRestore(() => {
      set(
        commitElements(get, previous.elements, {
          selectedId: previous.selectedId,
          trackCount: previous.trackCount,
        }),
      );
    });
  },

  redo: () => {
    const next = popTimelineHistoryRedo(snapshotOf(get()));
    if (!next) {
      return;
    }
    runWithTimelineHistoryRestore(() => {
      set(
        commitElements(get, next.elements, {
          selectedId: next.selectedId,
          trackCount: next.trackCount,
        }),
      );
    });
  },

  reset: () => {
    resetTimelineHistory();
    persistRenderTheme("bright");
    set({
      ...commitElements(get, structuredClone(seedElements), {
        selectedId: null,
        isPlaying: false,
        trackCount: DEFAULT_TRACK_COUNT,
        renderTheme: "bright",
        previewAudioDuration: null,
      }),
      currentTime: 0,
    });
  },
}));
