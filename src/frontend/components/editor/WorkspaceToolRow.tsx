import {
  Captions,
  Copy,
  Film,
  Layers,
  MessageSquare,
  Palette,
  Settings,
  Upload,
  Volume2,
  VolumeX,
  ZoomIn,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useRef, useState, type ChangeEvent, type ReactNode } from "react";

import { GeminiKeyDialog } from "@/components/chat/GeminiKeyDialog";
import { getCanvasDesign } from "@/components/canvas/designs";
import { Segment, SegmentGroup } from "@/components/editor/SegmentedControl";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBackdrop,
  DialogPopup,
  DialogPortal,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { PREVIEW_AUDIO_ACCEPT } from "@/lib/preview-audio";
import { RENDER_THEMES, type RenderTheme } from "@/lib/render-theme";
import type { WorkspaceSideView } from "@/lib/workspace-chrome";
import { cn } from "@/lib/utils";
import { toast } from "@/stores/toast-store";
import { useReelChatStore } from "@/stores/reel-chat-store";
import { useThemeStore } from "@/stores/theme-store";

const COMPACT_TOOL_ROW_PX = 900;

const THEME_SWATCH: Record<RenderTheme, string> = {
  bright: "bg-[#c9a0f0]",
  dark: "bg-[#4b3a6d]",
  "calidraw-light": "bg-white",
  "calidraw-dark": "bg-[#1a1a1a]",
  canary: "bg-black",
};

export function WorkspaceToolRow({
  sideView,
  onSideViewChange,
  showReelPreview,
  onToggleReelPreview,
  renderTheme,
  onRenderThemeChange,
  previewAudioMuted,
  onMutedChange,
  onUploadAudio,
}: {
  sideView: WorkspaceSideView;
  onSideViewChange: (view: WorkspaceSideView) => void;
  showReelPreview: boolean;
  onToggleReelPreview: () => void;
  renderTheme: RenderTheme;
  onRenderThemeChange: (theme: RenderTheme) => void;
  previewAudioMuted: boolean;
  onMutedChange: (muted: boolean) => void;
  onUploadAudio: (file: File) => void;
}) {
  const rowRef = useRef<HTMLDivElement>(null);
  const [compact, setCompact] = useState(false);

  useEffect(() => {
    const el = rowRef.current;
    if (!el) {
      return;
    }
    const update = () => setCompact(el.clientWidth < COMPACT_TOOL_ROW_PX);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <TooltipProvider>
      <div
        ref={rowRef}
        className="flex h-11 shrink-0 items-center gap-1 overflow-x-auto border-b border-border bg-card px-2"
      >
        <SegmentGroup label="Workspace view" tabList prominent>
          <Segment
            label="Timeline"
            icon={Layers}
            tab
            prominent
            active={sideView === "timeline"}
            onClick={() => onSideViewChange("timeline")}
          />
          <Segment
            label="Chat"
            icon={MessageSquare}
            tab
            prominent
            active={sideView === "chat"}
            onClick={() => onSideViewChange("chat")}
          />
        </SegmentGroup>

        <span aria-hidden className="mx-1 h-6 w-px shrink-0 bg-border" />

        <CanvasPopover
          compact={compact}
          renderTheme={renderTheme}
          onRenderThemeChange={onRenderThemeChange}
        />
        <ComingSoonButton compact={compact} label="Takes" icon={Film} />
        <ComingSoonButton compact={compact} label="Captions" icon={Captions} />
        <AudioPopover
          compact={compact}
          muted={previewAudioMuted}
          onMutedChange={onMutedChange}
          onUploadAudio={onUploadAudio}
        />
        <ComingSoonButton compact={compact} label="Zoom" icon={ZoomIn} />
        <div className="ml-auto shrink-0">
          <SettingsPopover
            compact={compact}
            showReelPreview={showReelPreview}
            onToggleReelPreview={onToggleReelPreview}
          />
        </div>
      </div>
    </TooltipProvider>
  );
}

function WithCompactTooltip({
  compact,
  label,
  children,
}: {
  compact: boolean;
  label: string;
  children: ReactNode;
}) {
  if (!compact) {
    return children;
  }
  return (
    <Tooltip>
      <TooltipTrigger render={<span className="inline-flex">{children}</span>} />
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function ComingSoonButton({
  label,
  icon: Icon,
  compact,
}: {
  label: string;
  icon: LucideIcon;
  compact: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span className="inline-flex">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled
              aria-label={label}
              className="text-muted-foreground"
            >
              <Icon />
              {compact ? null : (
                <span className="text-xs font-normal">{label}</span>
              )}
            </Button>
          </span>
        }
      />
      <TooltipContent>Coming soon</TooltipContent>
    </Tooltip>
  );
}

function CanvasPopover({
  compact,
  renderTheme,
  onRenderThemeChange,
}: {
  compact: boolean;
  renderTheme: RenderTheme;
  onRenderThemeChange: (theme: RenderTheme) => void;
}) {
  const [promptOpen, setPromptOpen] = useState(false);
  const design = getCanvasDesign(renderTheme);
  const themeLabel =
    RENDER_THEMES.find((theme) => theme.id === renderTheme)?.label ?? renderTheme;

  const copyPrompt = () => {
    void navigator.clipboard.writeText(design.skill).then(
      () => toast(`Copied ${themeLabel} prompt`),
      () => toast("Could not copy prompt"),
    );
  };

  return (
    <>
      <WithCompactTooltip compact={compact} label="Canvas">
        <Popover>
          <PopoverTrigger
            render={
              <Button
                type="button"
                size="sm"
                variant="ghost"
                aria-label="Canvas"
                className="text-muted-foreground"
              />
            }
          >
            <Palette />
            {compact ? null : (
              <span className="text-xs font-normal">Canvas</span>
            )}
          </PopoverTrigger>
          <PopoverContent align="start" className="w-64">
            <p className="text-xs font-medium text-muted-foreground">Canvas skin</p>
            <div className="flex flex-col gap-1" role="group" aria-label="Canvas skin">
              {RENDER_THEMES.map((theme) => (
                <button
                  key={theme.id}
                  type="button"
                  aria-pressed={renderTheme === theme.id}
                  onClick={() => onRenderThemeChange(theme.id)}
                  className={cn(
                    "flex h-8 items-center gap-2 rounded-md px-2 text-xs transition-colors hover:bg-muted",
                    renderTheme === theme.id
                      ? "bg-primary/10 text-primary"
                      : "text-foreground",
                  )}
                >
                  <span
                    aria-hidden
                    className={cn(
                      "size-2.5 rounded-full border border-border",
                      THEME_SWATCH[theme.id],
                    )}
                  />
                  {theme.label}
                </button>
              ))}
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setPromptOpen(true)}
            >
              View prompt
            </Button>
          </PopoverContent>
        </Popover>
      </WithCompactTooltip>
      <Dialog open={promptOpen} onOpenChange={setPromptOpen}>
        <DialogPortal>
          <DialogBackdrop />
          <DialogPopup className="flex max-h-[85vh] max-w-2xl flex-col gap-3">
            <div className="flex items-center justify-between gap-3">
              <DialogTitle>{themeLabel} prompt</DialogTitle>
              <Button type="button" size="sm" variant="outline" onClick={copyPrompt}>
                <Copy />
                Copy
              </Button>
            </div>
            <div className="max-h-[min(60vh,28rem)] min-h-0 flex-1 overflow-y-auto rounded-lg border border-border bg-muted/40 p-3">
              <pre className="font-sans text-xs leading-relaxed whitespace-pre-wrap text-foreground">
                {design.skill}
              </pre>
            </div>
            <div className="flex justify-end">
              <Button type="button" size="sm" variant="outline" onClick={copyPrompt}>
                <Copy />
                Copy
              </Button>
            </div>
          </DialogPopup>
        </DialogPortal>
      </Dialog>
    </>
  );
}

function AudioPopover({
  compact,
  muted,
  onMutedChange,
  onUploadAudio,
}: {
  compact: boolean;
  muted: boolean;
  onMutedChange: (muted: boolean) => void;
  onUploadAudio: (file: File) => void;
}) {
  const audioInputRef = useRef<HTMLInputElement>(null);

  const onAudioFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) {
      onUploadAudio(file);
    }
  };

  return (
    <WithCompactTooltip compact={compact} label="Audio">
      <Popover>
        <PopoverTrigger
          render={
            <Button
              type="button"
              size="sm"
              variant="ghost"
              aria-label="Audio"
              className="text-muted-foreground"
            />
          }
        >
          <Volume2 />
          {compact ? null : <span className="text-xs font-normal">Audio</span>}
        </PopoverTrigger>
        <PopoverContent align="start" className="w-56">
          <input
            ref={audioInputRef}
            type="file"
            accept={PREVIEW_AUDIO_ACCEPT}
            aria-hidden="true"
            tabIndex={-1}
            className="sr-only"
            onChange={onAudioFileChange}
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => audioInputRef.current?.click()}
          >
            <Upload />
            Upload audio
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            aria-label={muted ? "Unmute" : "Mute"}
            aria-pressed={muted}
            onClick={() => onMutedChange(!muted)}
          >
            {muted ? <VolumeX /> : <Volume2 />}
            {muted ? "Unmute" : "Mute"}
          </Button>
        </PopoverContent>
      </Popover>
    </WithCompactTooltip>
  );
}

function SettingsPopover({
  compact,
  showReelPreview,
  onToggleReelPreview,
}: {
  compact: boolean;
  showReelPreview: boolean;
  onToggleReelPreview: () => void;
}) {
  const [keyOpen, setKeyOpen] = useState(false);
  const theme = useThemeStore((state) => state.theme);
  const setTheme = useThemeStore((state) => state.setTheme);
  const maxRounds = useReelChatStore((state) => state.maxRounds);
  const setMaxRounds = useReelChatStore((state) => state.setMaxRounds);
  const models = useReelChatStore((state) => state.models);
  const setModels = useReelChatStore((state) => state.setModels);

  return (
    <>
      <WithCompactTooltip compact={compact} label="Settings">
        <Popover>
          <PopoverTrigger
            render={
              <Button
                type="button"
                size="sm"
                variant="ghost"
                aria-label="Settings"
                className="text-muted-foreground"
              />
            }
          >
            <Settings />
            {compact ? null : (
              <span className="text-xs font-normal">Settings</span>
            )}
          </PopoverTrigger>
          <PopoverContent align="end" className="w-80">
            <p className="text-xs font-medium">Reel pipeline</p>
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              Max rounds
              <Input
                type="number"
                min={1}
                max={4}
                aria-label="Max rounds"
                value={String(maxRounds)}
                onValueChange={(value) => {
                  const next = Number(value);
                  if (Number.isFinite(next)) {
                    setMaxRounds(next);
                  }
                }}
              />
            </label>
            <ModelField
              label="Generate model"
              value={models.generate}
              onChange={(generate) => setModels({ ...models, generate })}
            />
            <ModelField
              label="Review model"
              value={models.review}
              onChange={(review) => setModels({ ...models, review })}
            />
            <ModelField
              label="Fix model"
              value={models.fix}
              onChange={(fix) => setModels({ ...models, fix })}
            />
            <Button type="button" size="sm" variant="outline" onClick={() => setKeyOpen(true)}>
              Gemini API key
            </Button>
            <div className="h-px bg-border" />
            <p className="text-xs font-medium">Appearance</p>
            <SegmentGroup label="App theme">
              <Segment
                label="Light"
                active={theme === "light"}
                onClick={() => setTheme("light")}
              />
              <Segment
                label="Dark"
                active={theme === "dark"}
                onClick={() => setTheme("dark")}
              />
            </SegmentGroup>
            <Button
              type="button"
              size="sm"
              variant="outline"
              aria-pressed={showReelPreview}
              onClick={onToggleReelPreview}
            >
              Reel preview
            </Button>
          </PopoverContent>
        </Popover>
      </WithCompactTooltip>
      <GeminiKeyDialog open={keyOpen} onOpenChange={setKeyOpen} />
    </>
  );
}

function ModelField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs text-muted-foreground">
      {label}
      <Input
        aria-label={label}
        placeholder="Server default"
        value={value}
        onValueChange={onChange}
      />
    </label>
  );
}
