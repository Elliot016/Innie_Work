"use client";

import { useEffect, useState, type CSSProperties } from "react";
import DigitField from "./DigitField";

export const SCREENSAVER_NAME = "Purge & Polish Corporation"; // CSS uppercases it

// Glitch cadence (ms). A burst is RGB split + slice tear + flicker, then clean.
const GLITCH_GAP_MIN = 650;
const GLITCH_GAP_MAX = 1_300;
const GLITCH_LEN_MIN = 300;
const GLITCH_LEN_MAX = 600;

const rand = (lo: number, hi: number) => lo + Math.random() * (hi - lo);

// 12-hour, no seconds, no meridiem: "9:42".
function fmtClock(d: Date): string {
  const h = d.getHours() % 12 || 12;
  return `${h}:${String(d.getMinutes()).padStart(2, "0")}`;
}

// Null until mounted, so the markup can never disagree with the server.
// Each tick re-reads the wall clock and sleeps until just past the next
// minute boundary — iOS suspends timers in the background, and this
// self-corrects the moment it fires again.
function SaverClock() {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | null = null;
    const tick = () => {
      const now = new Date();
      setText(fmtClock(now));
      const wait = 60_000 - (now.getSeconds() * 1000 + now.getMilliseconds()) + 40;
      t = setTimeout(tick, wait);
    };
    tick();
    const onVis = () => {
      if (document.visibilityState !== "visible") return;
      if (t) clearTimeout(t);
      tick();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      if (t) clearTimeout(t);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);
  return <div className="ss-clock">{text ?? " "}</div>;
}

interface Burst { top: number; height: number; ms: number } // top/height in %

// The spinning house. Rotation lives on .ss-spin and is never touched; a
// burst only adds `.is-glitching` to the wrapper and passes the random band
// geometry down as CSS variables, so the angle survives every glitch.
function SaverLogo() {
  const [burst, setBurst] = useState<Burst | null>(null);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let t: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;
    const schedule = () => {
      t = setTimeout(() => {
        if (cancelled) return;
        const ms = Math.round(rand(GLITCH_LEN_MIN, GLITCH_LEN_MAX));
        setBurst({ top: rand(15, 70), height: rand(6, 18), ms });
        t = setTimeout(() => {
          if (cancelled) return;
          setBurst(null);
          schedule();
        }, ms);
      }, rand(GLITCH_GAP_MIN, GLITCH_GAP_MAX));
    };
    schedule();
    return () => { cancelled = true; if (t) clearTimeout(t); };
  }, []);

  const style = burst
    ? ({
        "--tear-top": `${burst.top}%`,
        "--tear-bot": `${100 - burst.top - burst.height}%`,
        "--glitch-ms": `${burst.ms}ms`,
      } as CSSProperties)
    : undefined;

  return (
    <div className={`ss-logo${burst ? " is-glitching" : ""}`} style={style} aria-hidden>
      <div className="ss-halo" />
      <div className="ss-spin">
        {/* colour copies sit under the faces so only their fringes show */}
        <div className="ss-glitch r" />
        <div className="ss-glitch c" />
        <div className="ss-face front" />
        <div className="ss-face back" />
        <div className="ss-tear" />
      </div>
    </div>
  );
}

// Full-screen idle overlay: dark, quiet, everything bright slowly drifting.
// Any tap wakes the board (see useIdle for why the tap can't fall through).
export default function Screensaver({
  show,
  onDismiss,
}: {
  show: boolean;
  onDismiss: () => void;
}) {
  if (!show) return null;
  return (
    <div className="screensaver" onClick={onDismiss} role="button" aria-label="Wake">
      <div className="ss-digits"><DigitField /></div>
      <div className="ss-drift-x">
        <div className="ss-drift-y">
          <div className="ss-center"><SaverLogo /></div>
          <div className="ss-bottom">
            <SaverClock />
            <div className="ss-name">{SCREENSAVER_NAME}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
