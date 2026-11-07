import type { DiagramListItem } from "@/lib/api/reel-client";
import { diagramBuildHint, formatDiagramCaption } from "@/lib/diagram-timeline";

export function RushkStage({
  width,
  height,
  title,
  caption,
  pngUrl,
  reelArg,
  issues,
  unbuilt,
  picker,
  onPick,
}: {
  width: number;
  height: number;
  title: string;
  caption: string;
  pngUrl: string | null;
  reelArg: string | null;
  issues: string[];
  unbuilt: boolean;
  picker: DiagramListItem[];
  onPick: (reelArg: string) => void;
}) {
  const captionText = formatDiagramCaption(caption);
  return (
    <div
      data-reel-stage=""
      data-testid="rushk-stage"
      className="relative overflow-hidden text-white"
      style={{
        width,
        height,
        backgroundColor: "#000000",
        backgroundImage:
          "linear-gradient(rgba(160,160,160,0.12) 1px, transparent 1px), linear-gradient(90deg, rgba(160,160,160,0.12) 1px, transparent 1px)",
        backgroundSize: "14% 9%, 14% 9%",
      }}
    >
      <div
        className="absolute inset-x-[6%] flex items-center justify-center text-center text-[clamp(12px,3.2cqw,22px)] leading-tight font-semibold"
        style={{ top: "8%", height: "7%" }}
        data-testid="rushk-title"
      >
        <span className="line-clamp-2">{title}</span>
      </div>
      <div
        className="absolute inset-x-0 flex flex-col items-center"
        style={{ top: "16%", bottom: "12%" }}
      >
        {pngUrl ? (
          <img
            src={pngUrl}
            alt=""
            data-testid="rushk-png"
            className="max-h-full"
            style={{ width: "83%", height: "auto", objectFit: "contain" }}
          />
        ) : (
          <div
            className="flex h-full w-[83%] items-center justify-center text-center text-xs text-white/50"
            data-testid="diagram-unbuilt"
          >
            {unbuilt && reelArg ? diagramBuildHint(reelArg) : "Choose a diagram reel"}
          </div>
        )}
        {captionText ? (
          <p
            className="mt-[1%] w-[83%] text-left text-[clamp(10px,2.4cqw,16px)] font-medium text-white"
            data-testid="rushk-caption"
          >
            {captionText}
          </p>
        ) : null}
      </div>
      {issues.length > 0 ? (
        <ul className="absolute right-2 bottom-2 left-2 max-h-[18%] overflow-auto text-left text-[10px] text-red-300">
          {issues.map((issue) => (
            <li key={issue}>{issue}</li>
          ))}
        </ul>
      ) : null}
      {!reelArg ? (
        <div
          className="absolute inset-x-[8%] top-[40%] flex flex-col gap-1.5"
          data-testid="diagram-picker"
        >
          <p className="text-center text-[11px] text-white/70">Choose a built diagram reel</p>
          {picker.map((item) => (
            <button
              key={item.reelArg}
              type="button"
              className="rounded-md border border-white/20 bg-black/40 px-2 py-1.5 text-left text-[11px] hover:border-white/50"
              onClick={() => onPick(item.reelArg)}
            >
              {item.title}
              <span className="mt-0.5 block font-mono text-[10px] text-white/50">{item.reelArg}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
