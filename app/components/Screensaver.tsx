"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { Bin, ChoreState } from "@/lib/model";
import { getUrgency, sinceText } from "@/lib/logic";
import type { Person } from "@/lib/model";

export const SCREENSAVER_NAME = "Purge & Polish Corporation"; // CSS uppercases it

// How many overdue rows the glance shows before folding the rest into "+N".
const MAX_ROWS = 8;
// Burn-in guard: the content block jumps to a new spot this often. A jump,
// not an animation — nothing moves in between, so nothing is drawn.
const NUDGE_MS = 2 * 60_000;

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
  return <div className="ss-clock">{text ?? " "}</div>;
}

// A random offset within a few percent of the viewport, applied as a plain
// transform with no transition. Starts at rest so the first paint is centred.
function useNudge(): CSSProperties | undefined {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => {
    const id = setInterval(() => {
      setPos({ x: (Math.random() - 0.5) * 5, y: (Math.random() - 0.5) * 4 });
    }, NUDGE_MS);
    return () => clearInterval(id);
  }, []);
  return pos ? { transform: `translate(${pos.x.toFixed(2)}vw, ${pos.y.toFixed(2)}vh)` } : undefined;
}

// Full-screen idle view: a still, dark glance board. It shows only the
// cycle chores that have aged past green — red first, then yellow — so a
// walk past the panel says what needs doing without anyone touching it.
// Nothing animates: the clock redraws once a minute, the block nudges every
// couple of minutes, and the list changes only when the board does.
// Any tap wakes the board (see useIdle for why the tap can't fall through).
export default function Screensaver({
  show,
  quiet,
  chores,
  bins,
  people,
  onDismiss,
}: {
  show: boolean;
  // Quiet hours: draw nothing at all. The page also drops the wake lock so
  // the iPad can switch the display off.
  quiet: boolean;
  chores: ChoreState[];
  bins: Bin[];
  people: Person[];
  onDismiss: () => void;
}) {
  const nudge = useNudge();
  if (!show) return null;
  if (quiet) {
    return <div className="screensaver quiet" onClick={onDismiss} role="button" aria-label="Wake" />;
  }

  const rank = { red: 0, yellow: 1, green: 2 } as const;
  const due = chores
    .map((c) => ({ c, u: getUrgency(c) }))
    .filter((x) => x.u !== "green")
    .sort((a, b) => rank[a.u] - rank[b.u] || b.c.daysAgo - a.c.daysAgo);
  const shown = due.slice(0, MAX_ROWS);
  const more = due.length - shown.length;
  const binOf = (id: string) => bins.find((b) => b.id === id);

  return (
    <div className="screensaver" onClick={onDismiss} role="button" aria-label="Wake">
      <div className="ss-block" style={nudge}>
        {due.length === 0 ? (
          <div className="ss-clear">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/pp-atom.png" alt="" className="ss-logo-still" aria-hidden />
            <div className="ss-clear-text">All clear</div>
          </div>
        ) : (
          <div className="ss-list">
            <div className="ss-list-head">
              {due.length === 1 ? "1 chore needs attention" : `${due.length} chores need attention`}
            </div>
            {shown.map(({ c, u }) => {
              const b = binOf(c.def.binId);
              return (
                <div key={c.def.id} className={`ss-row ${u}`}>
                  <span className="ss-row-bin">{b ? `${b.num} ${b.label}` : ""}</span>
                  <span className="ss-row-name">{c.def.name}</span>
                  <span className="ss-row-since">{sinceText(c, people)}</span>
                </div>
              );
            })}
            {more > 0 && <div className="ss-more">+ {more} more</div>}
          </div>
        )}
        <div className="ss-bottom">
          <SaverClock />
          <div className="ss-name">{SCREENSAVER_NAME}</div>
        </div>
      </div>
    </div>
  );
}
