import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { AppShell } from "@/components/layout/AppShell";
import {
  type StudioClip,
  type StudioProject,
  analyze,
  applyOps,
  audioUrl,
  eventsUrl,
  getProject,
  lintProject,
  outputUrl,
  redo,
  renderStatus,
  restore,
  sourceUrl,
  startRender,
  undo,
} from "@/lib/api/studio-client";
import { describeClips, describeIds } from "@/lib/studio-copy";
import { formatTimestamp } from "@/lib/format";

type PlayTarget =
  | { kind: "clip"; start: number; end: number }
  | { kind: "result"; name: string };

async function copyText(text: string) {
  await navigator.clipboard.writeText(text);
}

export function StudioWorkspace({ slug }: { slug: string }) {
  const [params, setParams] = useSearchParams();
  const [project, setProject] = useState<StudioProject | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ message: string; ratio: number } | null>(null);
  const [warnings, setWarnings] = useState<{ code: string; message: string }[]>([]);
  const [checked, setChecked] = useState<string[]>([]);
  const [anchor, setAnchor] = useState<string | null>(null);
  const [play, setPlay] = useState<PlayTarget | null>(null);
  const [render, setRender] = useState<{ id: string; message: string; ratio: number; outputName?: string } | null>(null);
  const [note, setNote] = useState("");
  const videoRef = useRef<HTMLVideoElement>(null);
  const started = useRef(false);

  async function refresh() {
    const next = await getProject(slug);
    setProject(next);
    const lint = await lintProject(slug).catch(() => ({ warnings: [] }));
    setWarnings(lint.warnings);
    return next;
  }

  useEffect(() => {
    void refresh().catch((err: unknown) => setError(err instanceof Error ? err.message : "Load failed"));
    const source = new EventSource(eventsUrl(slug));
    source.onmessage = (event) => {
      const data = JSON.parse(event.data) as {
        type?: string;
        message?: string;
        ratio?: number;
        renderId?: string;
        outputName?: string;
        phase?: string;
      };
      if (data.type === "progress") {
        setProgress({ message: data.message ?? "", ratio: data.ratio ?? 0 });
      }
      if (data.type === "revision" || data.type === "snapshot") {
        void refresh().catch(() => undefined);
      }
      if (data.type === "render") {
        setRender((current) => ({
          id: data.renderId ?? current?.id ?? "",
          message: data.message ?? "",
          ratio: data.ratio ?? 0,
          outputName: data.outputName ?? current?.outputName,
        }));
        if (data.phase === "done" && data.outputName) {
          setPlay({ kind: "result", name: data.outputName });
        }
      }
    };
    return () => source.close();
    // refresh identity changes every render; the effect should follow the slug only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  useEffect(() => {
    if (!project || started.current) return;
    if (params.get("analyze") === "1" && project.clips.length === 0 && project.meta.sourcePath) {
      started.current = true;
      setParams({}, { replace: true });
      void analyze(slug, project.revision).catch((err: unknown) => setError(err instanceof Error ? err.message : "Analyze failed"));
    }
  }, [params, project, setParams, slug]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || play?.kind !== "clip") return;
    const start = Math.max(0, play.start - 0.35);
    const stop = play.end + 0.35;
    const onTime = () => {
      if (video.currentTime >= stop) video.pause();
    };
    const begin = () => {
      video.currentTime = start;
      void video.play().catch(() => undefined);
    };
    video.addEventListener("timeupdate", onTime);
    if (video.readyState >= 1) begin();
    else video.addEventListener("loadedmetadata", begin, { once: true });
    return () => video.removeEventListener("timeupdate", onTime);
  }, [play]);

  const flat = useMemo(() => {
    if (!project) return [];
    return project.groups.flatMap((group) =>
      group.clipIds
        .map((id) => project.clips.find((clip) => clip.id === id))
        .filter((clip): clip is StudioClip => clip != null),
    );
  }, [project]);

  async function run(ops: Record<string, unknown>[], label: string) {
    if (!project) return;
    setError(null);
    try {
      await applyOps(slug, project.revision, ops, label);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Edit failed");
    }
  }

  function toggle(id: string, shift: boolean) {
    if (shift && anchor) {
      const start = flat.findIndex((clip) => clip.id === anchor);
      const end = flat.findIndex((clip) => clip.id === id);
      if (start >= 0 && end >= 0) {
        const [from, to] = start < end ? [start, end] : [end, start];
        setChecked(flat.slice(from, to + 1).map((clip) => clip.id));
        return;
      }
    }
    setAnchor(id);
    setChecked((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  }

  const focused = project?.clips.find((clip) => clip.id === checked[checked.length - 1]) ?? null;
  const videoSrc = play?.kind === "result" ? outputUrl(slug, play.name) : sourceUrl(slug);

  return (
    <AppShell subtitle="studio" showBack backTo="/studio" backLabel="Projects">
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex items-center gap-3 border-b border-border px-4 py-2 text-xs">
          <Link className="font-medium" to="/studio">
            {project?.meta.title ?? slug}
          </Link>
          <span className="text-muted-foreground">rev {project?.revision ?? "–"}</span>
          <span className="text-muted-foreground">{project?.status}</span>
          {progress ? (
            <span className="text-muted-foreground">
              {progress.message} {Math.round(progress.ratio * 100)}%
            </span>
          ) : null}
          <div className="ml-auto flex gap-2">
            <button className="rounded border border-border px-2 py-1" type="button" onClick={() => void undo(slug).then(refresh)}>
              Undo
            </button>
            <button className="rounded border border-border px-2 py-1" type="button" onClick={() => void redo(slug).then(refresh)}>
              Redo
            </button>
          </div>
        </div>
        {error ? <p className="px-4 py-2 text-xs text-destructive">{error}</p> : null}
        <div className="grid min-h-0 flex-1 grid-cols-[minmax(280px,380px)_1fr]">
          <section className="flex min-h-0 flex-col border-r border-border">
            <div className="flex flex-1 items-center justify-center bg-muted/30 p-4">
              <div className="aspect-[9/16] h-full max-h-full overflow-hidden rounded-lg bg-black">
                <video ref={videoRef} key={videoSrc} className="h-full w-full object-contain" src={videoSrc} controls />
              </div>
            </div>
            <div className="space-y-2 border-t border-border p-3 text-xs">
              <div className="flex gap-1 overflow-x-auto">
                {project?.order.map((id) => (
                  <button
                    key={id}
                    className="shrink-0 rounded bg-primary/15 px-2 py-1"
                    type="button"
                    onClick={() => {
                      const clip = project.clips.find((item) => item.id === id);
                      if (clip) setPlay({ kind: "clip", start: clip.sourceStart, end: clip.sourceEnd });
                    }}
                  >
                    {id}
                  </button>
                ))}
              </div>
              <div className="flex gap-2">
                <button
                  className="rounded border border-border px-2 py-1"
                  type="button"
                  onClick={() => {
                    void startRender(slug, "preview").then((job) => {
                      setRender({ id: job.renderId, message: "Rendering preview", ratio: 0, outputName: job.outputName });
                      const timer = window.setInterval(() => {
                        void renderStatus(slug, job.renderId).then((status) => {
                          setRender({ id: job.renderId, message: status.message, ratio: status.ratio, outputName: status.outputName });
                          if (status.status === "done" || status.status === "error") {
                            window.clearInterval(timer);
                            if (status.outputName) setPlay({ kind: "result", name: status.outputName });
                          }
                        });
                      }, 1000);
                    });
                  }}
                >
                  Preview
                </button>
                <button
                  className="rounded bg-primary px-2 py-1 text-primary-foreground"
                  type="button"
                  onClick={() => {
                    void startRender(slug, "final").then((job) => {
                      setRender({ id: job.renderId, message: "Rendering final", ratio: 0 });
                    });
                  }}
                >
                  Render final
                </button>
              </div>
              {render ? (
                <p className="text-muted-foreground">
                  {render.message} {Math.round((render.ratio ?? 0) * 100)}%
                </p>
              ) : null}
            </div>
          </section>
          <section className="flex min-h-0 flex-col">
            <div className="min-h-0 flex-1 overflow-auto p-3">
              {project?.groups.map((group) => (
                <div key={group.id} className="mb-4">
                  <h3 className="mb-1 text-xs font-medium text-muted-foreground">
                    {group.id}
                    {group.recommendedClipId ? ` · pick ${group.recommendedClipId}` : ""}
                  </h3>
                  <ul className="space-y-1">
                    {group.clipIds.map((id) => {
                      const clip = project.clips.find((item) => item.id === id);
                      if (!clip) return null;
                      return (
                        <li key={clip.id} className="rounded-md border border-border px-2 py-1.5 text-xs">
                          <div className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={checked.includes(clip.id)}
                              onChange={() => undefined}
                              onClick={(event) => toggle(clip.id, event.shiftKey)}
                            />
                            <button className="font-mono text-primary" type="button" onClick={() => void copyText(clip.id)}>
                              {clip.id}
                            </button>
                            <span className="text-muted-foreground">{formatTimestamp(clip.duration)}</span>
                            {clip.label !== "none" ? (
                              <span className="rounded bg-destructive/10 px-1 text-destructive">{clip.label}</span>
                            ) : null}
                            <span className="rounded bg-muted px-1">{clip.status}</span>
                            <span className="ml-auto flex gap-1">
                              <button type="button" className="underline" onClick={() => void run([{ op: "select", clipId: clip.id }], "select")}>
                                Select
                              </button>
                              <button type="button" className="underline" onClick={() => void run([{ op: "reject", clipId: clip.id }], "reject")}>
                                Reject
                              </button>
                              <button
                                type="button"
                                className="underline"
                                onClick={() => setPlay({ kind: "clip", start: clip.sourceStart, end: clip.sourceEnd })}
                              >
                                Play
                              </button>
                            </span>
                          </div>
                          <p className="mt-1">{clip.text}</p>
                          {clip.reasons.length ? <p className="text-muted-foreground">{clip.reasons.join(" · ")}</p> : null}
                          <audio className="mt-1 h-6 w-full" controls src={audioUrl(slug, clip.id, 0.5)} preload="none" />
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
            {checked.length > 0 ? (
              <div className="flex flex-wrap items-center gap-2 border-t border-border px-3 py-2 text-xs">
                <span>{checked.length} selected</span>
                <button type="button" className="rounded border border-border px-2 py-1" onClick={() => void copyText(describeIds(checked))}>
                  Copy ids
                </button>
                <button
                  type="button"
                  className="rounded border border-border px-2 py-1"
                  onClick={() => {
                    const clips = checked
                      .map((id) => project?.clips.find((clip) => clip.id === id))
                      .filter((clip): clip is StudioClip => clip != null);
                    void copyText(describeClips(clips));
                  }}
                >
                  Copy for Grok
                </button>
                <button
                  type="button"
                  className="rounded border border-border px-2 py-1"
                  disabled={checked.length !== 2}
                  onClick={() => void run([{ op: "merge", clipIds: [checked[0], checked[1]] }], "merge")}
                >
                  Merge
                </button>
                <button
                  type="button"
                  className="rounded border border-border px-2 py-1"
                  disabled={checked.length !== 1}
                  onClick={() => {
                    const at = Number(window.prompt("Split at source seconds") ?? "");
                    if (!Number.isFinite(at)) return;
                    void run([{ op: "split", clipId: checked[0], at }], "split");
                  }}
                >
                  Split
                </button>
                <button
                  type="button"
                  className="rounded border border-border px-2 py-1"
                  disabled={checked.length !== 1}
                  onClick={() => {
                    const start = Number(window.prompt("Trim start") ?? "");
                    const end = Number(window.prompt("Trim end") ?? "");
                    if (!Number.isFinite(start) || !Number.isFinite(end)) return;
                    void run([{ op: "trim", clipId: checked[0], start, end }], "trim");
                  }}
                >
                  Trim
                </button>
              </div>
            ) : null}
            <div className="grid grid-cols-2 gap-3 border-t border-border p-3 text-xs">
              <div>
                <p className="mb-1 font-medium">Note {focused ? focused.id : ""}</p>
                <textarea
                  className="h-16 w-full rounded border border-border bg-background p-1"
                  value={focused ? note || focused.note : ""}
                  onChange={(event) => setNote(event.target.value)}
                  onBlur={() => {
                    if (!focused || note === "" || note === focused.note) return;
                    void run([{ op: "note", clipId: focused.id, note }], "note").then(() => setNote(""));
                  }}
                />
              </div>
              <div className="max-h-28 overflow-auto">
                <p className="mb-1 font-medium">Activity</p>
                <ul className="space-y-1">
                  {project?.history.slice().reverse().map((entry) => (
                    <li key={entry.revision} className="flex items-start justify-between gap-2">
                      <span>
                        <span className="text-muted-foreground">{entry.actor}</span> {entry.label}: {entry.summary}
                        {entry.current ? " · current" : ""}
                      </span>
                      {!entry.current ? (
                        <button type="button" className="underline" onClick={() => void restore(slug, entry.revision).then(refresh)}>
                          Restore
                        </button>
                      ) : null}
                    </li>
                  ))}
                </ul>
                {warnings.length ? (
                  <ul className="mt-2 space-y-1 text-muted-foreground">
                    {warnings.map((warning) => (
                      <li key={`${warning.code}-${warning.message}`}>{warning.message}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
            </div>
          </section>
        </div>
      </div>
    </AppShell>
  );
}
