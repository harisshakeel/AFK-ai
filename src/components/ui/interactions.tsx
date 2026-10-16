"use client";

import { useEffect } from "react";

import { useReducedMotion } from "@/lib/use-reduced-motion";

/**
 * Pointer physics for the whole page, mounted once: elements with the `magnet` class
 * lean toward the pointer and spring back; elements with the `tilt` class turn in 3D
 * toward it and carry a glare that follows (`data-tilt` sets the maximum degrees). One
 * listener on the document, no per-element hooks, nothing on touch, nothing under
 * reduced motion.
 */
const MAGNET_PULL = 0.22;
const MAGNET_MAX_PX = 9;

export function Interactions() {
  const reduce = useReducedMotion();
  useEffect(() => {
    if (reduce) return;
    const live = new Set<HTMLElement>();
    const reset = (element: HTMLElement) => {
      element.style.transform = "";
      element.style.removeProperty("--glare-x");
      element.style.removeProperty("--glare-y");
      element.style.removeProperty("--glare-on");
      live.delete(element);
    };
    const onLeave = (event: Event) => {
      const element = event.currentTarget as HTMLElement;
      element.removeEventListener("pointerleave", onLeave);
      reset(element);
    };
    const onMove = (event: PointerEvent) => {
      if (event.pointerType !== "mouse") return;
      const target = event.target as Element | null;
      const element = target?.closest<HTMLElement>(".magnet, .tilt");
      if (!element) return;
      if (!live.has(element)) {
        live.add(element);
        element.addEventListener("pointerleave", onLeave);
      }
      const rect = element.getBoundingClientRect();
      const px = (event.clientX - rect.left) / rect.width;
      const py = (event.clientY - rect.top) / rect.height;
      const parts: string[] = [];
      if (element.classList.contains("magnet")) {
        const dx = (px - 0.5) * rect.width * MAGNET_PULL;
        const dy = (py - 0.5) * rect.height * MAGNET_PULL;
        const clamp = (value: number) => Math.max(-MAGNET_MAX_PX, Math.min(MAGNET_MAX_PX, value));
        parts.push(`translate(${clamp(dx).toFixed(1)}px, ${clamp(dy).toFixed(1)}px)`);
      }
      if (element.classList.contains("tilt")) {
        const max = Number(element.dataset.tilt ?? "8");
        const rx = ((0.5 - py) * 2 * max).toFixed(2);
        const ry = ((px - 0.5) * 2 * max).toFixed(2);
        parts.push(`perspective(900px) rotateX(${rx}deg) rotateY(${ry}deg)`);
        element.style.setProperty("--glare-x", `${(px * 100).toFixed(1)}%`);
        element.style.setProperty("--glare-y", `${(py * 100).toFixed(1)}%`);
        element.style.setProperty("--glare-on", "1");
      }
      element.style.transform = parts.join(" ");
    };
    document.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      document.removeEventListener("pointermove", onMove);
      for (const element of [...live]) {
        element.removeEventListener("pointerleave", onLeave);
        reset(element);
      }
    };
  }, [reduce]);
  return null;
}
