"use client";

import { useState, useEffect, useRef } from "react";

// ── Constants
const R = 14;
const CIRC = 2 * Math.PI * R;
const HALF = CIRC / 2;

// MDR ("macrodata refinement") bin animation timing
const FLIGHT_MS = 1800;        // letter lifetime: scatter, then fall into the bin
const SCATTER_MS = 520;        // scatter phase within FLIGHT_MS
const REASSEMBLE_DELAY = 1600; // name fades back onto the card after this
const RETURN_MS = 350;         // length of the reassemble animation

// ── Types
type ChoreType = "both" | "single";
type Urgency = "green" | "yellow" | "red";
type Who = "e" | "p";

// One letter of a chore name, in viewport px, with its flight path to the bin
// pre-rolled so rendering stays pure.
interface Piece {
  ch: string; x: number; y: number; w: number; h: number;
  sub: boolean;                          // from the small subtitle line, not the name
  sx: number; sy: number; rot: number;   // scatter offset + spin
  dx: number; dy: number; delay: number; // final offset into the bin
}
interface Flight { id: number; who: Who; pieces: Piece[] }

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
  // Sub-tasks that must ALL be ticked before the chore counts as done — e.g. the
  // dog walk isn't finished until both dogs have been walked.
  parts?: string[];
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
  partsDone: boolean[];
}

interface PersistedChore {
  id: string;
  eDone: boolean;
  pDone: boolean;
  lastDoneDate: string | null;
  lastWho: string | null;
  partsDone?: boolean[];
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
const HISTORY_KEY = "inniework_history";

// How many finished months to keep on the device.
const MAX_HISTORY = 36;

// Bumping this string forces a one-time clean slate on every device the next
// time the app loads (fresh week starting Mon 2026-06-29).
const RESET_TAG = "2026-06-29-cycles";

const CHORE_DEFS: ChoreDef[] = [
  { id: "dishes",      name: "Dishes",         image: "/chores/dishes.png",      type: "both",   cycleDays: 1,  greenMax: 1,  yellowMax: 1,  defaultDaysAgo: 0 },
  { id: "laundry",     name: "Laundry",        image: "/chores/laundry.png",     type: "both",   cycleDays: 1,  greenMax: 1,  yellowMax: 1,  defaultDaysAgo: 0 },
  { id: "putaway",     name: "Put Stuff Away", image: "/chores/putaway.svg",     type: "both",   cycleDays: 1,  greenMax: 1,  yellowMax: 1,  defaultDaysAgo: 0 },
  { id: "poop",        name: "Pick Up Poop",   image: "/chores/poop.png",        type: "single", cycleDays: 4,  greenMax: 2,  yellowMax: 3,  defaultDaysAgo: 1, freq: "Every 4 days" },
  { id: "plants",      name: "Water Outdoor Plants",   image: "/chores/plants.png",      type: "single", cycleDays: 3,  greenMax: 1,  yellowMax: 2,  defaultDaysAgo: 1, freq: "Every 3 days" },
  { id: "plants_in",   name: "Water Indoor Plants",  image: "/chores/plants.png",      type: "single", cycleDays: 14, greenMax: 9,  yellowMax: 11, defaultDaysAgo: 1, freq: "Every 2 weeks" },
  { id: "countertops", name: "Countertops",    image: "/chores/countertops.svg", type: "single", cycleDays: 7,  greenMax: 5,  yellowMax: 6,  defaultDaysAgo: 1, freq: "Weekly" },
  { id: "vacuum",      name: "Vacuuming",      image: "/chores/vacuum.png",      type: "single", cycleDays: 7,  greenMax: 5,  yellowMax: 6,  defaultDaysAgo: 1, freq: "Weekly" },
  { id: "sheets",      name: "Bed Sheets",     image: "/chores/sheets.png",      type: "single", cycleDays: 7,  greenMax: 5,  yellowMax: 6,  defaultDaysAgo: 1, freq: "Weekly" },
  { id: "toilets",     name: "Toilets",        image: "/chores/toilets.png",     type: "single", cycleDays: 14, greenMax: 9,  yellowMax: 11, defaultDaysAgo: 1, freq: "Twice a month" },
  { id: "dogtrain",    name: "Dog Training",   image: "/chores/Doggy.png",       type: "single", cycleDays: 14, greenMax: 9,  yellowMax: 11, defaultDaysAgo: 1, freq: "Twice a month · 5 min" },
  { id: "mopping",     name: "Mopping",        image: "/chores/mopping.svg",     type: "single", cycleDays: 30, greenMax: 21, yellowMax: 25, defaultDaysAgo: 1, freq: "Monthly" },
  { id: "dogwalk",     name: "Walk the Dogs",  image: "/chores/walking.png",     type: "single", cycleDays: 30, greenMax: 24, yellowMax: 28, defaultDaysAgo: 1, freq: "Monthly", parts: ["Koa", "Panko"] },
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

function periodTotal(p: PeriodLog): number {
  const sumRec = (r: Record<string, number>) => Object.values(r).reduce((a, b) => a + b, 0);
  return sumRec(p.elliot) + sumRec(p.paisley);
}

// Move a finished month into the archive, newest first. Empty months aren't
// worth keeping, and a re-archived month replaces its earlier copy.
function archiveMonth(done: PeriodLog, history: PeriodLog[]): PeriodLog[] {
  if (periodTotal(done) === 0) return history;
  return [done, ...history.filter((h) => h.period !== done.period)]
    .sort((a, b) => b.period.localeCompare(a.period))
    .slice(0, MAX_HISTORY);
}

// "2026-06" → "JUNE 2026"
function monthLabelOf(period: string): string {
  const [y, m] = period.split("-").map(Number);
  return new Date(y, m - 1, 1)
    .toLocaleDateString("en-US", { month: "long", year: "numeric" })
    .toUpperCase();
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
        partsDone: [],
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
      // Part ticks persist across days — walk one dog today, the other tomorrow.
      partsDone: (def.parts ?? []).map((_, i) => sc?.partsDone?.[i] ?? false),
    };
  });
}

function allPartsDone(c: ChoreState): boolean {
  return c.partsDone.every(Boolean);
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
// Measure each glyph of a text node and roll a random flight path for it.
function buildPieces(textNode: Node, bin: { x: number; y: number }, sub = false): Piece[] {
  const text = textNode.textContent ?? "";
  const range = document.createRange();
  const pieces: Piece[] = [];
  for (let k = 0; k < text.length; k++) {
    if (text[k].trim() === "") continue;
    range.setStart(textNode, k);
    range.setEnd(textNode, k + 1);
    const r = range.getBoundingClientRect();
    pieces.push({
      ch: text[k], x: r.left, y: r.top, w: r.width, h: r.height, sub,
      sx: (Math.random() - 0.5) * 60,
      sy: -(10 + Math.random() * 30),
      rot: (Math.random() - 0.5) * 90,
      dx: bin.x - r.left - r.width / 2 + (Math.random() - 0.5) * 24,
      dy: bin.y - r.top,
      delay: Math.random() * 120,
    });
  }
  return pieces;
}

export default function Home() {
  const [chores, setChores] = useState<ChoreState[]>(() => buildChores());
  const [weekly, setWeekly] = useState<PeriodLog>(() => emptyPeriod(weekStartStr()));
  const [monthly, setMonthly] = useState<PeriodLog>(() => emptyPeriod(monthStr()));
  const [history, setHistory] = useState<PeriodLog[]>([]);
  const [viewMonth, setViewMonth] = useState<string>(() => monthStr());
  const [page, setPage] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [dayKey, setDayKey] = useState(() => todayStr());
  const touchStartX = useRef(0);
  const pagesRef = useRef<HTMLDivElement>(null);

  // ── MDR bin animation state
  const [flights, setFlights] = useState<Flight[]>([]);
  const [hiddenNames, setHiddenNames] = useState<Set<number>>(() => new Set());
  const [returningNames, setReturningNames] = useState<Set<number>>(() => new Set());
  const [binOpen, setBinOpen] = useState(false);
  const [binPct, setBinPct] = useState(0);
  const flightId = useRef(0);
  const nameRefs = useRef(new Map<number, HTMLDivElement>());
  const sinceRefs = useRef(new Map<number, HTMLDivElement>());
  const binRef = useRef<HTMLDivElement>(null);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  const reducedMotion = useRef(false);
  const pctRef = useRef(0);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    reducedMotion.current = mq.matches;
    const onChange = (e: MediaQueryListEvent) => { reducedMotion.current = e.matches; };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  // Drop every pending animation timer if the page unmounts.
  useEffect(() => {
    const pending = timers.current;
    return () => { pending.forEach(clearTimeout); pending.clear(); };
  }, []);

  function later(fn: () => void, ms: number) {
    const t = setTimeout(() => { timers.current.delete(t); fn(); }, ms);
    timers.current.add(t);
  }

  function setNameRef(i: number, el: HTMLDivElement | null) {
    if (el) nameRefs.current.set(i, el);
    else nameRefs.current.delete(i);
  }
  function setSinceRef(i: number, el: HTMLDivElement | null) {
    if (el) sinceRefs.current.set(i, el);
    else sinceRefs.current.delete(i);
  }

  function nameClass(i: number) {
    if (hiddenNames.has(i)) return " name-refined";
    if (returningNames.has(i)) return " name-return";
    return "";
  }

  const setToggle = (s: Set<number>, i: number, on: boolean) => {
    const n = new Set(s);
    if (on) n.add(i); else n.delete(i);
    return n;
  };

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

    // Past months survive a reset-tag clean slate — that's the point of them.
    let past: PeriodLog[] = [];
    try {
      const rawH = localStorage.getItem(HISTORY_KEY);
      if (rawH) past = JSON.parse(rawH) as PeriodLog[];
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
          if (saved.period === monthStr()) {
            setMonthly(saved);
          } else {
            // Months turned over while the app was closed: file the finished
            // one away instead of dropping it, and start this month at zero.
            past = archiveMonth(saved, past);
          }
        }
      } catch {}
    }

    setHistory(past);
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

  // Latest monthly tally, readable from the rollover effect without re-running it.
  const monthlyRef = useRef(monthly);
  useEffect(() => { monthlyRef.current = monthly; }, [monthly]);

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
    const m = monthStr();
    const finished = monthlyRef.current;
    if (finished.period !== m) {
      // New calendar month: archive the finished one, then start fresh.
      setHistory((prev) => archiveMonth(finished, prev));
      setMonthly(emptyPeriod(m));
      setViewMonth((prev) => (prev === finished.period ? prev : m));
    }
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

  // Persist the archive of finished months on change (after initial load)
  useEffect(() => {
    if (!loaded) return;
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
  }, [history, loaded]);

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
        partsDone: c.partsDone,
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
    setMonthly((prev) => {
      if (prev.period === monthStr()) return apply(prev);
      // Month turned over between the last render and this tap — archive it
      // rather than let the fresh tally overwrite it.
      setHistory((h) => archiveMonth(prev, h));
      return apply(emptyPeriod(monthStr()));
    });
  }

  // Explode the chore's name into letters and send them to the bin. Reads the
  // DOM synchronously so the letters start exactly where the text is right now.
  function launch(i: number, who: Who) {
    if (reducedMotion.current) return;
    const nameEl = nameRefs.current.get(i);
    const binEl = binRef.current;
    if (!nameEl || !binEl) return;
    const textNode = nameEl.firstChild;
    if (!textNode || textNode.nodeType !== Node.TEXT_NODE) return;
    const b = binEl.getBoundingClientRect();
    const bin = { x: b.left + b.width / 2, y: b.top + 4 };
    const pieces = buildPieces(textNode, bin);
    // The subtitle line ("daily · resets midnight", "3 of 7 days") goes too.
    const sinceNode = sinceRefs.current.get(i)?.firstChild;
    if (sinceNode && sinceNode.nodeType === Node.TEXT_NODE) {
      pieces.push(...buildPieces(sinceNode, bin, true));
    }
    if (pieces.length === 0) return;
    const id = ++flightId.current;
    // Freeze the displayed % at its pre-log value; the arrival timer ticks it up.
    setBinPct(pctRef.current);
    setFlights((f) => [...f, { id, who, pieces }]);
    setHiddenNames((s) => setToggle(s, i, true));

    later(() => {
      setHiddenNames((s) => setToggle(s, i, false));
      setReturningNames((s) => setToggle(s, i, true));
      later(() => setReturningNames((s) => setToggle(s, i, false)), RETURN_MS);
    }, REASSEMBLE_DELAY);

    later(() => setBinOpen(true), SCATTER_MS + 80);

    later(() => {
      setBinPct(pctRef.current);
      setFlights((f) => {
        const rest = f.filter((x) => x.id !== id);
        if (rest.length === 0) later(() => setBinOpen(false), 250);
        return rest;
      });
    }, FLIGHT_MS + 160);
  }

  // Ref callback for each flying letter: runs once per mount, so Strict Mode's
  // double effects can't double-animate.
  function animatePiece(el: HTMLSpanElement | null, p: Piece) {
    if (!el || el.dataset.animated) return;
    el.dataset.animated = "1";
    el.animate(
      [
        { transform: "translate(0,0) rotate(0deg) scale(1)", opacity: 1, offset: 0 },
        { transform: `translate(${p.sx}px,${p.sy}px) rotate(${p.rot}deg) scale(1)`, opacity: 1,
          offset: SCATTER_MS / FLIGHT_MS, easing: "cubic-bezier(.2,.9,.3,1)" },
        { transform: `translate(${p.dx}px,${p.dy}px) rotate(${p.rot * 2}deg) scale(0.4)`, opacity: 0.9, offset: 1 },
      ],
      { duration: FLIGHT_MS, delay: p.delay, easing: "cubic-bezier(.55,0,.85,.4)", fill: "forwards" }
    );
  }

  function logBoth(i: number, who: Who) {
    const c = chores[i];
    if (!c) return;
    // Checking on counts toward this month; un-checking (a fix) backs it out.
    const turningOn = who === "e" ? !c.eDone : !c.pDone;
    if (turningOn) launch(i, who);
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

  // Tick one sub-task (e.g. one dog) on or off. Doesn't complete the chore —
  // that still takes a person logging it once every part is ticked.
  function togglePart(i: number, part: number) {
    setChores((prev) =>
      prev.map((cc, idx) => {
        if (idx !== i) return cc;
        return { ...cc, partsDone: cc.partsDone.map((d, j) => (j === part ? !d : d)) };
      })
    );
  }

  function logSingle(i: number, who: Who) {
    const c = chores[i];
    if (!c) return;
    // A chore with sub-tasks isn't done until every one of them is ticked.
    if (!allPartsDone(c)) return;
    launch(i, who);
    const today = todayStr();
    bump(c.def.id, who, 1);
    setChores((prev) =>
      prev.map((cc, idx) => {
        if (idx !== i) return cc;
        return {
          ...cc,
          done: true,
          lastWho: who === "e" ? "Elliot" : "Paisley",
          lastDoneDate: today,
          daysAgo: 0,
          expanded: false,
          // Cycle restarts, so the parts start over too.
          partsDone: cc.partsDone.map(() => false),
        };
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
  useEffect(() => { pctRef.current = pct; }, [pct]);
  // With nothing in the air (un-logs, reduced motion, first load) the bin
  // shows the real % immediately; mid-flight it holds until letters land.
  const shownPct = flights.length === 0 ? pct : binPct;
  const eDoneAll = dailyChores.length > 0 && dailyChores.every((c) => c.eDone);
  const pDoneAll = dailyChores.length > 0 && dailyChores.every((c) => c.pDone);

  // ── Overview totals
  const sum = (r: Record<string, number>) => Object.values(r).reduce((a, b) => a + b, 0);
  const eWeek = sum(weekly.elliot);
  const pWeek = sum(weekly.paisley);
  // Months you can page through on the Overview: this one, plus the archive.
  const thisMonth = monthStr();
  const monthOptions = [thisMonth, ...history.map((h) => h.period).filter((p) => p !== thisMonth)]
    .sort()
    .reverse();
  const shownMonth = monthOptions.includes(viewMonth) ? viewMonth : thisMonth;
  const monthIdx = monthOptions.indexOf(shownMonth);
  const isThisMonth = shownMonth === thisMonth;
  const shownLog = isThisMonth
    ? monthly
    : history.find((h) => h.period === shownMonth) ?? emptyPeriod(shownMonth);

  const eTotal = sum(shownLog.elliot);
  const pTotal = sum(shownLog.paisley);
  const monthLabel = monthLabelOf(shownMonth);
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
                      <div className={`card-name${both ? " name-done" : ""}${nameClass(i)}`} ref={(el) => setNameRef(i, el)}>{c.def.name}</div>
                      <div className={`card-since ${sinceClass(c)}${nameClass(i)}`} ref={(el) => setSinceRef(i, el)}>{sinceText(c)}</div>
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
                    <div className={`card-name${c.done ? " name-done" : ""}${nameClass(i)}`} ref={(el) => setNameRef(i, el)}>{c.def.name}</div>
                    <div className={`card-since ${sinceClass(c)}${nameClass(i)}`} ref={(el) => setSinceRef(i, el)}>{sinceText(c)}</div>
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
                      {c.done
                        ? (c.lastWho ?? "✓")
                        : c.def.parts
                          ? c.def.parts.map((part, j) => (
                              <div key={part} style={{ color: c.partsDone[j] ? "var(--green)" : "var(--sub)" }}>
                                {part} {c.partsDone[j] ? "✓" : "—"}
                              </div>
                            ))
                          : "—"}
                    </div>
                  </div>
                </div>
                {!c.done && c.def.parts && (
                  <div className={`log-panel parts-panel ${c.expanded ? "open" : ""}`}>
                    <div className="log-row">
                      {c.def.parts.map((part, j) => (
                        <button
                          key={part}
                          className={`log-btn part-btn ${c.partsDone[j] ? "selected" : ""}`}
                          onClick={(e) => { e.stopPropagation(); togglePart(i, j); }}
                        >
                          {c.partsDone[j] ? `✓ ${part}` : `+ ${part}`}
                        </button>
                      ))}
                    </div>
                    <div className="log-row">
                      <button
                        className="log-btn e-btn"
                        disabled={!allPartsDone(c)}
                        onClick={(e) => { e.stopPropagation(); logSingle(i, "e"); }}
                      >+ Elliot</button>
                      <button
                        className="log-btn p-btn"
                        disabled={!allPartsDone(c)}
                        onClick={(e) => { e.stopPropagation(); logSingle(i, "p"); }}
                      >+ Paisley</button>
                    </div>
                    {!allPartsDone(c) && (
                      <div className="parts-hint">Walk {c.def.parts.join(" and ")} to log it</div>
                    )}
                  </div>
                )}
                {!c.done && !c.def.parts && (
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

            <div className="ov-section-label">
              {isThisMonth ? "This month" : "Past month"}
              <span className="month-nav">
                {/* Options run newest → oldest, so "older" walks the index up. */}
                <button
                  className="month-nav-btn"
                  onClick={() => setViewMonth(monthOptions[monthIdx + 1])}
                  disabled={monthIdx >= monthOptions.length - 1}
                  aria-label="Older month"
                >‹</button>
                <span className="month-nav-label">{monthLabel}</span>
                <button
                  className="month-nav-btn"
                  onClick={() => setViewMonth(monthOptions[monthIdx - 1])}
                  disabled={monthIdx <= 0}
                  aria-label="Newer month"
                >›</button>
              </span>
            </div>
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
            <div className="ov-section-label">By chore · {isThisMonth ? "this month" : monthLabel}</div>
            <div className="ov-table">
              {CHORE_DEFS.map((def) => {
                const e = shownLog.elliot[def.id] ?? 0;
                const p = shownLog.paisley[def.id] ?? 0;
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

    {/* ── MDR LAYER: flying letters + the bin ── */}
    <div className={`mdr-layer${page === 0 ? "" : " mdr-hidden"}`} aria-hidden>
      {flights.map((f) =>
        f.pieces.map((p, k) => (
          <span
            key={`${f.id}-${k}`}
            className={`mdr-piece mdr-${f.who}${p.sub ? " mdr-sub" : ""}`}
            style={{ left: p.x, top: p.y, width: p.w, height: p.h }}
            ref={(el) => animatePiece(el, p)}
          >{p.ch}</span>
        ))
      )}
      <div ref={binRef} className={`mdr-bin${binOpen ? " open" : ""}`}>
        <div className="mdr-lid">
          <div className="mdr-door mdr-door-l" />
          <div className="mdr-door mdr-door-r" />
        </div>
        <div className="mdr-body">
          <span className="mdr-label">MDR</span>
          <span className="mdr-pct" style={{ color: progColor }}>{shownPct}%</span>
        </div>
      </div>
    </div>
    </div>
  );
}
