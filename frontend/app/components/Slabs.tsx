"use client";

import { useEffect, useRef } from "react";

/**
 * The floating-city effect, which everyone assumes is 3D. Metropolis's is not:
 * its DOM loads flat SVGs positioned around the viewport edges and parallaxed on
 * scroll. No WebGL, no three.js, no animation library. The isometric illusion
 * comes from mirrored angles on the two sides, so the light reads as coming from
 * one source.
 *
 * Built from clip-path blocks rather than skewed SVG rects. Percentage
 * positioning is exact, which matters because the first version put a bright
 * slab behind the body copy and made it unreadable — these are confined to the
 * outer fifth on each side, so the centre column stays clear at any width.
 */
interface Slab {
  side: "l" | "r";
  /** distance from its own edge, and from the top, as viewport percentages */
  edge: number;
  top: number;
  w: number;
  h: number;
  rate: number;
  grad: string;
  opacity: number;
}

const SLABS: Slab[] = [
  { side: "l", edge: -4, top: 2, w: 17, h: 11, rate: 0.26, grad: "var(--slab-l)", opacity: 0.8 },
  { side: "l", edge: 3, top: 26, w: 11, h: 7, rate: 0.46, grad: "var(--slab-face)", opacity: 0.5 },
  { side: "l", edge: -6, top: 62, w: 20, h: 12, rate: 0.6, grad: "var(--slab-r)", opacity: 0.42 },
  { side: "r", edge: -3, top: 8, w: 16, h: 10, rate: 0.32, grad: "var(--slab-r)", opacity: 0.75 },
  { side: "r", edge: 5, top: 34, w: 10, h: 6, rate: 0.5, grad: "var(--slab-l)", opacity: 0.45 },
  { side: "r", edge: -7, top: 70, w: 19, h: 12, rate: 0.68, grad: "var(--slab-face)", opacity: 0.35 },
];

/** a parallelogram; mirrored per side so the implied light has one direction */
const CLIP = {
  l: "polygon(0% 22%, 100% 0%, 100% 78%, 0% 100%)",
  r: "polygon(0% 0%, 100% 22%, 100% 100%, 0% 78%)",
} as const;

export function Slabs() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let raf = 0;
    const tick = () => {
      const scroll = Number(
        getComputedStyle(document.documentElement).getPropertyValue("--scroll") || 0,
      );
      ref.current?.querySelectorAll<HTMLDivElement>("[data-rate]").forEach((el) => {
        el.style.transform = `translate3d(0, ${-scroll * Number(el.dataset.rate)}px, 0)`;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div ref={ref} aria-hidden className="pointer-events-none absolute inset-0 -z-[5] overflow-hidden">
      {SLABS.map((s, i) => (
        <div
          key={i}
          data-rate={s.rate}
          className={`absolute ${s.edge > 0 ? "hidden sm:block" : ""}`}
          style={{
            [s.side === "l" ? "left" : "right"]: `${s.edge}%`,
            top: `${s.top}%`,
            width: `${s.w}%`,
            height: `${s.h}%`,
            background: s.grad,
            opacity: s.opacity,
            clipPath: CLIP[s.side],
            willChange: "transform",
          }}
        />
      ))}
    </div>
  );
}
