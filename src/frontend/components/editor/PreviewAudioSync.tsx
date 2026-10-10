import { useEffect, useRef } from "react";

import {
  isPreviewAudioScrub,
  type PreviewAudioClip,
} from "@/lib/preview-audio";
import { useCanvasStore } from "@/stores/canvas-store";

function seekAudio(audio: HTMLAudioElement, time: number) {
  const limit = Number.isFinite(audio.duration) ? audio.duration : time;
  const target = Math.min(Math.max(time, 0), limit);
  try {
    audio.currentTime = target;
  } catch {
    /* some browsers reject seeks before metadata */
  }
}

export function PreviewAudioSync({
  clip,
  muted,
}: {
  clip: PreviewAudioClip | null;
  muted: boolean;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const lastTimeRef = useRef(0);
  const mutedRef = useRef(muted);
  mutedRef.current = muted;
  const isPlaying = useCanvasStore((state) => state.isPlaying);
  const currentTime = useCanvasStore((state) => state.currentTime);

  useEffect(() => {
    if (!clip) {
      audioRef.current?.pause();
      audioRef.current = null;
      return;
    }

    const audio = new Audio(clip.objectUrl);
    audio.preload = "auto";
    audio.muted = mutedRef.current;
    audioRef.current = audio;

    return () => {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
      if (audioRef.current === audio) {
        audioRef.current = null;
      }
    };
  }, [clip]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }
    audio.muted = muted;
  }, [muted, clip]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !clip) {
      return;
    }

    const playhead = useCanvasStore.getState().currentTime;
    lastTimeRef.current = playhead;

    if (!isPlaying || playhead >= clip.duration) {
      audio.pause();
      return;
    }

    seekAudio(audio, playhead);
    void audio.play().catch(() => undefined);
  }, [clip, isPlaying]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !clip) {
      return;
    }

    const previous = lastTimeRef.current;
    lastTimeRef.current = currentTime;

    if (currentTime >= clip.duration) {
      audio.pause();
      return;
    }

    if (!isPlaying) {
      seekAudio(audio, currentTime);
      return;
    }

    if (!isPreviewAudioScrub(previous, currentTime)) {
      return;
    }

    seekAudio(audio, currentTime);
    if (audio.paused) {
      void audio.play().catch(() => undefined);
    }
  }, [clip, currentTime, isPlaying]);

  return null;
}
