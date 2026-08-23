"use client";

import { useEffect, useRef, useState } from "react";

// The CRT chrome: outer frame, scanline overlay, terminal header
// (date | big % | HOME globe) and the footer hex string. Renders as fixed
// overlays; the pages behind it pad to clear the header (--term-hdr-h) and
// the bin dock.
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
        <div className="term-logo" aria-hidden>
          {/* HOME globe, per the MDR terminal mockup */}
          <svg viewBox="0 0 150 52">
            <defs>
              <clipPath id="term-globe-clip">
                <ellipse cx="75" cy="26" rx="70" ry="22" />
              </clipPath>
            </defs>
            <ellipse cx="75" cy="26" rx="70" ry="22" fill="none" stroke="currentColor" strokeWidth="2" />
            <g clipPath="url(#term-globe-clip)" stroke="currentColor" strokeWidth="1.4">
              <line x1="0" y1="8" x2="150" y2="8" />
              <line x1="0" y1="14" x2="150" y2="14" />
              <line x1="0" y1="38" x2="150" y2="38" />
              <line x1="0" y1="44" x2="150" y2="44" />
            </g>
            <rect x="5" y="17" width="140" height="18" fill="var(--term-bg)" />
            <text x="75" y="32" textAnchor="middle" fill="currentColor" fontFamily="var(--font-display), monospace" fontSize="21" letterSpacing="6">
              HOME
            </text>
          </svg>
        </div>
      </header>
      <div className="term-hex" aria-hidden>0x137056 : 0x09B32E</div>
    </>
  );
}
