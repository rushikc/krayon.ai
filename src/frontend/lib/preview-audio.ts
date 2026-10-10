export interface PreviewAudioClip {
  objectUrl: string;
  name: string;
  duration: number;
}

const AUDIO_EXTENSIONS = [".wav", ".mp3"] as const;
const AUDIO_MIME_TYPES = new Set([
  "audio/wav",
  "audio/wave",
  "audio/x-wav",
  "audio/mpeg",
  "audio/mp3",
]);

export const PREVIEW_AUDIO_DRIFT_SECONDS = 0.2;
export const PREVIEW_AUDIO_SCRUB_SECONDS = 0.15;
export const PREVIEW_AUDIO_ACCEPT =
  ".wav,.mp3,audio/wav,audio/wave,audio/x-wav,audio/mpeg,audio/mp3";

export function isPreviewAudioFile(file: File): boolean {
  const name = file.name.toLowerCase();
  if (AUDIO_EXTENSIONS.some((ext) => name.endsWith(ext))) {
    return true;
  }
  return AUDIO_MIME_TYPES.has(file.type.toLowerCase());
}

export function shouldSeekPreviewAudio(
  mediaTime: number,
  timelineTime: number,
  drift = PREVIEW_AUDIO_DRIFT_SECONDS,
): boolean {
  return Math.abs(mediaTime - timelineTime) > drift;
}

export function isPreviewAudioScrub(
  previousTime: number,
  nextTime: number,
  threshold = PREVIEW_AUDIO_SCRUB_SECONDS,
): boolean {
  return Math.abs(nextTime - previousTime) > threshold;
}

export function readAudioDuration(objectUrl: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const audio = new Audio();
    audio.preload = "metadata";

    const cleanup = () => {
      audio.removeEventListener("loadedmetadata", onLoaded);
      audio.removeEventListener("error", onError);
      audio.removeAttribute("src");
      audio.load();
    };

    const onLoaded = () => {
      const duration = audio.duration;
      cleanup();
      if (!Number.isFinite(duration) || duration <= 0) {
        reject(new Error("Could not read audio duration"));
        return;
      }
      resolve(duration);
    };

    const onError = () => {
      cleanup();
      reject(new Error("Could not load audio"));
    };

    audio.addEventListener("loadedmetadata", onLoaded);
    audio.addEventListener("error", onError);
    audio.src = objectUrl;
  });
}
