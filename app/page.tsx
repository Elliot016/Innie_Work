"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  HouseholdConfig,
  PeriodLogV2,
  PersistedV2,
  Person,
  SPACE_MOTTO,
  SpaceData,
  emptyConfig,
  emptyPeriod,
  spaceConfig,
  templateConfig,
  templateSpace,
} from "@/lib/model";
import { monthLabelOf, monthStr, todayStr, weekStartStr } from "@/lib/time";
import { overallPct, stripStaleOnce } from "@/lib/logic";
import { loadAll, saveAll } from "@/lib/storage";
import { backupIsStale, requestPersistence } from "@/lib/backup";
import Board from "./components/Board";
import DigitField from "./components/DigitField";
import CompleteOverlay from "./components/CompleteOverlay";
import Onboarding from "./components/Onboarding";
import SettingsPage from "./components/SettingsPage";
import Screensaver from "./components/Screensaver";
import ToastOverlay, { type Toast } from "./components/ToastOverlay";
import TerminalFrame from "./components/TerminalFrame";
import WhoGate, { NOBODY, type Viewer } from "./components/WhoGate";
import { useChoreEngine } from "./hooks/useChoreEngine";
import { useIdle } from "./hooks/useIdle";
import { useWakeLock } from "./hooks/useWakeLock";

// Until real onboarding (Phase 4), a brand-new device gets the template
// household — the same board a fresh install had before.
const DEFAULT_PEOPLE: Person[] = [
  { id: "elliot", name: "Elliot", color: "#F0C94A" },
  { id: "paisley", name: "Paisley", color: "#F5A0B0" },
];

export default function Home() {
  const [config, setConfig] = useState<HouseholdConfig>(() => templateConfig(DEFAULT_PEOPLE));
  // Personal spaces, keyed by person id. The one being viewed also runs live
  // in `personal` below; its running state folds back in here on leaving.
  const [spaces, setSpaces] = useState<Record<string, SpaceData>>({});
  const [viewer, setViewer] = useState<Viewer>(NOBODY);
  const [viewMonth, setViewMonth] = useState<string>(() => monthStr());
  const [page, setPage] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [needsOnboarding, setNeedsOnboarding] = useState(false);
  // "stale" = no downloaded backup in a fortnight; "corrupt" = we found a
  // board we couldn't read and set it aside instead of overwriting it.
  const [dataAlert, setDataAlert] = useState<"stale" | "corrupt" | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const dismissToast = useCallback(() => setToasts((q) => q.slice(1)), []);
  const pushToasts = useCallback((fresh: Toast[]) => setToasts((q) => [...q, ...fresh]), []);
  const [celebrateShown, setCelebrateShown] = useState(false);
  const [celebratePct, setCelebratePct] = useState(100);
  const celebrate = useCallback((pct: number) => { setCelebratePct(pct); setCelebrateShown(true); }, []);
  const [dayKey, setDayKey] = useState(() => todayStr());
  const pagesRef = useRef<HTMLDivElement>(null);
  // Where the board mounts its fixed overlay (flying letters + bin dock).
  const [flightRoot, setFlightRoot] = useState<HTMLDivElement | null>(null);

  // Two running chore lists: the household's, always loaded, and one for
  // whichever person is viewing their own space.
  const household = useChoreEngine({
    dayKey,
    onRemoveChores: (ids) =>
      setConfig((prev) => ({ ...prev, chores: prev.chores.filter((c) => !ids.has(c.id)) })),
    onRollover: () => setCelebrateShown(false),
  });
  const personal = useChoreEngine({
    dayKey,
    onRemoveChores: (ids) => {
      if (viewer.kind !== "person") return;
      const id = viewer.id;
      setSpaces((s) =>
        s[id] ? { ...s, [id]: { ...s[id], chores: s[id].chores.filter((c) => !ids.has(c.id)) } } : s
      );
    },
  });

  // What's on screen: a person's space, or the household (also while the
  // gate is up, so there's a board behind it).
  const owner = viewer.kind === "person" ? config.people.find((p) => p.id === viewer.id) ?? null : null;
  const space = owner ? spaces[owner.id] ?? null : null;
  // Memoised: the board treats a new config identity as a settings edit and
  // rebaselines its messages, so this must only change when the data does.
  const spaceCfg = useMemo(
    () => (owner && space ? spaceConfig(config, owner, space) : null),
    [config, owner, space]
  );
  const inSpace = spaceCfg !== null;
  const active = inSpace
    ? { key: owner!.id, config: spaceCfg, engine: personal }
    : { key: "household", config, engine: household };
  const people = active.config.people;

  const dateStr = new Date().toLocaleDateString("en-US", {
    weekday: "short", month: "short", day: "numeric",
  }).toUpperCase();

  // Load (v2 blob, else migrated v1, else seed the template) on mount.
  const loadHousehold = household.load;
  useEffect(() => {
    requestPersistence();
    const res = loadAll();
    if (res.status === "ok" || res.status === "migrated") {
      const data = res.data;
      const today = todayStr();
      const stripped = stripStaleOnce(data.config.chores, data.choreState, today);
      const cfg = stripped.changed ? { ...data.config, chores: stripped.chores } : data.config;
      setConfig(cfg);
      loadHousehold(cfg, { ...data, choreState: stripped.choreState });
      // Same cleanup for every space, opened or not.
      const cleaned: Record<string, SpaceData> = {};
      for (const [id, sp] of Object.entries(data.spaces)) {
        const st = stripStaleOnce(sp.chores, sp.choreState, today);
        cleaned[id] = st.changed ? { ...sp, chores: st.chores, choreState: st.choreState } : sp;
      }
      setSpaces(cleaned);
    } else {
      // "corrupt" also lands here — the board can't render without data, so
      // onboarding still runs. The original was already set aside by loadAll,
      // and Settings › Data lists it as a restorable copy.
      if (res.status === "corrupt") setDataAlert("corrupt");
      setNeedsOnboarding(true);
    }
    // Only nag someone who actually has a board to lose.
    if (res.status === "ok" && backupIsStale()) setDataAlert("stale");
    setLoaded(true);
  }, [loadHousehold]);

  // Storage problems ride the same queue as every other message. Deferred a
  // beat so it lands after the board paints rather than fighting it.
  useEffect(() => {
    if (!loaded || !dataAlert) return;
    const t = setTimeout(() => {
      setToasts((q) => [...q, dataAlert === "corrupt"
        ? { key: "data:corrupt", title: "EARLIER BOARD SET ASIDE",
            sub: "unreadable — restore it in settings › data", color: "#e07070" }
        : { key: "data:stale", title: "BACK UP YOUR BOARD",
            sub: "settings › data › download backup file", color: "#e0c060" }]);
      setDataAlert(null);
    }, 1200);
    return () => clearTimeout(t);
  }, [loaded, dataAlert]);

  // Tick once a minute; when the calendar day actually rolls over, update dayKey.
  useEffect(() => {
    const id = setInterval(() => {
      const d = todayStr();
      setDayKey((prev) => (prev === d ? prev : d));
    }, 60000);
    return () => clearInterval(id);
  }, []);

  // Leaving a person's board (idle, or the logo tap): fold its running state
  // back into `spaces` so the next save and the next visit both see it.
  const leaveSpace = () => {
    if (viewer.kind !== "person") return;
    const id = viewer.id;
    const saved = personal.toSaved();
    setSpaces((s) => (s[id] ? { ...s, [id]: { ...s[id], ...saved } } : s));
  };
  const leaveRef = useRef(leaveSpace);
  useEffect(() => { leaveRef.current = leaveSpace; });

  // Idle screensaver + keep the wall panel awake. The saver never covers
  // onboarding or the celebration; those are dismissed first, and that tap
  // counts as activity. Going idle also forgets who was viewing, so waking
  // the panel asks "who are you?" again.
  const { idle, wake, sleep } = useIdle(config.display.screensaverMin * 60_000, () => {
    leaveRef.current();
    setViewer(NOBODY);
  });
  useWakeLock(true);
  const saverShown = idle && loaded && !needsOnboarding && !celebrateShown;
  const gateShown = loaded && !needsOnboarding && viewer.kind === "none";

  // Persist the whole household in one atomic blob. The space being viewed
  // is written from its live engine, the rest from `spaces`.
  const householdSaved = household.toSaved;
  const personalSaved = personal.toSaved;
  useEffect(() => {
    if (!loaded || needsOnboarding) return;
    const live = viewer.kind === "person" && spaces[viewer.id]
      ? { ...spaces, [viewer.id]: { ...spaces[viewer.id], ...personalSaved() } }
      : spaces;
    const data: PersistedV2 = {
      schemaVersion: 2,
      config,
      ...householdSaved(),
      spaces: live,
    };
    saveAll(data);
  }, [config, spaces, viewer, householdSaved, personalSaved, loaded, needsOnboarding]);

  // Apply a settings edit and rebuild the runtime chore list, carrying over
  // today's done-state for chores that survive the edit.
  function updateConfig(mutate: (cfg: HouseholdConfig) => HouseholdConfig) {
    const next = mutate(config);
    setConfig(next);
    household.rebuild(next);
  }

  function completeOnboarding(newPeople: Person[], mode: "template" | "empty") {
    const cfg = mode === "template" ? templateConfig(newPeople) : emptyConfig(newPeople);
    setConfig(cfg);
    household.load(cfg, null);
    setNeedsOnboarding(false);
  }

  // The gate's answer. A person with no space yet gets one from the template.
  function chooseViewer(v: Viewer) {
    if (v.kind === "person") {
      const who = config.people.find((p) => p.id === v.id);
      if (!who) return;
      const today = todayStr();
      let sp = spaces[v.id] ?? templateSpace(today, weekStartStr(), monthStr());
      // A space not opened across a day change still needs its finished
      // one-offs cleared; the engine only rolls over while loaded.
      const st = stripStaleOnce(sp.chores, sp.choreState, today);
      if (st.changed) sp = { ...sp, chores: st.chores, choreState: st.choreState };
      if (sp !== spaces[v.id]) setSpaces((s) => ({ ...s, [v.id]: sp }));
      personal.load(spaceConfig(config, who, sp), sp);
    }
    setPage(0);
    setViewer(v);
  }

  // The header logo: back to the question.
  function askAgain() {
    leaveSpace();
    setViewer(NOBODY);
  }

  // The header percentage; the board computes the same number for itself.
  const overall = overallPct(active.config.bins, active.engine.chores, people, active.config.scoring) ?? 0;
  const who = viewer.kind === "person" ? owner?.name ?? null : viewer.kind === "household" ? "Household" : null;

  // ── Overview totals
  const personSum = (log: PeriodLogV2, personId: string) =>
    Object.values(log.tallies[personId] ?? {}).reduce((a, b) => a + b, 0);
  const thisMonth = monthStr();
  const monthOptions = [thisMonth, ...active.engine.history.map((h) => h.period).filter((p) => p !== thisMonth)]
    .sort()
    .reverse();
  const shownMonth = monthOptions.includes(viewMonth) ? viewMonth : thisMonth;
  const monthIdx = monthOptions.indexOf(shownMonth);
  const isThisMonth = shownMonth === thisMonth;
  const shownLog = isThisMonth
    ? active.engine.monthly
    : active.engine.history.find((h) => h.period === shownMonth) ?? emptyPeriod(shownMonth);
  const monthLabel = monthLabelOf(shownMonth);
  const weekLabel = `WEEK OF ${new Date(weekStartStr() + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" }).toUpperCase()}`;

  // ── Swipe (native listeners so Safari doesn't suppress them)
  const pageCount = inSpace ? 2 : 3; // a personal view has no settings page
  const pageRef = useRef(page);
  useEffect(() => { pageRef.current = page; }, [page]);
  const pageCountRef = useRef(pageCount);
  useEffect(() => { pageCountRef.current = pageCount; }, [pageCount]);

  useEffect(() => {
    const el = pagesRef.current;
    if (!el) return;
    let startX = 0;
    const onStart = (e: TouchEvent) => { startX = e.touches[0].clientX; };
    const onEnd = (e: TouchEvent) => {
      const diff = startX - e.changedTouches[0].clientX;
      if (Math.abs(diff) < 30) return;
      if (diff > 0) setPage(Math.min(pageCountRef.current - 1, pageRef.current + 1));
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
        {Array.from({ length: pageCount }, (_, n) => (
          <span key={n} className={`dot ${page === n ? "active" : ""}`} onClick={() => setPage(n)} style={{ cursor: "pointer" }} />
        ))}
      </span>
      <span className="nav-slot next">
        {page < pageCount - 1 && (
          <button className="nav-btn" onClick={() => setPage(page + 1)}>{PAGE_NAMES[page + 1]} →</button>
        )}
      </span>
    </span>
  );

  return (
    <div className="clip-wrap scanlines">
    <DigitField />
    <TerminalFrame dateStr={dateStr} who={who} pct={overall} onLogoTap={askAgain} />
    <div ref={pagesRef} className="pages">
      {/* ── PAGE 1: BOARD ── */}
      <Board
        key={active.key}
        config={active.config}
        chores={active.engine.chores}
        setChores={active.engine.setChores}
        loaded={loaded}
        active={page === 0}
        dayKey={dayKey}
        nav={pageNav}
        tagline={inSpace ? SPACE_MOTTO : undefined}
        flightRoot={flightRoot}
        onLog={active.engine.bump}
        onToasts={pushToasts}
        onCelebrate={celebrate}
      />

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
                  <div className="sc-num" style={{ color: p.color }}>{personSum(active.engine.weekly, p.id)}</div>
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
              {active.config.chores.map((def) => {
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
      {/* ── PAGE 3: MANAGE (household only) ── */}
      {!inSpace && (
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
        <SettingsPage config={config} onUpdate={updateConfig} onPreviewScreensaver={sleep} />
        <div className="bottom-pad" />
      </div>
      )}
    </div>

    {needsOnboarding && <Onboarding onComplete={completeOnboarding} />}
    {gateShown && <WhoGate people={config.people} onChoose={chooseViewer} />}
    <CompleteOverlay
      show={celebrateShown}
      pct={celebratePct}
      title={config.messages.completeTitle}
      tagline={config.messages.completeTagline}
      onDismiss={() => setCelebrateShown(false)}
    />
    {/* A toast waits its turn rather than expiring unseen under the
        celebration, the screensaver, or onboarding. */}
    <ToastOverlay
      toast={celebrateShown || saverShown || needsOnboarding || gateShown ? null : toasts[0] ?? null}
      onDismiss={dismissToast}
    />
    <Screensaver show={saverShown} onDismiss={wake} />


    {/* ── FLIGHT LAYER slot: the board portals its flying letters + bins here ── */}
    <div ref={setFlightRoot} />
    </div>
  );
}
