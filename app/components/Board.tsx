"use client";

import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import { createPortal } from "react-dom";
import { ChoreState, HouseholdConfig, Person } from "@/lib/model";
import { todayStr } from "@/lib/time";
import {
  activeChoreMessages,
  allPartsDone,
  binPct,
  dailyDone,
  fillName,
  getUrgency,
  overallExactPct,
  overallPct,
  resolveAssignees,
  sinceClass,
  sinceText,
} from "@/lib/logic";
import type { Toast } from "./ToastOverlay";

// The chore board for one chore list: the cards, the letter-flight animation
// into the bins, the bin dock with its gauges, and the momentary messages
// (bin cleared, chore message, praise) plus the once-a-day celebration edge.
//
// It knows nothing about storage or which household it belongs to — the
// parent owns the chore state and hands it down with a setter, so the same
// component can render the shared household board or a person's own space.
//
// The bins and flying letters are a fixed overlay that must sit outside the
// swiping `.pages` container (same stacking as before the split), so they
// are portalled into `flightRoot`, a slot the parent renders where the
// overlay used to live.

// Completion-flight animation timing
const FLIGHT_MS = 2250;        // letter lifetime: scatter, then fall into the bin
const SCATTER_MS = 650;        // scatter phase within FLIGHT_MS
const REASSEMBLE_DELAY = 2000; // name fades back onto the card after this
const RETURN_MS = 440;         // length of the reassemble animation

// Each glyph also throws off a little refined "dust" on its way to the bin.
const DUST_PER_NAME_GLYPH = 2;
const DUST_PER_SUB_GLYPH = 1;
const DUST_CHARS = "0123456789";

// One letter of a chore name, in viewport px, with its flight path to the bin
// pre-rolled so rendering stays pure.
interface Piece {
  ch: string; x: number; y: number; w: number; h: number;
  sub: boolean;                          // from the small subtitle line, not the name
  dust: boolean;                         // scattered particle, not an actual letter
  sx: number; sy: number; rot: number;   // scatter offset + spin
  dx: number; dy: number; delay: number; // final offset into the bin
}
interface Flight { id: number; binId: string; color: string; pieces: Piece[] }

// Until real onboarding (Phase 4), a brand-new device gets the template

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
      ch: text[k], x: r.left, y: r.top, w: r.width, h: r.height, sub, dust: false,
      sx: (Math.random() - 0.5) * 60,
      sy: -(10 + Math.random() * 30),
      rot: (Math.random() - 0.5) * 90,
      dx: bin.x - r.left - r.width / 2 + (Math.random() - 0.5) * 24,
      dy: bin.y - r.top,
      delay: Math.random() * 120,
    });
    // Dust: smaller particles thrown off the same glyph, flying wider.
    const dustCount = sub ? DUST_PER_SUB_GLYPH : DUST_PER_NAME_GLYPH;
    for (let d = 0; d < dustCount; d++) {
      const px = r.left + (Math.random() - 0.5) * 10;
      const py = r.top + (Math.random() - 0.5) * 8;
      pieces.push({
        ch: DUST_CHARS[Math.floor(Math.random() * DUST_CHARS.length)],
        x: px, y: py, w: r.width, h: r.height, sub, dust: true,
        sx: (Math.random() - 0.5) * 110,
        sy: -(6 + Math.random() * 48),
        rot: (Math.random() - 0.5) * 180,
        dx: bin.x - px - r.width / 2 + (Math.random() - 0.5) * 46,
        dy: bin.y - py,
        delay: Math.random() * 260,
      });
    }
  }
  return pieces;
}

export interface BoardProps {
  config: HouseholdConfig;
  chores: ChoreState[];
  setChores: Dispatch<SetStateAction<ChoreState[]>>;
  loaded: boolean;
  // Whether this is the page on screen — hides the flight overlay otherwise.
  active: boolean;
  // Today's date; a change re-arms the once-a-day celebration.
  dayKey: string;
  // The page-nav strip, rendered at the right of the legend.
  nav: ReactNode;
  flightRoot: HTMLElement | null;
  // A person logged (delta +1) or un-logged (delta -1) a chore: the parent
  // keeps the weekly/monthly tallies.
  onLog: (choreId: string, personId: string, delta: number) => void;
  onToasts: (fresh: Toast[]) => void;
  onCelebrate: (pct: number) => void;
}

export default function Board({
  config,
  chores,
  setChores,
  loaded,
  active,
  dayKey,
  nav,
  flightRoot,
  onLog,
  onToasts,
  onCelebrate,
}: BoardProps) {
  const people = config.people;

  // Callbacks are read through refs so a timer that fires after a re-render
  // still reaches the parent's latest handler.
  const onToastsRef = useRef(onToasts);
  useEffect(() => { onToastsRef.current = onToasts; }, [onToasts]);
  const onCelebrateRef = useRef(onCelebrate);
  useEffect(() => { onCelebrateRef.current = onCelebrate; }, [onCelebrate]);

  const toastSeen = useRef<Set<string>>(new Set());
  const toastBaseline = useRef(false);
  // Whose tap last landed in which bin — that's who a "bin cleared" message
  // is credited to, and whose colour it borrows.
  const lastActor = useRef<{ person: Person; binId: string } | null>(null);
  const prevBinPct = useRef<Map<string, number | null>>(new Map());
  const binBaseline = useRef(false);
  const binCfgRef = useRef<HouseholdConfig | null>(null);
  const celebrateArmed = useRef(true); // fires once per day, re-armed at rollover
  useEffect(() => { celebrateArmed.current = true; }, [dayKey]);

  // ── completion-flight animation state
  const [flights, setFlights] = useState<Flight[]>([]);
  const [hiddenNames, setHiddenNames] = useState<Set<number>>(() => new Set());
  const [returningNames, setReturningNames] = useState<Set<number>>(() => new Set());
  const [openBins, setOpenBins] = useState<Set<string>>(() => new Set());
  const [receivingBins, setReceivingBins] = useState<Set<string>>(() => new Set());
  // Gauges held at their pre-log value while letters are in the air.
  const [frozenPct, setFrozenPct] = useState<Map<string, number | null>>(() => new Map());
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
    if (hiddenNames.has(i)) return " name-hidden";
    if (returningNames.has(i)) return " name-return";
    return "";
  }

  const setToggle = (s: Set<number>, i: number, on: boolean) => {
    const n = new Set(s);
    if (on) n.add(i); else n.delete(i);
    return n;
  };

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
    const held = binDef ? binPct(binDef, chores, people) : null;
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
    if (turningOn) { lastActor.current = { person, binId: c.def.binId }; launch(i, person); }
    onLog(c.def.id, person.id, turningOn ? 1 : -1);
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
    lastActor.current = { person, binId: c.def.binId };
    launch(i, person);
    const today = todayStr();
    onLog(c.def.id, person.id, 1);
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

  // Overdue first, then aging, then everything else, with finished chores
  // sinking to the bottom — the board reads as a to-do list. The original
  // index rides along because handlers and refs are keyed on it.
  const rankOf = (c: ChoreState) => {
    const isDone = c.def.kind === "daily" ? dailyDone(c, people) : c.done;
    if (isDone) return 3;
    const u = getUrgency(c);
    return u === "red" ? 0 : u === "yellow" ? 1 : 2;
  };
  const boardOrder = chores
    .map((c, i) => ({ c, i }))
    .sort((a, b) => rankOf(a.c) - rankOf(b.c) || a.i - b.i);

  // ── Progress
  const dailyChores = chores.filter((c) => c.def.kind === "daily");
  const overall = overallPct(config.bins, chores, people, config.scoring) ?? 0;
  // Unrounded, so a 99.5% board can't trip a 100% threshold.
  const exact = overallExactPct(config.bins, chores, people, config.scoring);
  const choreMsgs = activeChoreMessages(chores, people);

  // A bin's message fires the moment that bin goes clear. Same edge-detection
  // shape as the celebration: baseline the first pass, and treat a settings
  // edit as a rebaseline rather than an achievement.
  const binPcts = config.bins.map((b) => ({ bin: b, pct: binPct(b, chores, people) }));
  const binPctKey = binPcts.map(({ bin, pct }) => `${bin.id}:${pct}`).join("|");
  useEffect(() => {
    if (!loaded) return;
    const sync = () => {
      const next = new Map<string, number | null>();
      const fresh: Toast[] = [];
      const rebaseline = !binBaseline.current || binCfgRef.current !== config;
      for (const { bin, pct } of binPcts) {
        next.set(bin.id, pct);
        if (rebaseline) continue;
        const prev = prevBinPct.current.get(bin.id);
        const msg = (bin.message ?? "").trim();
        if (!msg) continue;
        if (prev === undefined || prev === null || prev >= 100) continue;
        if (pct !== 100) continue;
        const actor = lastActor.current?.binId === bin.id ? lastActor.current.person : null;
        fresh.push({
          key: `b:${bin.id}`,
          title: msg,
          sub: `${bin.num} ${bin.label}`,
          color: actor ? actor.color : null,
        });
      }
      prevBinPct.current = next;
      binBaseline.current = true;
      binCfgRef.current = config;
      if (fresh.length > 0) onToastsRef.current(fresh);
    };
    sync();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [binPctKey, loaded, config]);

  // The celebration fires once per day, when the percentage crosses up into
  // the household's threshold — after the last letters have landed.
  const celebratePctRef = useRef(overall);
  useEffect(() => { celebratePctRef.current = overall; });
  const prevExactRef = useRef<number | null>(exact);
  const celebrateBaselineSet = useRef(false);
  const celebrateCfgRef = useRef(config);
  useEffect(() => {
    if (!loaded) return;
    // First run after load is the baseline, not an edge — otherwise opening
    // the app while already complete replays the overlay.
    if (!celebrateBaselineSet.current) {
      celebrateBaselineSet.current = true;
      prevExactRef.current = exact;
      celebrateCfgRef.current = config;
      return;
    }
    // A settings edit (scoring, threshold, adding/deleting chores) can move the
    // number without anyone doing work — rebaseline instead of celebrating.
    if (celebrateCfgRef.current !== config) {
      celebrateCfgRef.current = config;
      prevExactRef.current = exact;
      return;
    }
    const prev = prevExactRef.current;
    prevExactRef.current = exact;
    if (!celebrateArmed.current) return;
    if (exact === null || prev === null) return; // nothing counted
    const t = config.scoring.celebrateAt;
    if (prev >= t || exact < t) return;          // not an upward crossing
    celebrateArmed.current = false;
    later(() => onCelebrateRef.current(celebratePctRef.current), FLIGHT_MS + 400);
  }, [exact, loaded, config]);
  // People who have finished every daily chore assigned to them.
  const finishedPeople = people.filter((p) => {
    const mine = dailyChores.filter((c) => resolveAssignees(c.def, people).some((a) => a.id === p.id));
    return mine.length > 0 && mine.every((c) => c.doneBy[p.id]);
  });

  // Completion messages are momentary: enqueue one the moment it becomes true,
  // rather than parking a banner on the board for as long as it stays true.
  const toastKeys = [
    ...choreMsgs.map((m) => `c:${m.choreId}:${m.byName ?? ""}`),
    ...finishedPeople.map((p) => `p:${p.id}`),
  ].join("|");
  useEffect(() => {
    if (!loaded) return;
    const sync = () => {
      const active = new Set<string>();
      const fresh: Toast[] = [];
      for (const m of choreMsgs) {
        const key = `c:${m.choreId}:${m.byName ?? ""}`;
        active.add(key);
        if (!toastSeen.current.has(key)) {
          fresh.push({
            key,
            title: m.text,
            sub: `${m.choreName}${m.byName ? ` · ${m.byName}` : ""}`,
            color: m.tintColor,
          });
        }
      }
      for (const p of finishedPeople) {
        const key = `p:${p.id}`;
        active.add(key);
        if (!toastSeen.current.has(key)) {
          fresh.push({
            key,
            title: fillName(config.messages.praiseTitle, p.name),
            sub: fillName(config.messages.praiseSub, p.name),
            color: p.color,
          });
        }
      }
      toastSeen.current = active;
      // Whatever is already true when the app opens is history, not news.
      if (!toastBaseline.current) { toastBaseline.current = true; return; }
      if (fresh.length > 0) onToastsRef.current(fresh);
    };
    sync();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toastKeys, loaded]);

  // ── FLIGHT LAYER: flying letters + the bins (portalled, see flightRoot)
  const flightLayer = (
    <div className={`flight-layer${active ? "" : " flight-hidden"}`} aria-hidden>
      {flights.map((f) =>
        f.pieces.map((p, k) => (
          <span
            key={`${f.id}-${k}`}
            className={`flight-piece${p.sub ? " flight-sub" : ""}${p.dust ? " flight-dust" : ""}`}
            style={{ left: p.x, top: p.y, width: p.w, height: p.h, color: f.color }}
            ref={(el) => animatePiece(el, p)}
          >{p.ch}</span>
        ))
      )}
      <div className="bin-dock">
        {[...config.bins].sort((a, b) => a.order - b.order).map((b) => {
          // `.has()` not `??` — null is now a meaningful frozen value.
          const shown = frozenPct.has(b.id)
            ? frozenPct.get(b.id)!
            : binPct(b, chores, people);
          return (
            <div
              key={b.id}
              ref={(el) => { if (el) binRefs.current.set(b.id, el); else binRefs.current.delete(b.id); }}
              className={`bin${openBins.has(b.id) ? " open" : ""}${receivingBins.has(b.id) ? " receiving" : ""}`}
            >
              <div className="bin-lid">
                <div className="bin-door bin-door-l" />
                <div className="bin-door bin-door-r" />
              </div>
              <div className="bin-tag">
                <span className="bin-num">{b.num}</span>
                <span className="bin-cat">{b.label}</span>
              </div>
              <div className="bin-gauge">
                <div className="bin-fill" style={{ width: `${shown ?? 0}%` }} />
                <div className="bin-val">{shown === null ? "—" : `${shown}%`}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );

  return (
    <>
      {/* ── PAGE 1: BOARD ── */}
      <div className={`page board-page${active ? " page-active" : ""}`}>
        <div className="legend">
          {people.map((p) => (
            <span key={p.id}><span className="leg-dot" style={{ background: p.color }} />{p.name}</span>
          ))}
          {nav}
        </div>

        <div className="board-grid">
          {boardOrder.map(({ c, i }) => {
            const urg = getUrgency(c);
            const assignees = resolveAssignees(c.def, people);
            if (c.def.kind === "daily") {
              const full = dailyDone(c, people);
              return (
                <div key={c.def.id} className={`card-wrap ${c.expanded ? "has-panel" : ""}`}>
                  <div className={`task-card kind-daily${full ? " chore-done" : ""}`} onClick={() => toggleCard(i)}>
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

        <div className="bottom-pad" />
      </div>
      {flightRoot && createPortal(flightLayer, flightRoot)}
    </>
  );
}
