"use client";

import { useEffect, useRef, useState } from "react";

// The CRT chrome: outer frame, scanline overlay and the terminal header
// (date | big %). Renders as fixed overlays; the pages behind it pad to clear
// the header and the bin dock.
export default function TerminalFrame({
  dateStr,
  pct,
}: {
  dateStr: string;
  pct: number;
}) {
  // Count-up tween toward the live percentage (snap under reduced motion).
  const [shown, setShown] = useState(pct);
  const shownRef = useRef(pct);
  useEffect(() => { shownRef.current = shown; }, [shown]);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setShown(pct);
      return;
    }
    const from = shownRef.current;
    if (from === pct) return;
    const t0 = performance.now();
    const dur = 550;
    let raf = 0;
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / dur);
      setShown(Math.round(from + (pct - from) * k));
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [pct]);

  return (
    <>
      <div className="crt-frame" aria-hidden />
      <div className="scanlines" aria-hidden />
      <header className="term-hdr">
        <div className="term-date">{dateStr}</div>
        <div className="term-pct">{shown}% COMPLETE</div>
        {/* Same width as the date so the percentage stays centred. */}
        <div className="term-spacer" aria-hidden />
      </header>
    </>
  );
}
