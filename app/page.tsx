"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import {
  ChoreState,
  HouseholdConfig,
  PeriodLogV2,
  PersistedV2,
  Person,
  emptyConfig,
  emptyPeriod,
  templateConfig,
} from "@/lib/model";
import {
  computeDaysAgo,
  monthLabelOf,
  monthStr,
  todayStr,
  weekStartStr,
} from "@/lib/time";
import {
  allPartsDone,
  archiveMonth,
  binPct,
  buildChores,
  dailyDone,
  getUrgency,
  overallPct,
  resolveAssignees,
  sinceClass,
  sinceText,
} from "@/lib/logic";
import { loadAll, saveAll } from "@/lib/storage";
import DigitField from "./components/DigitField";
import KierOverlay from "./components/KierOverlay";
import Onboarding from "./components/Onboarding";
import SettingsPage from "./components/SettingsPage";
import TerminalFrame from "./components/TerminalFrame";

// MDR ("macrodata refinement") bin animation timing
const FLIGHT_MS = 1800;        // letter lifetime: scatter, then fall into the bin
const SCATTER_MS = 520;        // scatter phase within FLIGHT_MS
const REASSEMBLE_DELAY = 1600; // name fades back onto the card after this
const RETURN_MS = 350;         // length of the reassemble animation

// One letter of a chore name, in viewport px, with its flight path to the bin
// pre-rolled so rendering stays pure.
interface Piece {
  ch: string; x: number; y: number; w: number; h: number;
  sub: boolean;                          // from the small subtitle line, not the name
  sx: number; sy: number; rot: number;   // scatter offset + spin
  dx: number; dy: number; delay: number; // final offset into the bin
}
interface Flight { id: number; binId: string; color: string; pieces: Piece[] }

// Until real onboarding (Phase 4), a brand-new device gets the template
// household — the same board a fresh install had before.
const DEFAULT_PEOPLE: Person[] = [
  { id: "elliot", name: "Elliot", color: "#F0C94A" },
  { id: "paisley", name: "Paisley", color: "#F5A0B0" },
];

const pcStyle = (color: string) => ({ "--pc": color } as CSSProperties);

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
  const [config, setConfig] = useState<HouseholdConfig>(() => templateConfig(DEFAULT_PEOPLE));
  const [chores, setChores] = useState<ChoreState[]>([]);
  const [weekly, setWeekly] = useState<PeriodLogV2>(() => emptyPeriod(weekStartStr()));
  const [monthly, setMonthly] = useState<PeriodLogV2>(() => emptyPeriod(monthStr()));
  const [history, setHistory] = useState<PeriodLogV2[]>([]);
  const [viewMonth, setViewMonth] = useState<string>(() => monthStr());
  const [page, setPage] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [needsOnboarding, setNeedsOnboarding] = useState(false);
  const [kierShown, setKierShown] = useState(false);
  const kierArmed = useRef(true); // fires once per day, re-armed at rollover
  const [dayKey, setDayKey] = useState(() => todayStr());
  const pagesRef = useRef<HTMLDivElement>(null);

  const people = config.people;

  // ── MDR bin animation state
  const [flights, setFlights] = useState<Flight[]>([]);
  const [hiddenNames, setHiddenNames] = useState<Set<number>>(() => new Set());
  const [returningNames, setReturningNames] = useState<Set<number>>(() => new Set());
  const [openBins, setOpenBins] = useState<Set<string>>(() => new Set());
  const [receivingBins, setReceivingBins] = useState<Set<string>>(() => new Set());
  // Gauges held at their pre-log value while letters are in the air.
  const [frozenPct, setFrozenPct] = useState<Map<string, number>>(() => new Map());
  const flightId = useRef(0);
  const nameRefs = useRef(new Map<number, HTMLDivElement>());
  const sinceRefs = useRef(new Map<number, HTMLDivElement>());
  const binRefs = useRef(new Map<string, HTMLDivElement>());
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  const reducedMotion = useRef(false);

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

  // Load (v2 blob, else migrated v1, else seed the template) on mount.
  useEffect(() => {
    const data = loadAll();
    if (data) {
      // One-and-done chores completed on an earlier day disappear for good.
      const today = todayStr();
      const stale = new Set(
        data.config.chores
          .filter((c) => {
            if (c.kind !== "once") return false;
            const st = data.choreState.find((s) => s.id === c.id);
            return !!st?.lastDoneDate && st.lastDoneDate < today;
          })
          .map((c) => c.id)
      );
      if (stale.size > 0) {
        data.config = { ...data.config, chores: data.config.chores.filter((c) => !stale.has(c.id)) };
        data.choreState = data.choreState.filter((s) => !stale.has(s.id));
      }
      setConfig(data.config);
      setChores(buildChores(data.config, data));
      setWeekly(data.weekly.period === weekStartStr() ? data.weekly : emptyPeriod(weekStartStr()));
      if (data.monthly.period === monthStr()) {
        setMonthly(data.monthly);
        setHistory(data.history);
      } else {
        // Months turned over while the app was closed: file the finished one
        // away instead of dropping it, and start this month at zero.
        setHistory(archiveMonth(data.monthly, data.history));
        setMonthly(emptyPeriod(monthStr()));
      }
    } else {
      setNeedsOnboarding(true);
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

  // Latest monthly tally, readable from the rollover effect without re-running it.
  const monthlyRef = useRef(monthly);
  useEffect(() => { monthlyRef.current = monthly; }, [monthly]);

  // When the day changes while the app is open, roll everything over live.
  const rolloverDayRef = useRef(dayKey);
  useEffect(() => {
    if (!loaded) return;
    if (rolloverDayRef.current === dayKey) return;
    rolloverDayRef.current = dayKey;
    kierArmed.current = true;
    setKierShown(false);
    // Completed one-and-done chores leave the board with the old day.
    const doneOnce = new Set(
      chores.filter((c) => c.def.kind === "once" && c.done).map((c) => c.def.id)
    );
    if (doneOnce.size > 0) {
      setConfig((prev) => ({ ...prev, chores: prev.chores.filter((c) => !doneOnce.has(c.id)) }));
    }
    setChores((prev) =>
      prev
        .filter((c) => !doneOnce.has(c.def.id))
        .map((c) => {
          if (c.def.kind === "daily") return { ...c, doneBy: {}, expanded: false };
          if (c.def.kind === "once") return { ...c, expanded: false };
          const daysAgo = computeDaysAgo(c.lastDoneDate);
          return { ...c, daysAgo, done: daysAgo === 0, expanded: false };
        })
    );
    setWeekly((prev) => (prev.period === weekStartStr() ? prev : emptyPeriod(weekStartStr())));
    const m = monthStr();
    const finished = monthlyRef.current;
    if (finished.period !== m) {
      setHistory((prev) => archiveMonth(finished, prev));
      setMonthly(emptyPeriod(m));
      setViewMonth((prev) => (prev === finished.period ? prev : m));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dayKey, loaded]);

  // Persist the whole household in one atomic blob.
  useEffect(() => {
    if (!loaded || needsOnboarding) return;
    const data: PersistedV2 = {
      schemaVersion: 2,
      config,
      savedDate: todayStr(),
      choreState: chores.map((c) => ({
        id: c.def.id,
        doneBy: c.doneBy,
        lastDoneDate: c.lastDoneDate,
        lastBy: c.lastBy,
        partsDone: c.partsDone,
      })),
      weekly,
      monthly,
      history,
    };
    saveAll(data);
  }, [config, chores, weekly, monthly, history, loaded, needsOnboarding]);

  // Apply a settings edit and rebuild the runtime chore list, carrying over
  // today's done-state for chores that survive the edit.
  function updateConfig(mutate: (cfg: HouseholdConfig) => HouseholdConfig) {
    const next = mutate(config);
    setConfig(next);
    setChores((prev) =>
      buildChores(next, {
        savedDate: todayStr(),
        choreState: prev.map((c) => {
          // A chore switched to one-and-done starts pending — without this it
          // would inherit the cycle seed date and be born already "done".
          const nextDef = next.chores.find((d) => d.id === c.def.id);
          const becameOnce = nextDef?.kind === "once" && c.def.kind !== "once";
          return {
            id: c.def.id,
            doneBy: c.doneBy,
            lastDoneDate: becameOnce ? null : c.lastDoneDate,
            lastBy: becameOnce ? null : c.lastBy,
            partsDone: c.partsDone,
          };
        }),
      })
    );
  }

  function completeOnboarding(newPeople: Person[], mode: "template" | "empty") {
    const cfg = mode === "template" ? templateConfig(newPeople) : emptyConfig(newPeople);
    setConfig(cfg);
    setChores(buildChores(cfg, null));
    setNeedsOnboarding(false);
  }

  // ── Handlers
  function toggleCard(i: number) {
    setChores((prev) =>
      prev.map((c, idx) => {
        if (idx !== i) return { ...c, expanded: false };
        if (c.def.kind !== "daily" && c.done) return { ...c, expanded: false };
        return { ...c, expanded: !c.expanded };
      })
    );
  }

  // Adjust this week's AND this month's tally for a person/chore (clamped at 0).
  function bump(choreId: string, personId: string, delta: number) {
    const apply = (base: PeriodLogV2): PeriodLogV2 => {
      const rec = base.tallies[personId] ?? {};
      const next = Math.max(0, (rec[choreId] ?? 0) + delta);
      return { ...base, tallies: { ...base.tallies, [personId]: { ...rec, [choreId]: next } } };
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
  function launch(i: number, person: Person) {
    if (reducedMotion.current) return;
    const c = chores[i];
    if (!c) return;
    const binId = c.def.binId;
    const nameEl = nameRefs.current.get(i);
    const binEl = binRefs.current.get(binId);
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
    // Hold this bin's gauge at its pre-log value until the letters land.
    const binDef = config.bins.find((bb) => bb.id === binId);
    const held = binDef ? binPct(binDef, chores, people) : 0;
    setFrozenPct((m) => new Map(m).set(binId, held));
    setFlights((f) => [...f, { id, binId, color: person.color, pieces }]);
    setHiddenNames((s) => setToggle(s, i, true));

    later(() => {
      setHiddenNames((s) => setToggle(s, i, false));
      setReturningNames((s) => setToggle(s, i, true));
      later(() => setReturningNames((s) => setToggle(s, i, false)), RETURN_MS);
    }, REASSEMBLE_DELAY);

    later(() => setOpenBins((s) => new Set(s).add(binId)), SCATTER_MS + 80);

    later(() => {
      setFlights((f) => {
        const rest = f.filter((x) => x.id !== id);
        if (!rest.some((x) => x.binId === binId)) {
          // Last letters for this bin just landed: release the gauge, flash
          // the glow, and shut the doors.
          setFrozenPct((m) => { const n = new Map(m); n.delete(binId); return n; });
          setReceivingBins((s) => new Set(s).add(binId));
          later(() => setReceivingBins((s) => { const n = new Set(s); n.delete(binId); return n; }), 600);
          later(() => setOpenBins((s) => { const n = new Set(s); n.delete(binId); return n; }), 250);
        }
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

  function logDaily(i: number, person: Person) {
    const c = chores[i];
    if (!c) return;
    // Checking on counts toward this month; un-checking (a fix) backs it out.
    const turningOn = !c.doneBy[person.id];
    if (turningOn) launch(i, person);
    bump(c.def.id, person.id, turningOn ? 1 : -1);
    setChores((prev) =>
      prev.map((cc, idx) => {
        if (idx !== i) return cc;
        const doneBy = { ...cc.doneBy, [person.id]: turningOn };
        const full = resolveAssignees(cc.def, people).every((p) => doneBy[p.id]);
        return { ...cc, doneBy, expanded: full ? false : cc.expanded };
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

  function logCycle(i: number, person: Person) {
    const c = chores[i];
    if (!c) return;
    // A chore with sub-tasks isn't done until every one of them is ticked.
    if (!allPartsDone(c)) return;
    launch(i, person);
    const today = todayStr();
    bump(c.def.id, person.id, 1);
    setChores((prev) =>
      prev.map((cc, idx) => {
        if (idx !== i) return cc;
        return {
          ...cc,
          done: true,
          lastBy: person.id,
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
  const dailyChores = chores.filter((c) => c.def.kind === "daily");
  const allDone = dailyChores.length > 0 && dailyChores.every((c) => dailyDone(c, people));
  const overall = overallPct(config.bins, chores, people);

  // Kier appears once per day, edge-triggered on crossing into 100% — after
  // the last letters have had time to land in their bin.
  const prevOverallRef = useRef(overall);
  const kierBaselineSet = useRef(false);
  useEffect(() => {
    // First run after load is the baseline, not an edge — otherwise opening
    // the app while already at 100% replays the overlay.
    if (loaded && !kierBaselineSet.current) {
      kierBaselineSet.current = true;
      prevOverallRef.current = overall;
      return;
    }
    if (loaded && kierArmed.current && prevOverallRef.current < 100 && overall === 100) {
      kierArmed.current = false;
      later(() => setKierShown(true), FLIGHT_MS + 400);
    }
    prevOverallRef.current = overall;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overall, loaded]);
  // People who have finished every daily chore assigned to them.
  const finishedPeople = people.filter((p) => {
    const mine = dailyChores.filter((c) => resolveAssignees(c.def, people).some((a) => a.id === p.id));
    return mine.length > 0 && mine.every((c) => c.doneBy[p.id]);
  });

  // ── Overview totals
  const personSum = (log: PeriodLogV2, personId: string) =>
    Object.values(log.tallies[personId] ?? {}).reduce((a, b) => a + b, 0);
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
  const monthLabel = monthLabelOf(shownMonth);
  const weekLabel = `WEEK OF ${new Date(weekStartStr() + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" }).toUpperCase()}`;

  // ── Swipe (native listeners so Safari doesn't suppress them)
  const pageRef = useRef(page);
  useEffect(() => { pageRef.current = page; }, [page]);

  useEffect(() => {
    const el = pagesRef.current;
    if (!el) return;
    let startX = 0;
    const onStart = (e: TouchEvent) => { startX = e.touches[0].clientX; };
    const onEnd = (e: TouchEvent) => {
      const diff = startX - e.changedTouches[0].clientX;
      if (Math.abs(diff) < 30) return;
      if (diff > 0) setPage(Math.min(2, pageRef.current + 1));
      if (diff < 0) setPage(Math.max(0, pageRef.current - 1));
    };
    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchend", onEnd, { passive: true });
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchend", onEnd);
    };
  }, []);

  // The same nav strip on every page, always on the right: previous page on
  // the left, dots in the middle, next page on the right.
  const PAGE_NAMES = ["Board", "Overview", "Settings"];
  const pageNav = (
    <span className="page-nav">
      <span className="nav-slot prev">
        {page > 0 && (
          <button className="nav-btn" onClick={() => setPage(page - 1)}>← {PAGE_NAMES[page - 1]}</button>
        )}
      </span>
      <span className="page-dots">
        {[0, 1, 2].map((n) => (
          <span key={n} className={`dot ${page === n ? "active" : ""}`} onClick={() => setPage(n)} style={{ cursor: "pointer" }} />
        ))}
      </span>
      <span className="nav-slot next">
        {page < 2 && (
          <button className="nav-btn" onClick={() => setPage(page + 1)}>{PAGE_NAMES[page + 1]} →</button>
        )}
      </span>
    </span>
  );

  return (
    <div className="clip-wrap scanlines">
    <DigitField />
    <TerminalFrame dateStr={dateStr} pct={overall} />
    <div ref={pagesRef} className="pages">
      {/* ── PAGE 1: BOARD ── */}
      <div className={`page board-page${page === 0 ? " page-active" : ""}`}>
        <div className="legend">
          {people.map((p) => (
            <span key={p.id}><span className="leg-dot" style={{ background: p.color }} />{p.name}</span>
          ))}
          {pageNav}
        </div>

        <div className="board-grid">
          {chores.map((c, i) => {
            const urg = getUrgency(c);
            const assignees = resolveAssignees(c.def, people);
            if (c.def.kind === "daily") {
              const full = dailyDone(c, people);
              return (
                <div key={c.def.id} className={`card-wrap ${c.expanded ? "has-panel" : ""}`}>
                  <div className={`task-card${full ? " chore-done" : ""}`} onClick={() => toggleCard(i)}>
                    {c.def.icon && (
                      <div className="card-image-bg" style={{ backgroundImage: `url(${c.def.icon})` }} />
                    )}
                    <div className="card-top">
                      <div className={`card-name${nameClass(i)}`} ref={(el) => setNameRef(i, el)}>{c.def.name}</div>
                      <div className={`card-since ${sinceClass(c, people)}${nameClass(i)}`} ref={(el) => setSinceRef(i, el)}>{sinceText(c, people)}</div>
                    </div>
                    <div className="card-bottom">
                      <div className="person-chips">
                        {assignees.map((p) => (
                          <span
                            key={p.id}
                            className={`person-chip${c.doneBy[p.id] ? " done" : ""}`}
                            style={pcStyle(p.color)}
                          >
                            {p.name[0]?.toUpperCase()}
                          </span>
                        ))}
                      </div>
                      {full && <div className="card-check">✓</div>}
                    </div>
                  </div>
                  <div className={`log-panel ${c.expanded ? "open" : ""}`}>
                    {assignees.map((p) => (
                      <button
                        key={p.id}
                        className={`log-btn person-btn ${c.doneBy[p.id] ? "selected" : ""}`}
                        style={pcStyle(p.color)}
                        onClick={(e) => { e.stopPropagation(); logDaily(i, p); }}
                      >
                        {c.doneBy[p.id] ? `✓ ${p.name}` : `+ ${p.name}`}
                      </button>
                    ))}
                  </div>
                </div>
              );
            }

            const lastPerson = people.find((p) => p.id === c.lastBy) ?? null;
            return (
              <div key={c.def.id} className={`card-wrap ${c.expanded ? "has-panel" : ""}`}>
                <div className={`task-card${c.done ? " chore-done" : ""} age-${urg}`} onClick={() => toggleCard(i)}>
                  {c.def.icon && (
                    <div className="card-image-bg" style={{ backgroundImage: `url(${c.def.icon})` }} />
                  )}
                  <div className="card-top">
                    <div className={`card-name${nameClass(i)}`} ref={(el) => setNameRef(i, el)}>{c.def.name}</div>
                    <div className={`card-since ${sinceClass(c, people)}${nameClass(i)}`} ref={(el) => setSinceRef(i, el)}>{sinceText(c, people)}</div>
                  </div>
                  <div className="card-bottom">
                    <div className="cycle-day">
                      {c.done
                        ? <span className="person-chip done" style={pcStyle(lastPerson?.color ?? "#e8f2f8")}>{lastPerson?.name[0]?.toUpperCase() ?? "✓"}</span>
                        : <span className="day-count">{c.def.kind === "once" ? "ONCE" : `DAY ${c.daysAgo}/${c.def.cycleDays}`}</span>}
                    </div>
                    <div className="who-status" style={{
                      color: c.done && lastPerson ? lastPerson.color : "var(--sub)",
                    }}>
                      {c.done
                        ? (lastPerson?.name ?? "✓")
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
                      {assignees.map((p) => (
                        <button
                          key={p.id}
                          className="log-btn person-btn"
                          style={pcStyle(p.color)}
                          disabled={!allPartsDone(c)}
                          onClick={(e) => { e.stopPropagation(); logCycle(i, p); }}
                        >+ {p.name}</button>
                      ))}
                    </div>
                    {!allPartsDone(c) && (
                      <div className="parts-hint">Finish {c.def.parts.join(" and ")} to log it</div>
                    )}
                  </div>
                )}
                {!c.done && !c.def.parts && (
                  <div className={`log-panel ${c.expanded ? "open" : ""}`}>
                    {assignees.map((p) => (
                      <button
                        key={p.id}
                        className="log-btn person-btn"
                        style={pcStyle(p.color)}
                        onClick={(e) => { e.stopPropagation(); logCycle(i, p); }}
                      >+ {p.name}</button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {!allDone && finishedPeople.map((p) => (
          <div key={p.id} className="done-banner praise-banner" style={pcStyle(p.color)}>
            <div className="done-banner-title">Good Job, Innie {p.name}!</div>
            <div className="done-banner-sub">You have completed your tasks.</div>
          </div>
        ))}

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
              <div className="ov-subtitle">{weekLabel}</div>
            </div>
          </div>
          {pageNav}
        </div>

        <div className="ov-body">
          <div className="ov-col-left">
            <div className="ov-section-label" style={{ marginTop: "4px" }}>This week</div>
            <div className="ov-scorecards">
              {people.map((p) => (
                <div key={p.id} className="scorecard" style={{ borderColor: p.color }}>
                  <div className="sc-name" style={{ color: p.color }}>{p.name}</div>
                  <div className="sc-num" style={{ color: p.color }}>{personSum(weekly, p.id)}</div>
                  <div className="sc-label">chores logged</div>
                </div>
              ))}
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
              {people.map((p) => (
                <div key={p.id} className="scorecard" style={{ borderColor: p.color }}>
                  <div className="sc-name" style={{ color: p.color }}>{p.name}</div>
                  <div className="sc-num" style={{ color: p.color }}>{personSum(shownLog, p.id)}</div>
                  <div className="sc-label">chores logged</div>
                </div>
              ))}
            </div>
          </div>

          <div className="ov-col-right">
            <div className="ov-section-label">By chore · {isThisMonth ? "this month" : monthLabel}</div>
            <div className="ov-table">
              {config.chores.map((def) => {
                const counts = people.map((p) => shownLog.tallies[p.id]?.[def.id] ?? 0);
                const max = Math.max(...counts, 1);
                return (
                  <div key={def.id} className="ov-row">
                    <div className="ov-chore-icon">
                      {def.icon
                        ? <img src={def.icon} alt={def.name} className="ov-icon-img" />
                        : <span style={{ fontSize: "1rem", opacity: 0.45 }}>□</span>}
                    </div>
                    <div className="ov-chore-name">{def.name}</div>
                    <div className="ov-bars">
                      {people.map((p, j) => (
                        <div key={p.id} className="ov-bar-row">
                          <div className="ov-bar-track">
                            <div className="ov-bar-fill" style={{ width: `${(counts[j] / max) * 100}%`, background: p.color }} />
                          </div>
                          <div className="ov-count" style={{ color: p.color }}>{counts[j]}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div className="bottom-pad" />
      </div>
      {/* ── PAGE 3: MANAGE ── */}
      <div className={`page settings-page${page === 2 ? " page-active" : ""}`}>
        <div className="ov-header">
          <div className="header-top">
            <div>
              <div className="ov-title">Settings</div>
            </div>
            <div className="header-right">
              <div className="ov-subtitle">HOUSEHOLD CONFIG</div>
            </div>
          </div>
          {pageNav}
        </div>
        <SettingsPage config={config} onUpdate={updateConfig} />
        <div className="bottom-pad" />
      </div>
    </div>

    {needsOnboarding && <Onboarding onComplete={completeOnboarding} />}
    <KierOverlay
      show={kierShown}
      title={config.messages.completeTitle}
      tagline={config.messages.completeTagline}
      onDismiss={() => setKierShown(false)}
    />

    {/* ── MDR LAYER: flying letters + the bin ── */}
    <div className={`mdr-layer${page === 0 ? "" : " mdr-hidden"}`} aria-hidden>
      {flights.map((f) =>
        f.pieces.map((p, k) => (
          <span
            key={`${f.id}-${k}`}
            className={`mdr-piece${p.sub ? " mdr-sub" : ""}`}
            style={{ left: p.x, top: p.y, width: p.w, height: p.h, color: f.color }}
            ref={(el) => animatePiece(el, p)}
          >{p.ch}</span>
        ))
      )}
      <div className="bin-dock">
        {[...config.bins].sort((a, b) => a.order - b.order).map((b) => {
          const shown = frozenPct.get(b.id) ?? binPct(b, chores, people);
          return (
            <div
              key={b.id}
              ref={(el) => { if (el) binRefs.current.set(b.id, el); else binRefs.current.delete(b.id); }}
              className={`bin${openBins.has(b.id) ? " open" : ""}${receivingBins.has(b.id) ? " receiving" : ""}`}
            >
              <div className="mdr-lid">
                <div className="mdr-door mdr-door-l" />
                <div className="mdr-door mdr-door-r" />
              </div>
              <div className="bin-tag">
                <span className="bin-num">{b.num}</span>
                <span className="bin-cat">{b.label}</span>
              </div>
              <div className="bin-gauge">
                <div className="bin-fill" style={{ width: `${shown}%` }} />
                <div className="bin-val">{shown}%</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
    </div>
  );
}
