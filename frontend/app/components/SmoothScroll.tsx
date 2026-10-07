"use client";

import { useEffect } from "react";
import Lenis from "lenis";

/**
 * Metropolis uses Lenis and no animation library at all — the weight of the
 * scroll is doing half the work that looks like motion design. Cheap to borrow,
 * and the single biggest difference between a page that feels built and one that
 * feels assembled.
 *
 * Exposes progress as --scroll on the root so the slabs can parallax off it
 * without each one subscribing to its own listener.
 */
export function SmoothScroll() {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const lenis = new Lenis({ duration: 1.1, smoothWheel: true });
    let raf = 0;
    const loop = (time: number) => {
      lenis.raf(time);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    const onScroll = ({ scroll }: { scroll: number }) => {
      document.documentElement.style.setProperty("--scroll", String(scroll));
    };
    lenis.on("scroll", onScroll);

    return () => {
      cancelAnimationFrame(raf);
      lenis.off("scroll", onScroll);
      lenis.destroy();
      document.documentElement.style.removeProperty("--scroll");
    };
  }, []);

  return null;
}
