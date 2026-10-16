"use client";

import { Maximize2 } from "lucide-react";
import { useRef } from "react";

import type { MediaPlayer } from "./use-media-player";

/**
 * A bot meeting's video. The synced transcript is its caption track and the player bar
 * its controls, so the element shows none of its own; a click on the picture plays or
 * pauses, as viewers expect, and the corner button takes it full screen (the keyboard
 * shortcuts keep working there, Esc comes back). The letterbox is black in any theme,
 * the one place a raw colour is right.
 */
export function VideoPane({ src, player }: { src: string; player: MediaPlayer }) {
  const frame = useRef<HTMLDivElement | null>(null);
  return (
    <div ref={frame} className="relative aspect-video max-h-[40vh] w-full shrink-0 bg-black">
      <video
        key={src}
        src={src}
        {...player.mediaProps}
        playsInline
        onClick={player.toggle}
        aria-label="Meeting video"
        className="h-full w-full object-contain"
      />
      <button
        type="button"
        onClick={() => void frame.current?.requestFullscreen?.()}
        aria-label="Full screen"
        className="absolute right-2 bottom-2 grid size-9 place-items-center rounded-full bg-black/60 text-white opacity-80 transition-opacity hover:opacity-100 focus-visible:opacity-100"
      >
        <Maximize2 className="size-4" aria-hidden />
      </button>
    </div>
  );
}
