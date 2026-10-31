import { useEffect, useMemo, useRef, useState } from "react";

import { ClipPlayerCard } from "@/components/player/ClipPlayerCard";
import { Button } from "@/components/ui/button";
import type { StudioClip, StudioGroup } from "@/lib/api/studio-client";
import { audioUrl, outputUrl, sourceUrl } from "@/lib/api/studio-client";
import { formatDuration, formatSize, formatTimestamp } from "@/lib/format";
import { takeLabelFromId } from "@/lib/studio-clip";
import { studioCopy } from "@/lib/studio-copy";
import { toast } from "@/stores/toast-store";
import { cn } from "@/lib/utils";

export type PreviewTab = "clip" | "render" | "source";

export type RenderManifest = {
  name: string;
  quality?: string;
  duration?: number;
  size?: number;
  createdAt?: string | null;
  outputPath?: string;
};

export function StudioPreviewPanel({
  slug,
  clip,
  groups,
  pad,
  tab,
  onTabChange,
  conflictError,
  renders,
  activeRenderName,
  onSelectRender,
  onAccept,
  onReject,
  onPrev,
  onNext,
  autoPlayToken,
  playingRef,
}: {
  slug: string;
  clip: StudioClip | null;
  groups: StudioGroup[];
  pad: number;
  tab: PreviewTab;
  onTabChange: (tab: PreviewTab) => void;
  conflictError: string | null;
  renders: RenderManifest[];
  activeRenderName: string | null;
  onSelectRender: (name: string) => void;
  onAccept: () => void;
  onReject: () => void;
  onPrev: () => void;
  onNext: () => void;
  autoPlayToken: number;
  playingRef: React.MutableRefObject<boolean>;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const handledAutoPlay = useRef(0);
  const [rawOpen, setRawOpen] = useState(false);
  const src = clip ? audioUrl(slug, clip.id, pad) : "";
  const selectedRender = renders.find((item) => item.name === activeRenderName) ?? renders[0] ?? null;

  useEffect(() => {
    playingRef.current = isPlaying && tab === "clip";
  }, [isPlaying, playingRef, tab]);

  useEffect(() => {
    setIsPlaying(false);
    setCurrentTime(0);
    handledAutoPlay.current = 0;
  }, [clip?.id]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || autoPlayToken <= handledAutoPlay.current) return;
    handledAutoPlay.current = autoPlayToken;
    if (audio.paused) {
      void audio.play().then(() => setIsPlaying(true)).catch(() => setIsPlaying(false));
    } else {
      audio.pause();
      setIsPlaying(false);
    }
  }, [autoPlayToken, src]);

  const mates = useMemo(() => {
    if (!clip) return [];
    const group = groups.find((item) => item.id === clip.groupId);
    return (group?.clipIds ?? []).filter((id) => id !== clip.id);
  }, [clip, groups]);

  const togglePlay = async () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      await audio.play();
      setIsPlaying(true);
    } else {
      audio.pause();
      setIsPlaying(false);
    }
  };

  const seek = (value: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = value;
    setCurrentTime(value);
  };

  const copyClip = async () => {
    if (!clip) return;
    try {
      await navigator.clipboard.writeText(`${clip.id}\n${clip.text}`);
      toast(studioCopy.copySentence);
    } catch {
      toast("Could not copy");
    }
  };

  const copyJson = async () => {
    if (!clip) return;
    await navigator.clipboard.writeText(JSON.stringify(clip, null, 2));
    toast(studioCopy.copyJson);
  };

  const tabs: Array<{ id: PreviewTab; label: string }> = [
    { id: "clip", label: studioCopy.clipAudio },
    { id: "render", label: studioCopy.renderedVideo },
    { id: "source", label: studioCopy.fullVideo },
  ];

  return (
    <main className="flex min-w-0 flex-1 flex-col bg-background">
      <div className="flex flex-wrap gap-1 border-b border-border px-4 py-2" data-testid="preview-tabs">
        {tabs.map((item) => (
          <Button
            key={item.id}
            type="button"
            size="xs"
            variant={tab === item.id ? "default" : "outline"}
            onClick={() => onTabChange(item.id)}
          >
            {item.label}
          </Button>
        ))}
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-auto">
        {tab === "clip" ? (
          <div className="flex flex-1 flex-col items-center gap-4 p-6">
            {clip ? (
              <>
                <ClipPlayerCard
                  takeLabel={takeLabelFromId(clip.id)}
                  text={clip.text}
                  copyDisabled={!clip.text.trim()}
                  onCopy={() => void copyClip()}
                  copyTooltip={studioCopy.copySentence}
                  copyAriaLabel={studioCopy.copySentence}
                  srcReady={Boolean(src)}
                  currentTime={currentTime}
                  duration={clip.duration || duration}
                  isPlaying={isPlaying}
                  onSeek={seek}
                  onTogglePlay={() => void togglePlay()}
                  audio={
                    <audio
                      ref={audioRef}
                      key={src}
                      src={src}
                      className="hidden"
                      onLoadedMetadata={(event) => {
                        setDuration(event.currentTarget.duration);
                        setCurrentTime(0);
                      }}
                      onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
                      onPlay={() => setIsPlaying(true)}
                      onPause={() => setIsPlaying(false)}
                      onEnded={() => setIsPlaying(false)}
                    />
                  }
                />
                <div className="flex w-full max-w-3xl flex-col gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      variant={clip.status === "selected" ? "default" : "outline"}
                      aria-pressed={clip.status === "selected"}
                      onClick={onAccept}
                    >
                      {studioCopy.accept}
                    </Button>
                    <Button
                      type="button"
                      variant={clip.status === "rejected" ? "destructive" : "outline"}
                      aria-pressed={clip.status === "rejected"}
                      onClick={onReject}
                    >
                      {studioCopy.reject}
                    </Button>
                    <span className="text-xs text-muted-foreground" data-testid="status-badge">
                      {clip.status === "selected"
                        ? studioCopy.accepted
                        : clip.status === "rejected"
                          ? studioCopy.rejected
                          : studioCopy.undecided}
                      {" · "}
                      {clip.decidedBy}
                      {clip.statusAt ? ` · ${new Date(clip.statusAt).toLocaleString()}` : ""}
                    </span>
                  </div>
                  {conflictError ? <p className="text-xs text-destructive">{conflictError}</p> : null}
                  <div className="flex gap-2">
                    <Button type="button" variant="outline" size="sm" onClick={onPrev}>
                      {studioCopy.previousClip}
                    </Button>
                    <Button type="button" variant="outline" size="sm" onClick={onNext}>
                      {studioCopy.nextClip}
                    </Button>
                  </div>
                  {clip.words.length > 0 ? (
                    <div className="flex flex-wrap gap-1 text-xs">
                      {clip.words.map((word, index) => (
                        <button
                          key={`${word.start}-${index}`}
                          type="button"
                          className="rounded bg-muted px-1 py-0.5 hover:bg-primary/15"
                          onClick={() => seek(Math.max(0, word.start - clip.sourceStart))}
                        >
                          {word.text}
                        </button>
                      ))}
                    </div>
                  ) : null}
                  <section className="rounded-xl border border-border bg-card/50 p-4 text-xs" data-testid="clip-data">
                    <p className="mb-2 text-sm font-medium">{studioCopy.clipData}</p>
                    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                      <dt className="text-muted-foreground">label</dt>
                      <dd>{clip.label}</dd>
                      <dt className="text-muted-foreground">score</dt>
                      <dd>{clip.score}</dd>
                      <dt className="text-muted-foreground">reasons</dt>
                      <dd>{clip.reasons.join(", ") || "—"}</dd>
                      <dt className="text-muted-foreground">groupId</dt>
                      <dd>{clip.groupId}</dd>
                      <dt className="text-muted-foreground">group mates</dt>
                      <dd>{mates.join(" ") || "—"}</dd>
                      <dt className="text-muted-foreground">note</dt>
                      <dd>{clip.note || "—"}</dd>
                      <dt className="text-muted-foreground">decidedBy</dt>
                      <dd>{clip.decidedBy}</dd>
                      <dt className="text-muted-foreground">statusReason</dt>
                      <dd>{clip.statusReason || "—"}</dd>
                      <dt className="text-muted-foreground">source</dt>
                      <dd>
                        {formatTimestamp(clip.sourceStart)}–{formatTimestamp(clip.sourceEnd)}
                      </dd>
                      <dt className="text-muted-foreground">parentIds</dt>
                      <dd>{clip.parentIds.join(" ") || "—"}</dd>
                      {Object.entries(clip.llm ?? {}).map(([key, value]) => (
                        <div key={key} className="contents">
                          <dt className="text-muted-foreground">llm.{key}</dt>
                          <dd>{typeof value === "string" ? value : JSON.stringify(value)}</dd>
                        </div>
                      ))}
                    </dl>
                    <button type="button" className="mt-2 underline" onClick={() => setRawOpen((open) => !open)}>
                      {studioCopy.rawJson}
                    </button>
                    {rawOpen ? (
                      <pre className="mt-2 max-h-48 overflow-auto rounded bg-muted p-2">{JSON.stringify(clip, null, 2)}</pre>
                    ) : null}
                    <Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => void copyJson()}>
                      {studioCopy.copyJson}
                    </Button>
                  </section>
                </div>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">{studioCopy.noClipSelected}</p>
            )}
          </div>
        ) : null}
        {tab === "render" ? (
          <div className="flex flex-1 flex-col gap-3 p-6" data-testid="rendered-video">
            {selectedRender ? (
              <>
                <video className="max-h-[70vh] w-full bg-black" src={outputUrl(slug, selectedRender.name)} controls />
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span>{selectedRender.name}</span>
                  <span>{selectedRender.quality}</span>
                  <span>{formatDuration(selectedRender.duration)}</span>
                  <span>{selectedRender.size ? formatSize(selectedRender.size) : ""}</span>
                  <span>{selectedRender.createdAt ?? ""}</span>
                  <select
                    className="rounded-md border border-input bg-background px-2 py-1"
                    value={selectedRender.name}
                    onChange={(event) => onSelectRender(event.target.value)}
                  >
                    {renders.map((item) => (
                      <option key={item.name} value={item.name}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                </div>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">No renders yet.</p>
            )}
          </div>
        ) : null}
        {tab === "source" ? (
          <div className="flex flex-1 flex-col p-6">
            <video className="max-h-[80vh] w-full bg-black" src={sourceUrl(slug)} controls />
          </div>
        ) : null}
      </div>
    </main>
  );
}

export function previewTabClass(active: boolean) {
  return cn(active ? "bg-primary text-primary-foreground" : "");
}
