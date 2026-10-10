import {
  ArrowLeft,
  Copy,
  Download,
  Eye,
  Layers,
  SlidersHorizontal,
  Smartphone,
  Upload,
  type LucideIcon,
} from "lucide-react";
import { useRef, useState, type ChangeEvent, type ReactNode } from "react";
import { Link } from "react-router-dom";

import { getCanvasDesign } from "@/components/canvas/designs";
import {
  Dialog,
  DialogBackdrop,
  DialogPopup,
  DialogPortal,
  DialogTitle,
} from "@/components/ui/dialog";
import { PREVIEW_AUDIO_ACCEPT } from "@/lib/preview-audio";
import { RENDER_THEMES, type RenderTheme } from "@/lib/render-theme";
import { cn } from "@/lib/utils";
import { toast } from "@/stores/toast-store";

const THEME_SWATCH: Record<RenderTheme, string> = {
  bright: "bg-[#c9a0f0]",
  dark: "bg-[#4b3a6d]",
  "calidraw-light": "bg-white",
  "calidraw-dark": "bg-[#1a1a1a]",
  canary: "bg-black",
};

export interface WorkspaceToolbarProps {
  showTimeline: boolean;
  showEditor: boolean;
  showReelPreview: boolean;
  onToggleTimeline: () => void;
  onToggleEditor: () => void;
  onToggleReelPreview: () => void;
  renderTheme: RenderTheme;
  onRenderThemeChange: (theme: RenderTheme) => void;
  exporting: boolean;
  onExport: () => void;
  onUploadAudio: (file: File) => void;
}

export function WorkspaceToolbar({
  showTimeline,
  showEditor,
  showReelPreview,
  onToggleTimeline,
  onToggleEditor,
  onToggleReelPreview,
  renderTheme,
  onRenderThemeChange,
  exporting,
  onExport,
  onUploadAudio,
}: WorkspaceToolbarProps) {
  const audioInputRef = useRef<HTMLInputElement>(null);
  const [promptOpen, setPromptOpen] = useState(false);
  const design = getCanvasDesign(renderTheme);
  const themeLabel =
    RENDER_THEMES.find((theme) => theme.id === renderTheme)?.label ??
    renderTheme;

  const copyPrompt = () => {
    void navigator.clipboard.writeText(design.skill).then(
      () => toast(`Copied ${themeLabel} prompt`),
      () => toast("Could not copy prompt"),
    );
  };

  const onAudioFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) {
      onUploadAudio(file);
    }
  };

  return (
    <div className="flex h-11 shrink-0 items-center gap-2 overflow-x-auto border-b border-border bg-card px-2">
      <Link
        to="/"
        className="flex shrink-0 items-center gap-1.5 px-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" />
        Back to home
      </Link>

      <span aria-hidden className="h-5 w-px shrink-0 bg-border" />

      <SegmentGroup label="Panels">
        <Segment
          label="Timeline"
          icon={Layers}
          active={showTimeline}
          onClick={onToggleTimeline}
        />
        <Segment
          label="Editor"
          icon={SlidersHorizontal}
          active={showEditor}
          onClick={onToggleEditor}
        />
        <Segment
          label="Reel preview"
          icon={Smartphone}
          active={showReelPreview}
          onClick={onToggleReelPreview}
        />
      </SegmentGroup>

      <span aria-hidden className="h-5 w-px shrink-0 bg-border" />

      <SegmentGroup label="Canvas skin">
        {RENDER_THEMES.map((theme) => (
          <Segment
            key={theme.id}
            label={theme.label}
            swatch={THEME_SWATCH[theme.id]}
            active={renderTheme === theme.id}
            onClick={() => onRenderThemeChange(theme.id)}
          />
        ))}
      </SegmentGroup>

      <div className="ml-auto flex shrink-0 items-center gap-2">
        <input
          ref={audioInputRef}
          type="file"
          accept={PREVIEW_AUDIO_ACCEPT}
          aria-hidden="true"
          tabIndex={-1}
          className="sr-only"
          onChange={onAudioFileChange}
        />
        <button
          type="button"
          onClick={() => setPromptOpen(true)}
          className="flex h-8 shrink-0 items-center rounded-lg border border-border bg-background px-3 text-xs font-medium text-foreground transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          <span className="flex items-center gap-1.5">
            <Eye className="size-3.5" />
            View prompt
          </span>
        </button>
        <button
          type="button"
          onClick={() => audioInputRef.current?.click()}
          className="flex h-8 shrink-0 items-center rounded-lg border border-border bg-background px-3 text-xs font-medium text-foreground transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          <span className="flex items-center gap-1.5">
            <Upload className="size-3.5" />
            Upload audio
          </span>
        </button>
        <button
          type="button"
          disabled={exporting}
          onClick={onExport}
          className="flex h-8 shrink-0 items-center rounded-lg bg-foreground px-3 text-xs font-medium text-background transition-colors hover:bg-foreground/85 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none disabled:cursor-default disabled:hover:bg-foreground"
        >
          <span className="flex items-center gap-1.5">
            <Download className="size-3.5" />
            Export MP4
          </span>
        </button>
      </div>

      <Dialog open={promptOpen} onOpenChange={setPromptOpen}>
        <DialogPortal>
          <DialogBackdrop />
          <DialogPopup className="flex max-h-[85vh] max-w-2xl flex-col gap-3">
            <div className="flex items-center justify-between gap-3">
              <DialogTitle>{themeLabel} prompt</DialogTitle>
              <CopyPromptButton onClick={copyPrompt} />
            </div>
            <div className="max-h-[min(60vh,28rem)] min-h-0 flex-1 overflow-y-auto rounded-lg border border-border bg-muted/40 p-3">
              <pre className="font-sans text-xs leading-relaxed whitespace-pre-wrap text-foreground">
                {design.skill}
              </pre>
            </div>
            <div className="flex justify-end">
              <CopyPromptButton onClick={copyPrompt} />
            </div>
          </DialogPopup>
        </DialogPortal>
      </Dialog>
    </div>
  );
}

function CopyPromptButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-8 shrink-0 items-center rounded-lg border border-border bg-background px-3 text-xs font-medium text-foreground transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
    >
      <span className="flex items-center gap-1.5">
        <Copy className="size-3.5" />
        Copy
      </span>
    </button>
  );
}

function SegmentGroup({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="flex shrink-0 items-center gap-0.5 rounded-lg border border-border bg-background p-0.5"
    >
      {children}
    </div>
  );
}

function Segment({
  label,
  icon: Icon,
  swatch,
  active,
  onClick,
}: {
  label: string;
  icon?: LucideIcon;
  swatch?: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium whitespace-nowrap transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
        active
          ? "bg-primary/10 text-primary"
          : "text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      {Icon ? <Icon className="size-3.5" /> : null}
      {swatch ? (
        <span
          aria-hidden
          className={cn(
            "size-2.5 rounded-full border border-canvas-ink/25",
            swatch,
          )}
        />
      ) : null}
      {label}
    </button>
  );
}
