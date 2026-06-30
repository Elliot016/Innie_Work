"use client";

import { useState, useEffect, useRef } from "react";

// ── Constants
const R = 14;
const CIRC = 2 * Math.PI * R;
const HALF = CIRC / 2;

// ── Types
type ChoreType = "both" | "single";
type Urgency = "green" | "yellow" | "red";
type Who = "e" | "p";

interface ChoreDef {
  id: string;
  name: string;
  image: string | null;
  type: ChoreType;
  cycleDays: number;     // length of the chore's cycle, for the "X of N days" counter
  greenMax: number;
  yellowMax: number;
  defaultDaysAgo: number;
  freq?: string;
}

interface ChoreState {
  def: ChoreDef;
  eDone: boolean;
  pDone: boolean;
  done: boolean;
  lastWho: string | null;
  lastDoneDate: string | null;
  daysAgo: number;
  expanded: boolean;
}

interface PersistedChore {
  id: string;
  eDone: boolean;
  pDone: boolean;
  lastDoneDate: string | null;
  lastWho: string | null;
}

interface PersistedData {
  savedDate: string;
  chores: PersistedChore[];
  resetTag?: string;
}

// ── Static data
const STORAGE_KEY = "inniework";
const WEEKLY_KEY = "inniework_weekly";
const MONTHLY_KEY = "inniework_monthly";

// Bumping this string forces a one-time clean slate on every device the next
// time the app loads (fresh week starting Mon 2026-06-29).
const RESET_TAG = "2026-06-29-cycles";

const CHORE_DEFS: ChoreDef[] = [
  { id: "dishes",      name: "Dishes",         image: "/chores/dishes.png",      type: "both",   cycleDays: 1,  greenMax: 1,  yellowMax: 1,  defaultDaysAgo: 0 },
  { id: "laundry",     name: "Laundry",        image: "/chores/laundry.png",     type: "both",   cycleDays: 1,  greenMax: 1,  yellowMax: 1,  defaultDaysAgo: 0 },
  { id: "putaway",     name: "Put Stuff Away", image: "/chores/putaway.svg",     type: "both",   cycleDays: 1,  greenMax: 1,  yellowMax: 1,  defaultDaysAgo: 0 },
  { id: "poop",        name: "Pick Up Poop",   image: "/chores/poop.png",        type: "single", cycleDays: 4,  greenMax: 2,  yellowMax: 3,  defaultDaysAgo: 1, freq: "Every 4 days" },
  { id: "plants",      name: "Water Plants",   image: "/chores/plants.png",      type: "single", cycleDays: 3,  greenMax: 1,  yellowMax: 2,  defaultDaysAgo: 1, freq: "Every 3 days" },
  { id: "countertops", name: "Countertops",    image: "/chores/countertops.svg", type: "single", cycleDays: 7,  greenMax: 5,  yellowMax: 6,  defaultDaysAgo: 1, freq: "Weekly" },
  { id: "vacuum",      name: "Vacuuming",      image: "/chores/vacuum.png",      type: "single", cycleDays: 7,  greenMax: 5,  yellowMax: 6,  defaultDaysAgo: 1, freq: "Weekly" },
  { id: "sheets",      name: "Bed Sheets",     image: "/chores/sheets.png",      type: "single", cycleDays: 7,  greenMax: 5,  yellowMax: 6,  defaultDaysAgo: 1, freq: "Weekly" },
  { id: "toilets",     name: "Toilets",        image: "/chores/toilets.png",     type: "single", cycleDays: 14, greenMax: 7,  yellowMax: 11, defaultDaysAgo: 1, freq: "Twice a month" },
  { id: "mopping",     name: "Mopping",        image: "/chores/mopping.svg",     type: "single", cycleDays: 30, greenMax: 21, yellowMax: 25, defaultDaysAgo: 1, freq: "Monthly" },
];

// Real, accumulated tallies — count each chore logged in the period, per person.
interface PeriodLog {
  period: string; // weekStart "YYYY-MM-DD" or month "YYYY-MM"
  elliot: Record<string, number>;
  paisley: Record<string, number>;
}

// ── Helpers
function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function monthStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// Monday of the current week, as "YYYY-MM-DD".
function weekStartStr(): string {
  const n = new Date();
  const dow = n.getDay(); // 0 Sun … 6 Sat
  const back = dow === 0 ? -6 : 1 - dow;
  const mon = new Date(n.getFullYear(), n.getMonth(), n.getDate() + back);
  return `${mon.getFullYear()}-${String(mon.getMonth() + 1).padStart(2, "0")}-${String(mon.getDate()).padStart(2, "0")}`;
}

function emptyPeriod(period: string): PeriodLog {
  return { period, elliot: {}, paisley: {} };
}

function computeDaysAgo(lastDoneDate: string | null): number {
  if (!lastDoneDate) return 999;
  const [y, m, day] = lastDoneDate.split("-").map(Number);
  const then = new Date(y, m - 1, day).getTime();
  const now = new Date();
  const nowDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return Math.floor((nowDay - then) / (1000 * 60 * 60 * 24));
}

function fmtDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Date string for N days before today.
function dateDaysAgo(n: number): string {
  const d = new Date();
  return fmtDate(new Date(d.getFullYear(), d.getMonth(), d.getDate() - n));
}

function buildChores(saved?: PersistedData | null): ChoreState[] {
  const today = todayStr();
  return CHORE_DEFS.map((def) => {
    const sc = saved?.chores.find((c) => c.id === def.id);
    if (def.type === "both") {
      const sameDay = saved?.savedDate === today;
      return {
        def, expanded: false,
        eDone: sameDay ? (sc?.eDone ?? false) : false,
        pDone: sameDay ? (sc?.pDone ?? false) : false,
        done: false, lastWho: null, lastDoneDate: null, daysAgo: 0,
      };
    }
    // Recurring chores age by days-since-last-done. With no saved record, seed
    // them at the fresh-start offset (defaultDaysAgo) so they begin at "day 1".
    const lastDoneDate = sc?.lastDoneDate ?? dateDaysAgo(def.defaultDaysAgo);
    const daysAgo = computeDaysAgo(lastDoneDate);
    return {
      def, expanded: false,
      eDone: false, pDone: false,
      done: daysAgo === 0,
      lastWho: sc?.lastWho ?? null,
      lastDoneDate,
      daysAgo,
    };
  });
}

function getUrgency(c: ChoreState): Urgency {
  if (c.def.type === "both") return "green";
  if (c.done) return "green";
  if (c.daysAgo <= c.def.greenMax) return "green";
  if (c.daysAgo <= c.def.yellowMax) return "yellow";
  return "red";
}

function sinceText(c: ChoreState): string {
  if (c.def.type === "both") {
    if (c.eDone && c.pDone) return "both done ✓";
    if (c.eDone) return "elliot ✓ · paisley —";
    if (c.pDone) return "elliot — · paisley ✓";
    return "daily · resets midnight";
  }
  // Recurring chores: show how far into the cycle we are, e.g. "3 of 7 days".
  if (c.done) return c.lastWho ? `done · ${c.lastWho}` : "done today";
  return `${c.daysAgo} of ${c.def.cycleDays} days`;
}

function sinceClass(c: ChoreState): string {
  const urg = getUrgency(c);
  if (c.def.type === "both" && c.eDone && c.pDone) return "green-text";
  if (urg === "yellow") return "yellow-text";
  if (urg === "red") return "red-text";
  return "";
}

// ── SVG components
function SplitSVG({ eDone, pDone }: { eDone: boolean; pDone: boolean }) {
  const eOff = eDone ? 0 : HALF;
  const pOff = pDone ? -HALF : HALF;
  return (
    <svg viewBox="0 0 38 38" width="38" height="38">
      <circle className="c-track" cx="19" cy="19" r={R} strokeDasharray={CIRC} />
      <circle className="c-e" cx="19" cy="19" r={R}
        strokeDasharray={`${HALF} ${CIRC}`} strokeDashoffset={eOff}
        transform="rotate(-90 19 19)" />
      <circle className="c-p" cx="19" cy="19" r={R}
        strokeDasharray={`${HALF} ${CIRC}`} strokeDashoffset={pOff}
        transform="rotate(-90 19 19)" />
    </svg>
  );
}

function RingSVG({ done, who }: { done: boolean; who: string | null }) {
  const color = done
    ? who === "Elliot" ? "var(--elliot-light)" : "var(--paisley-light)"
    : "rgba(255,255,255,0.15)";
  const offset = done ? 0 : CIRC;
  return (
    <svg viewBox="0 0 38 38" width="38" height="38">
      <circle className="r-track" cx="19" cy="19" r={R} strokeDasharray={CIRC} />
      <circle className="r-fill" cx="19" cy="19" r={R}
        stroke={color} strokeDasharray={CIRC} strokeDashoffset={offset}
        transform="rotate(-90 19 19)" />
    </svg>
  );
}

// ── Main component
export default function Home() {
  const [chores, setChores] = useState<ChoreState[]>(() => buildChores());
  const [weekly, setWeekly] = useState<PeriodLog>(() => emptyPeriod(weekStartStr()));
  const [monthly, setMonthly] = useState<PeriodLog>(() => emptyPeriod(monthStr()));
  const [page, setPage] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [dayKey, setDayKey] = useState(() => todayStr());
  const touchStartX = useRef(0);
  const pagesRef = useRef<HTMLDivElement>(null);

  const dateStr = new Date().toLocaleDateString("en-US", {
    weekday: "short", month: "short", day: "numeric",
  }).toUpperCase();

  // Load from localStorage on mount
  useEffect(() => {
    // One-time clean slate: if the stored data predates the current reset tag,
    // ignore all of it and start this week fresh.
    let fresh = false;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const saved = JSON.parse(raw) as PersistedData;
        if (saved.resetTag === RESET_TAG) setChores(buildChores(saved));
        else fresh = true;
      }
    } catch {}

    if (!fresh) {
      try {
        const rawW = localStorage.getItem(WEEKLY_KEY);
        if (rawW) {
          const saved = JSON.parse(rawW) as PeriodLog;
          // New week (new Monday) → start the weekly tally fresh.
          setWeekly(saved.period === weekStartStr() ? saved : emptyPeriod(weekStartStr()));
        }
      } catch {}
      try {
        const rawM = localStorage.getItem(MONTHLY_KEY);
        if (rawM) {
          const saved = JSON.parse(rawM) as PeriodLog;
          // New calendar month → start the monthly tally fresh.
          setMonthly(saved.period === monthStr() ? saved : emptyPeriod(monthStr()));
        }
      } catch {}
    }
    setLoaded(true);
  }, []);

  // Tick once a minute; when the calendar day actually rolls over, update dayKey.
  useEffect(() => {
    const id = setInterval(() => {
      const d = todayStr();
      setDayKey((prev) => (prev === d ? prev : d));
    }, 60000);
    return () => clearInterval(id);
  }, []);

  // When the day changes while the app is open, roll everything over live:
  // clear the daily checkboxes, re-age every recurring chore's day counter, and
  // reset the weekly/monthly tallies if their period turned over.
  const rolloverDayRef = useRef(dayKey);
  useEffect(() => {
    if (!loaded) return;
    if (rolloverDayRef.current === dayKey) return; // skip initial mount; only act on real changes
    rolloverDayRef.current = dayKey;
    setChores((prev) =>
      prev.map((c) => {
        if (c.def.type === "both") return { ...c, eDone: false, pDone: false, expanded: false };
        const daysAgo = computeDaysAgo(c.lastDoneDate);
        return { ...c, daysAgo, done: daysAgo === 0, expanded: false };
      })
    );
    setWeekly((prev) => (prev.period === weekStartStr() ? prev : emptyPeriod(weekStartStr())));
    setMonthly((prev) => (prev.period === monthStr() ? prev : emptyPeriod(monthStr())));
  }, [dayKey, loaded]);

  // Persist the weekly tally on change (after initial load)
  useEffect(() => {
    if (!loaded) return;
    localStorage.setItem(WEEKLY_KEY, JSON.stringify(weekly));
  }, [weekly, loaded]);

  // Persist the monthly tally on change (after initial load)
  useEffect(() => {
    if (!loaded) return;
    localStorage.setItem(MONTHLY_KEY, JSON.stringify(monthly));
  }, [monthly, loaded]);

  // Persist on change (after initial load)
  useEffect(() => {
    if (!loaded) return;
    const data: PersistedData = {
      savedDate: todayStr(),
      resetTag: RESET_TAG,
      chores: chores.map((c) => ({
        id: c.def.id,
        eDone: c.eDone,
        pDone: c.pDone,
        lastDoneDate: c.lastDoneDate,
        lastWho: c.lastWho,
      })),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }, [chores, loaded]);

  // ── Handlers
  function toggleCard(i: number) {
    setChores((prev) =>
      prev.map((c, idx) => {
        if (idx !== i) return { ...c, expanded: false };
        if (c.def.type === "single" && c.done) return { ...c, expanded: false };
        return { ...c, expanded: !c.expanded };
      })
    );
  }

  // Adjust this week's AND this month's tally for a person/chore (clamped at 0).
  function bump(choreId: string, who: Who, delta: number) {
    const key = who === "e" ? "elliot" : "paisley";
    const apply = (base: PeriodLog): PeriodLog => {
      const next = Math.max(0, (base[key][choreId] ?? 0) + delta);
      return { ...base, [key]: { ...base[key], [choreId]: next } };
    };
    setWeekly((prev) => apply(prev.period === weekStartStr() ? prev : emptyPeriod(weekStartStr())));
    setMonthly((prev) => apply(prev.period === monthStr() ? prev : emptyPeriod(monthStr())));
  }

  function logBoth(i: number, who: Who) {
    const c = chores[i];
    if (!c) return;
    // Checking on counts toward this month; un-checking (a fix) backs it out.
    const turningOn = who === "e" ? !c.eDone : !c.pDone;
    bump(c.def.id, who, turningOn ? 1 : -1);
    setChores((prev) =>
      prev.map((cc, idx) => {
        if (idx !== i) return cc;
        const eDone = who === "e" ? !cc.eDone : cc.eDone;
        const pDone = who === "p" ? !cc.pDone : cc.pDone;
        return { ...cc, eDone, pDone, expanded: eDone && pDone ? false : cc.expanded };
      })
    );
  }

  function logSingle(i: number, who: Who) {
    const c = chores[i];
    if (!c) return;
    const today = todayStr();
    bump(c.def.id, who, 1);
    setChores((prev) =>
      prev.map((cc, idx) => {
        if (idx !== i) return cc;
        return { ...cc, done: true, lastWho: who === "e" ? "Elliot" : "Paisley", lastDoneDate: today, daysAgo: 0, expanded: false };
      })
    );
  }

  // ── Progress
  const dailyChores = chores.filter((c) => c.def.type === "both");
  let pts = 0;
  dailyChores.forEach((c) => { if (c.eDone) pts++; if (c.pDone) pts++; });
  const pct = dailyChores.length > 0 ? Math.round((pts / (dailyChores.length * 2)) * 100) : 0;
  const progColor = pct > 75 ? "#3D9E6A" : pct > 40 ? "#C89B2A" : "#B03030";
  const allDone = dailyChores.every((c) => c.eDone && c.pDone);
  const eDoneAll = dailyChores.length > 0 && dailyChores.every((c) => c.eDone);
  const pDoneAll = dailyChores.length > 0 && dailyChores.every((c) => c.pDone);

  // ── Overview totals
  const sum = (r: Record<string, number>) => Object.values(r).reduce((a, b) => a + b, 0);
  const eWeek = sum(weekly.elliot);
  const pWeek = sum(weekly.paisley);
  const eTotal = sum(monthly.elliot);
  const pTotal = sum(monthly.paisley);
  const monthLabel = new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" }).toUpperCase();
  const weekLabel = `WEEK OF ${new Date(weekStartStr() + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" }).toUpperCase()}`;

  // ── Swipe (native listeners so Safari doesn't suppress them)
  const pageRef = useRef(page);
  pageRef.current = page;

  useEffect(() => {
    const el = pagesRef.current;
    if (!el) return;
    let startX = 0;
    const onStart = (e: TouchEvent) => { startX = e.touches[0].clientX; };
    const onEnd = (e: TouchEvent) => {
      const diff = startX - e.changedTouches[0].clientX;
      if (Math.abs(diff) < 30) return;
      if (diff > 0 && pageRef.current === 0) setPage(1);
      if (diff < 0 && pageRef.current === 1) setPage(0);
    };
    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchend", onEnd, { passive: true });
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchend", onEnd);
    };
  }, []);

  return (
    <div className="clip-wrap">
    <div ref={pagesRef} className="pages">
      {/* ── PAGE 1: BOARD ── */}
      <div className={`page board-page${page === 0 ? " page-active" : ""}`}>
        <div className="app-header">
          <div className="header-top">
            <div>
              <div className="logo-name">Your Innie <span>Duties</span></div>
            </div>
            <div className="header-right">
              <div className="header-date">{dateStr}</div>
            </div>
          </div>
          <div className="progress-row">
            <div className="prog-track">
              <div className="prog-fill" style={{ width: `${pct}%`, background: progColor }} />
            </div>
            <div className="prog-pct">{pct}%</div>
          </div>
          <div className="page-dots">
            <div className={`dot ${page === 0 ? "active" : ""}`} onClick={() => setPage(0)} style={{ cursor: "pointer" }} />
            <div className={`dot ${page === 1 ? "active" : ""}`} onClick={() => setPage(1)} style={{ cursor: "pointer" }} />
          </div>
        </div>

        <div className="legend">
          <span><span className="leg-dot" style={{ background: "var(--elliot-light)" }} />Elliot</span>
          <span><span className="leg-dot" style={{ background: "var(--paisley-light)" }} />Paisley</span>
          <button className="nav-btn" onClick={() => setPage(1)} style={{ marginLeft: "auto" }}>Overview →</button>
        </div>

        <div className="board-grid">
          {chores.map((c, i) => {
            const urg = getUrgency(c);
            if (c.def.type === "both") {
              const both = c.eDone && c.pDone;
              return (
                <div key={c.def.id} className={`card-wrap ${c.expanded ? "has-panel" : ""}`}>
                  <div className="task-card" onClick={() => toggleCard(i)}>
                    <div className="urgency-bar bar-blue" />
                    {c.def.image && (
                      <div className="card-image-bg" style={{ backgroundImage: `url(${c.def.image})` }} />
                    )}
                    <div className="card-tint tint-blue" />
                    <div className="card-top">
                      <div className="card-name">{c.def.name}</div>
                      <div className={`card-since ${sinceClass(c)}`}>{sinceText(c)}</div>
                    </div>
                    <div className="card-bottom">
                      <div className="split-wrap">
                        <SplitSVG eDone={c.eDone} pDone={c.pDone} />
                        <div className="c-initials">
                          <span className={`c-initial ${c.eDone ? "done" : ""}`}>E</span>
                          <span className={`c-initial ${c.pDone ? "done" : ""}`}>P</span>
                        </div>
                        {both && <div className="both-check">✓</div>}
                      </div>
                      {!both && (
                        <div className="who-status">
                          <div style={{ color: c.eDone ? "var(--elliot-light)" : "var(--sub)" }}>E {c.eDone ? "✓" : "—"}</div>
                          <div style={{ color: c.pDone ? "var(--paisley-light)" : "var(--sub)" }}>P {c.pDone ? "✓" : "—"}</div>
                        </div>
                      )}
                    </div>
                  </div>
                  <div className={`log-panel ${c.expanded ? "open" : ""}`}>
                    <button
                      className={`log-btn e-btn ${c.eDone ? "selected" : ""}`}
                      onClick={(e) => { e.stopPropagation(); logBoth(i, "e"); }}
                    >
                      {c.eDone ? "✓ Elliot" : "+ Elliot"}
                    </button>
                    <button
                      className={`log-btn p-btn ${c.pDone ? "selected" : ""}`}
                      onClick={(e) => { e.stopPropagation(); logBoth(i, "p"); }}
                    >
                      {c.pDone ? "✓ Paisley" : "+ Paisley"}
                    </button>
                  </div>
                </div>
              );
            }

            return (
              <div key={c.def.id} className={`card-wrap ${c.expanded ? "has-panel" : ""}`}>
                <div className="task-card" onClick={() => toggleCard(i)}>
                  <div className={`urgency-bar bar-${urg}`} />
                  {c.def.image && (
                    <div className="card-image-bg" style={{ backgroundImage: `url(${c.def.image})` }} />
                  )}
                  <div className={`card-tint tint-${urg}`} />
                  <div className="card-top">
                    <div className="card-name">{c.def.name}</div>
                    <div className={`card-since ${sinceClass(c)}`}>{sinceText(c)}</div>
                  </div>
                  <div className="card-bottom">
                    <div className="ring-wrap">
                      <RingSVG done={c.done} who={c.lastWho} />
                      {c.done
                        ? <div className="ring-check">✓</div>
                        : <div className="ring-initial">—</div>}
                    </div>
                    <div className="who-status" style={{
                      color: c.done && c.lastWho
                        ? c.lastWho === "Elliot" ? "var(--elliot-light)" : "var(--paisley-light)"
                        : "var(--sub)"
                    }}>
                      {c.done ? (c.lastWho ?? "✓") : "—"}
                    </div>
                  </div>
                </div>
                {!c.done && (
                  <div className={`log-panel ${c.expanded ? "open" : ""}`}>
                    <button
                      className="log-btn e-btn"
                      onClick={(e) => { e.stopPropagation(); logSingle(i, "e"); }}
                    >+ Elliot</button>
                    <button
                      className="log-btn p-btn"
                      onClick={(e) => { e.stopPropagation(); logSingle(i, "p"); }}
                    >+ Paisley</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {!allDone && eDoneAll && (
          <div className="done-banner praise-banner elliot-praise">
            <div className="done-banner-title">Good Job, Innie Elliot!</div>
            <div className="done-banner-sub">You have completed your tasks.</div>
          </div>
        )}

        {!allDone && pDoneAll && (
          <div className="done-banner praise-banner paisley-praise">
            <div className="done-banner-title">Good Job, Innie Paisley!</div>
            <div className="done-banner-sub">You have completed your tasks.</div>
          </div>
        )}

        {allDone && (
          <div className="done-banner">
            <div className="done-banner-title">The work is complete.</div>
            <div className="done-banner-sub">&ldquo;Your Outties are very happy with your performance.&rdquo;</div>
          </div>
        )}

        <div className="bottom-pad" />
      </div>

      {/* ── PAGE 2: OVERVIEW ── */}
      <div className={`page overview-page${page === 1 ? " page-active" : ""}`}>
        <div className="ov-header">
          <div className="header-top">
            <div>
              <div className="ov-title">Overview</div>
            </div>
            <div className="header-right">
              <div className="header-date">{dateStr}</div>
              <div className="ov-subtitle">{weekLabel}</div>
            </div>
          </div>
          <div className="page-dots ov-page-dots">
            <div className={`dot ${page === 0 ? "active" : ""}`} onClick={() => setPage(0)} style={{ cursor: "pointer" }} />
            <div className={`dot ${page === 1 ? "active" : ""}`} onClick={() => setPage(1)} style={{ cursor: "pointer" }} />
          </div>
          <button className="nav-btn" onClick={() => setPage(0)}>← Board</button>
        </div>

        <div className="ov-body">
          <div className="ov-col-left">
            <div className="ov-section-label" style={{ marginTop: "4px" }}>This week</div>
            <div className="ov-scorecards">
              <div className="scorecard" style={{ borderColor: "var(--elliot)" }}>
                <div className="sc-name" style={{ color: "var(--elliot-light)" }}>Elliot</div>
                <div className="sc-num" style={{ color: "var(--elliot-light)" }}>{eWeek}</div>
                <div className="sc-label">chores logged</div>
              </div>
              <div className="scorecard" style={{ borderColor: "var(--paisley)" }}>
                <div className="sc-name" style={{ color: "var(--paisley-light)" }}>Paisley</div>
                <div className="sc-num" style={{ color: "var(--paisley-light)" }}>{pWeek}</div>
                <div className="sc-label">chores logged</div>
              </div>
            </div>

            <div className="ov-section-label">This month · {monthLabel}</div>
            <div className="ov-scorecards">
              <div className="scorecard" style={{ borderColor: "var(--elliot)" }}>
                <div className="sc-name" style={{ color: "var(--elliot-light)" }}>Elliot</div>
                <div className="sc-num" style={{ color: "var(--elliot-light)" }}>{eTotal}</div>
                <div className="sc-label">chores logged</div>
              </div>
              <div className="scorecard" style={{ borderColor: "var(--paisley)" }}>
                <div className="sc-name" style={{ color: "var(--paisley-light)" }}>Paisley</div>
                <div className="sc-num" style={{ color: "var(--paisley-light)" }}>{pTotal}</div>
                <div className="sc-label">chores logged</div>
              </div>
            </div>
          </div>

          <div className="ov-col-right">
            <div className="ov-section-label">By chore · this month</div>
            <div className="ov-table">
              {CHORE_DEFS.map((def) => {
                const e = monthly.elliot[def.id] ?? 0;
                const p = monthly.paisley[def.id] ?? 0;
                const max = Math.max(e, p, 1);
                return (
                  <div key={def.id} className="ov-row">
                    <div className="ov-chore-icon">
                      {def.image
                        ? <img src={def.image} alt={def.name} className="ov-icon-img" />
                        : <span style={{ fontSize: "1rem", opacity: 0.45 }}>□</span>}
                    </div>
                    <div className="ov-chore-name">{def.name}</div>
                    <div className="ov-bars">
                      <div className="ov-bar-row">
                        <div className="ov-bar-track">
                          <div className="ov-bar-fill" style={{ width: `${(e / max) * 100}%`, background: "var(--elliot)" }} />
                        </div>
                        <div className="ov-count" style={{ color: "var(--elliot-light)" }}>{e}</div>
                      </div>
                      <div className="ov-bar-row">
                        <div className="ov-bar-track">
                          <div className="ov-bar-fill" style={{ width: `${(p / max) * 100}%`, background: "var(--paisley)" }} />
                        </div>
                        <div className="ov-count" style={{ color: "var(--paisley-light)" }}>{p}</div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div className="bottom-pad" />
      </div>
    </div>
    </div>
  );
}
