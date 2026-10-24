import {
  Braces,
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
import { useRef, useState, type ChangeEvent } from "react";

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
  showEditor,
  onToggleEditor,
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
  showEditor: boolean;
  onToggleEditor: () => void;
  showReelPreview: boolean;
  onToggleReelPreview: () => void;
  renderTheme: RenderTheme;
  onRenderThemeChange: (theme: RenderTheme) => void;
  previewAudioMuted: boolean;
  onMutedChange: (muted: boolean) => void;
  onUploadAudio: (file: File) => void;
}) {
  return (
    <TooltipProvider>
      <div className="flex h-10 shrink-0 items-center gap-1.5 overflow-x-auto border-b border-border bg-card px-2">
        <SegmentGroup label="Workspace view">
          <Segment
            label="Timeline"
            icon={Layers}
            active={sideView === "timeline"}
            onClick={() => onSideViewChange("timeline")}
          />
          <Segment
            label="Chat"
            icon={MessageSquare}
            active={sideView === "chat"}
            onClick={() => onSideViewChange("chat")}
          />
        </SegmentGroup>

        <span aria-hidden className="h-5 w-px shrink-0 bg-border" />

        <CanvasPopover
          renderTheme={renderTheme}
          onRenderThemeChange={onRenderThemeChange}
        />
        <ComingSoonButton label="Takes" icon={Film} />
        <ComingSoonButton label="Captions" icon={Captions} />
        <AudioPopover
          muted={previewAudioMuted}
          onMutedChange={onMutedChange}
          onUploadAudio={onUploadAudio}
        />
        <ToolButton
          label="JSON"
          icon={Braces}
          name="Toggle inspector"
          pressed={showEditor && sideView === "timeline"}
          disabled={sideView !== "timeline"}
          onClick={onToggleEditor}
        />
        <ComingSoonButton label="Zoom" icon={ZoomIn} />
        <SettingsPopover
          showReelPreview={showReelPreview}
          onToggleReelPreview={onToggleReelPreview}
        />
      </div>
    </TooltipProvider>
  );
}

function ToolButton({
  label,
  icon: Icon,
  name,
  pressed,
  disabled,
  onClick,
}: {
  label: string;
  icon: LucideIcon;
  name?: string;
  pressed?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      aria-label={name ?? label}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
      className={cn(pressed && "border-primary/40 bg-primary/10 text-primary")}
    >
      <Icon />
      {label}
    </Button>
  );
}

function ComingSoonButton({
  label,
  icon: Icon,
}: {
  label: string;
  icon: LucideIcon;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span className="inline-flex">
            <Button type="button" size="sm" variant="outline" disabled>
              <Icon />
              {label}
            </Button>
          </span>
        }
      />
      <TooltipContent>Coming soon</TooltipContent>
    </Tooltip>
  );
}

function CanvasPopover({
  renderTheme,
  onRenderThemeChange,
}: {
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
      <Popover>
        <PopoverTrigger
          render={<Button type="button" size="sm" variant="outline" />}
        >
          <Palette />
          Canvas
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
  muted,
  onMutedChange,
  onUploadAudio,
}: {
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
    <Popover>
      <PopoverTrigger
        render={<Button type="button" size="sm" variant="outline" />}
      >
        Audio
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
  );
}

function SettingsPopover({
  showReelPreview,
  onToggleReelPreview,
}: {
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
      <Popover>
        <PopoverTrigger
          render={
            <Button type="button" size="sm" variant="outline" aria-label="Settings">
              <Settings />
              Settings
            </Button>
          }
        />
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

