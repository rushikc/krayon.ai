import { create } from "zustand";

import * as reelClient from "@/lib/api/reel-client";
import { ApiError } from "@/lib/api/reel-client";
import { getGeminiApiKey } from "@/lib/gemini-key";
import { parseCanvasElementsJson } from "@/lib/parse-canvas-json";
import {
  getStoredMaxRounds,
  getStoredModelOverrides,
  getStoredThreadJobIds,
  modelsForRequest,
  persistMaxRounds,
  persistModelOverrides,
  persistThreadJobIds,
  type ChatModelOverrides,
} from "@/lib/reel-chat-settings";
import { persistWorkspaceSideView } from "@/lib/workspace-chrome";
import { useCanvasStore } from "@/stores/canvas-store";
import { toast } from "@/stores/toast-store";
import {
  KEY_ERROR_CODES,
  isTerminalJobStatus,
  type ErrorCode,
  type JobState,
  type JobSummary,
} from "@/types/reel-pipeline";

const subscriptions = new Map<string, () => void>();

export type PendingSend = {
  text: string;
  forceNewScript: boolean;
};

interface ReelChatState {
  healthOk: boolean | null;
  jobIds: string[];
  jobsById: Record<string, JobState>;
  historyJobs: JobSummary[];
  maxRounds: number;
  models: ChatModelOverrides;
  keyDialogOpen: boolean;
  pendingSend: PendingSend | null;
  hydrating: boolean;
  checkHealth: () => Promise<void>;
  hydrate: () => Promise<void>;
  refreshHistory: () => Promise<void>;
  setMaxRounds: (value: number) => void;
  setModels: (models: ChatModelOverrides) => void;
  setKeyDialogOpen: (open: boolean) => void;
  newChat: () => void;
  loadJobFromHistory: (id: string) => Promise<void>;
  send: (text: string, options?: { forceNewScript?: boolean }) => Promise<void>;
  continuePendingSend: () => Promise<void>;
  cancelActive: () => Promise<void>;
  retryJob: (jobId: string) => Promise<void>;
  applyRound: (jobId: string, round: number) => boolean;
}

function completedJobId(jobsById: Record<string, JobState>, jobIds: string[]): string | null {
  for (let i = jobIds.length - 1; i >= 0; i -= 1) {
    const job = jobsById[jobIds[i]];
    if (job?.status === "done" && job.result?.scene) {
      return job.id;
    }
  }
  return null;
}

function runningJobId(jobsById: Record<string, JobState>, jobIds: string[]): string | null {
  for (let i = jobIds.length - 1; i >= 0; i -= 1) {
    const job = jobsById[jobIds[i]];
    if (job && (job.status === "queued" || job.status === "running")) {
      return job.id;
    }
  }
  return null;
}

function upsertJob(jobsById: Record<string, JobState>, job: JobState): Record<string, JobState> {
  return { ...jobsById, [job.id]: job };
}

function appendJobId(jobIds: string[], id: string): string[] {
  if (jobIds.includes(id)) {
    return jobIds;
  }
  return [...jobIds, id];
}

function rememberJob(jobIds: string[], id: string): string[] {
  const next = appendJobId(jobIds, id);
  persistThreadJobIds(next);
  return next;
}

function subscribeJob(jobId: string) {
  subscriptions.get(jobId)?.();
  const stop = reelClient.subscribeToJob(jobId, {
    onJob: (job) => {
      useReelChatStore.setState((state) => ({
        jobsById: upsertJob(state.jobsById, job),
        jobIds: rememberJob(state.jobIds, job.id),
      }));
    },
  });
  subscriptions.set(jobId, stop);
}

function unsubscribeAll() {
  for (const stop of subscriptions.values()) {
    stop();
  }
  subscriptions.clear();
}

function isKeyError(error: unknown): error is ApiError {
  return error instanceof ApiError && KEY_ERROR_CODES.includes(error.code as ErrorCode);
}

export function getRunningJobId(): string | null {
  const { jobsById, jobIds } = useReelChatStore.getState();
  return runningJobId(jobsById, jobIds);
}

export const useReelChatStore = create<ReelChatState>((set, get) => ({
  healthOk: null,
  jobIds: getStoredThreadJobIds(),
  jobsById: {},
  historyJobs: [],
  maxRounds: getStoredMaxRounds(),
  models: getStoredModelOverrides(),
  keyDialogOpen: false,
  pendingSend: null,
  hydrating: false,

  checkHealth: async () => {
    try {
      const result = await reelClient.health();
      set({ healthOk: result.ok === true });
    } catch {
      set({ healthOk: false });
    }
  },

  hydrate: async () => {
    if (get().hydrating) {
      return;
    }
    set({ hydrating: true });
    await get().checkHealth();
    const ids = getStoredThreadJobIds();
    const jobsById: Record<string, JobState> = {};
    for (const id of ids) {
      try {
        const job = await reelClient.getJob(id);
        jobsById[id] = job;
        if (!isTerminalJobStatus(job.status)) {
          subscribeJob(job.id);
        }
      } catch {
        // drop missing jobs from the thread
      }
    }
    const nextIds = ids.filter((id) => jobsById[id]);
    persistThreadJobIds(nextIds);
    set({ jobIds: nextIds, jobsById, hydrating: false });
  },

  refreshHistory: async () => {
    try {
      const jobs = await reelClient.listJobs();
      const sorted = [...jobs].sort(
        (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt),
      );
      set({ historyJobs: sorted });
    } catch {
      set({ historyJobs: [] });
    }
  },

  setMaxRounds: (value) => {
    const next = Math.min(4, Math.max(1, Math.round(value)));
    persistMaxRounds(next);
    set({ maxRounds: next });
  },

  setModels: (models) => {
    persistModelOverrides(models);
    set({ models });
  },

  setKeyDialogOpen: (open) => set({ keyDialogOpen: open }),

  newChat: () => {
    unsubscribeAll();
    persistThreadJobIds([]);
    set({ jobIds: [], jobsById: {}, pendingSend: null });
  },

  loadJobFromHistory: async (id) => {
    try {
      const job = await reelClient.getJob(id);
      unsubscribeAll();
      const chain: JobState[] = [job];
      let parentId = job.parentJobId;
      while (parentId) {
        try {
          const parent = await reelClient.getJob(parentId);
          chain.unshift(parent);
          parentId = parent.parentJobId;
        } catch {
          break;
        }
      }
      const jobsById: Record<string, JobState> = {};
      const jobIds: string[] = [];
      for (const item of chain) {
        jobsById[item.id] = item;
        jobIds.push(item.id);
        if (!isTerminalJobStatus(item.status)) {
          subscribeJob(item.id);
        }
      }
      persistThreadJobIds(jobIds);
      set({ jobsById, jobIds });
    } catch {
      toast("Could not load that job");
    }
  },

  send: async (text, options) => {
    const trimmed = text.trim();
    if (!trimmed) {
      return;
    }
    if (!getGeminiApiKey()) {
      set({
        keyDialogOpen: true,
        pendingSend: { text: trimmed, forceNewScript: options?.forceNewScript ?? false },
      });
      return;
    }
    if (getRunningJobId()) {
      return;
    }
    const { maxRounds, models, jobsById, jobIds } = get();
    const parentId =
      options?.forceNewScript ? null : completedJobId(jobsById, jobIds);
    const modelOverrides = modelsForRequest(models);
    try {
      if (parentId) {
        const created = await reelClient.refineJob(parentId, {
          instructions: trimmed,
          maxRounds,
          models: modelOverrides,
        });
        const job = await reelClient.getJob(created.jobId);
        set((state) => ({
          jobsById: upsertJob(state.jobsById, job),
          jobIds: rememberJob(state.jobIds, job.id),
          pendingSend: null,
        }));
        subscribeJob(job.id);
        return;
      }
      const created = await reelClient.createJob({
        script: trimmed,
        maxRounds,
        models: modelOverrides,
      });
      const job = await reelClient.getJob(created.jobId);
      set((state) => ({
        jobsById: upsertJob(state.jobsById, job),
        jobIds: rememberJob(state.jobIds, job.id),
        pendingSend: null,
      }));
      subscribeJob(job.id);
    } catch (error) {
      if (isKeyError(error)) {
        set({
          keyDialogOpen: true,
          pendingSend: { text: trimmed, forceNewScript: options?.forceNewScript ?? false },
        });
        return;
      }
      toast(error instanceof Error ? error.message : "Could not start the job");
    }
  },

  continuePendingSend: async () => {
    const pending = get().pendingSend;
    if (!pending) {
      return;
    }
    set({ keyDialogOpen: false });
    await get().send(pending.text, { forceNewScript: pending.forceNewScript });
  },

  cancelActive: async () => {
    const id = getRunningJobId();
    if (!id) {
      return;
    }
    try {
      await reelClient.cancelJob(id);
    } catch (error) {
      toast(error instanceof Error ? error.message : "Could not cancel");
    }
  },

  retryJob: async (jobId) => {
    const job = get().jobsById[jobId];
    if (!job) {
      return;
    }
    if (job.refineInstructions) {
      await get().send(job.refineInstructions);
      return;
    }
    await get().send(job.script, { forceNewScript: true });
  },

  applyRound: (jobId, round) => {
    const job = get().jobsById[jobId];
    if (!job) {
      return false;
    }
    const scene =
      job.rounds.find((item) => item.n === round)?.scene ??
      (job.result?.round === round ? job.result.scene : undefined);
    if (!scene) {
      toast("That round has no scene to apply");
      return false;
    }
    const parsed = parseCanvasElementsJson(JSON.stringify(scene));
    if (!parsed.ok) {
      toast(parsed.error);
      return false;
    }
    useCanvasStore.getState().setElements(parsed.elements);
    useCanvasStore.getState().selectElement(null);
    useCanvasStore.getState().setCurrentTime(0);
    persistWorkspaceSideView("timeline");
    toast(`Applied round ${round}. Undo available`);
    return true;
  },
}));
