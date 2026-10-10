import { getCanvasDesign } from "@/components/canvas/designs";
import { lastVisibleTime } from "@/lib/reel-duration";
import { isRenderTheme } from "@/lib/render-theme";

export const EXPORT_WIDTH = 1080;
export const EXPORT_HEIGHT = 1920;
export const EXPORT_FPS = 30;
export const EXPORT_BITRATE = 8_000_000;

const UNSAFE_FILENAME = /[/\\?%*:|"<>]/g;

export function sanitizeExportFilename(name: string): string {
  const trimmed = name.trim().replace(/\.mp4$/i, "");
  const safe = trimmed.replace(UNSAFE_FILENAME, "").trim();
  return `${safe || "krayon-reel"}.mp4`;
}

export function formatExportEta(elapsedMs: number, progress: number): string {
  if (progress <= 0) {
    return "Calculating…";
  }
  const remainingMs = elapsedMs * (1 / progress - 1);
  const seconds = Math.max(0, Math.round(remainingMs / 1000));
  if (seconds < 60) {
    return `About ${seconds}s left`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `About ${minutes}m ${remainder}s left`;
}

/** H.264 macroblocks are 16×16; 1080 is not 16-aligned. */
export function alignH264Size(value: number): number {
  return Math.ceil(value / 16) * 16;
}

export const ENCODE_WIDTH = alignH264Size(EXPORT_WIDTH);
export const ENCODE_HEIGHT = alignH264Size(EXPORT_HEIGHT);

const CODEC_CANDIDATES = [
  "avc1.640032",
  "avc1.640028",
  "avc1.4d0028",
  "avc1.42e028",
] as const;

export function reelFrameTimes(duration: number, fps = EXPORT_FPS): number[] {
  const safe = Math.max(duration, 0);
  const last = lastVisibleTime(safe, fps);
  const count = Math.max(1, Math.round(safe * fps));
  const times: number[] = [];
  for (let i = 0; i < count; i += 1) {
    times.push(Math.min(i / fps, last));
  }
  return times;
}

export function reelVideoEncoderConfig(
  preferHardware: boolean,
  codec: string = CODEC_CANDIDATES[0],
  width = ENCODE_WIDTH,
  height = ENCODE_HEIGHT,
): VideoEncoderConfig {
  return {
    codec,
    width,
    height,
    bitrate: EXPORT_BITRATE,
    framerate: EXPORT_FPS,
    avc: { format: "avc" },
    latencyMode: "quality",
    ...(preferHardware
      ? { hardwareAcceleration: "prefer-hardware" as const }
      : {}),
  };
}

export function isEvenExportSize(): boolean {
  return EXPORT_WIDTH % 2 === 0 && EXPORT_HEIGHT % 2 === 0;
}

function waitForPaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve());
    });
  });
}

function waitForEncoder(encoder: VideoEncoder): Promise<void> {
  if (encoder.encodeQueueSize <= 4) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const previous = encoder.ondequeue;
    encoder.ondequeue = () => {
      encoder.ondequeue = previous;
      resolve();
    };
  });
}

function downloadMp4(buffer: ArrayBuffer, filename: string) {
  const blob = new Blob([buffer], { type: "video/mp4" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function encoderCandidates(): VideoEncoderConfig[] {
  const sizes = [
    { width: ENCODE_WIDTH, height: ENCODE_HEIGHT },
    { width: EXPORT_WIDTH, height: EXPORT_HEIGHT },
  ];
  const hardware: Array<VideoEncoderConfig["hardwareAcceleration"] | undefined> = [
    "prefer-hardware",
    "no-preference",
    undefined,
  ];
  const avcFormats: Array<"avc" | undefined> = ["avc", undefined];
  const configs: VideoEncoderConfig[] = [];

  for (const codec of CODEC_CANDIDATES) {
    for (const size of sizes) {
      for (const hardwareAcceleration of hardware) {
        for (const avcFormat of avcFormats) {
          configs.push({
            codec,
            width: size.width,
            height: size.height,
            bitrate: EXPORT_BITRATE,
            framerate: EXPORT_FPS,
            latencyMode: "quality",
            ...(hardwareAcceleration ? { hardwareAcceleration } : {}),
            ...(avcFormat ? { avc: { format: avcFormat } } : {}),
          });
        }
      }
    }
  }

  return configs;
}

export async function resolveReelEncoderConfig(): Promise<VideoEncoderConfig> {
  if (typeof VideoEncoder === "undefined") {
    throw new Error("WebCodecs is not available in this browser.");
  }

  for (const candidate of encoderCandidates()) {
    const support = await VideoEncoder.isConfigSupported(candidate);
    if (support.supported) {
      return support.config ?? candidate;
    }
  }

  throw new Error(
    "This browser cannot encode H.264 for a 9:16 reel. Try Chrome 94+ with hardware video encode enabled.",
  );
}

const UNSAFE_CSS_COLOR =
  /oklch|oklab|lab\(|lch\(|color-mix|color\(|currentColor/i;

export function cssValueNeedsRgbFallback(value: string): boolean {
  return UNSAFE_CSS_COLOR.test(value);
}

function designForElement(element: HTMLElement) {
  const theme = element.getAttribute("data-render-theme");
  return getCanvasDesign(isRenderTheme(theme) ? theme : "bright");
}

function captureBackground(element: HTMLElement): string {
  return designForElement(element).exportBackground;
}

function padFrame(
  source: HTMLCanvasElement,
  width: number,
  height: number,
  background = "#000000",
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) {
    throw new Error("Could not create an encode canvas.");
  }
  context.fillStyle = background;
  context.fillRect(0, 0, width, height);

  if (source.width < 1 || source.height < 1) {
    return canvas;
  }

  const scale = Math.min(width / source.width, height / source.height);
  const drawWidth = source.width * scale;
  const drawHeight = source.height * scale;
  context.drawImage(
    source,
    Math.floor((width - drawWidth) / 2),
    Math.floor((height - drawHeight) / 2),
    drawWidth,
    drawHeight,
  );
  return canvas;
}

function cssColorToRgb(color: string, ctx: CanvasRenderingContext2D): string {
  if (!color || color === "none" || color === "transparent") {
    return color;
  }
  try {
    ctx.fillStyle = "#000000";
    ctx.fillStyle = color;
    const parsed = ctx.fillStyle;
    if (typeof parsed === "string" && !cssValueNeedsRgbFallback(parsed)) {
      return parsed;
    }
  } catch {
    return color;
  }
  return color;
}

const COLOR_STYLE_PROPS = [
  "color",
  "backgroundColor",
  "borderTopColor",
  "borderRightColor",
  "borderBottomColor",
  "borderLeftColor",
  "outlineColor",
  "fill",
  "stroke",
] as const;

function withForeignObjectSafeStyles<T>(
  root: HTMLElement,
  run: () => Promise<T>,
): Promise<T> {
  const scratch = document.createElement("canvas").getContext("2d");
  if (!scratch) {
    return run();
  }

  const backups: Array<{ node: HTMLElement | SVGElement; cssText: string }> =
    [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
  let current: Node | null = root;

  while (current) {
    if (current instanceof HTMLElement || current instanceof SVGElement) {
      backups.push({ node: current, cssText: current.style.cssText });
      const computed = getComputedStyle(current);
      for (const prop of COLOR_STYLE_PROPS) {
        const value = computed[prop];
        if (typeof value === "string" && value && value !== "none") {
          current.style[prop] = cssColorToRgb(value, scratch);
        }
      }
      if (cssValueNeedsRgbFallback(computed.backgroundImage)) {
        current.style.backgroundImage = "none";
      }
      current.style.filter = "none";
      current.style.backdropFilter = "none";
    }
    current = walker.nextNode();
  }

  return run().finally(() => {
    for (const backup of backups) {
      backup.node.style.cssText = backup.cssText;
    }
  });
}

async function snapshotReel(
  element: HTMLElement,
): Promise<HTMLCanvasElement> {
  const rect = element.getBoundingClientRect();
  const width = Math.max(1, Math.round(rect.width));
  const height = Math.max(1, Math.round(rect.height));
  if (rect.width < 2 || rect.height < 2) {
    throw new Error("Export canvas has no layout size.");
  }

  const { toCanvas } = await import("html-to-image");
  const pixelRatio = Math.max(EXPORT_WIDTH / width, EXPORT_HEIGHT / height);
  const design = designForElement(element);
  const backgroundColor = design.exportBackground;

  return withForeignObjectSafeStyles(element, () =>
    toCanvas(element, {
      pixelRatio,
      backgroundColor,
      cacheBust: false,
      skipAutoScale: true,
      style: {
        backgroundColor,
        backgroundImage: design.exportBackgroundImage,
        backgroundSize: design.exportBackgroundSize,
        backgroundPosition: design.exportBackgroundPosition,
        backgroundRepeat: design.exportBackgroundRepeat,
      },
    }),
  );
}

export async function exportReelMp4(options: {
  captureElement: HTMLElement;
  duration: number;
  setCurrentTime: (time: number) => void;
  onProgress?: (ratio: number) => void;
  filename?: string;
  signal?: AbortSignal;
}): Promise<void> {
  const { Muxer, ArrayBufferTarget } = await import("mp4-muxer");
  const { flushSync } = await import("react-dom");

  const config = await resolveReelEncoderConfig();
  const encodeWidth = config.width;
  const encodeHeight = config.height;
  const times = reelFrameTimes(options.duration, EXPORT_FPS);
  const frameDuration = 1e6 / EXPORT_FPS;

  const target = new ArrayBufferTarget();
  const muxer = new Muxer({
    target,
    video: {
      codec: "avc",
      width: encodeWidth,
      height: encodeHeight,
    },
    fastStart: "in-memory",
    firstTimestampBehavior: "offset",
  });

  let encoderError: Error | null = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => {
      muxer.addVideoChunk(chunk, meta);
    },
    error: (error) => {
      encoderError = error;
    },
  });
  encoder.configure(config);

  try {
    for (let i = 0; i < times.length; i += 1) {
      if (options.signal?.aborted) {
        throw new DOMException("Export cancelled", "AbortError");
      }
      if (encoderError) {
        throw encoderError;
      }

      flushSync(() => {
        options.setCurrentTime(times[i]!);
      });
      await waitForPaint();

      const snapshot = await snapshotReel(options.captureElement);
      const background = captureBackground(options.captureElement);
      const frameSource = padFrame(
        snapshot,
        encodeWidth,
        encodeHeight,
        background,
      );

      const frame = new VideoFrame(frameSource, {
        timestamp: Math.round(i * frameDuration),
        duration: Math.round(frameDuration),
        alpha: "discard",
      });
      encoder.encode(frame, { keyFrame: i % EXPORT_FPS === 0 });
      frame.close();

      await waitForEncoder(encoder);
      options.onProgress?.((i + 1) / times.length);
    }

    await encoder.flush();
    if (encoderError) {
      throw encoderError;
    }
    muxer.finalize();
    downloadMp4(target.buffer, options.filename ?? "krayon-reel.mp4");
  } finally {
    if (encoder.state !== "closed") {
      encoder.close();
    }
  }
}
