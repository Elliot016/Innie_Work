"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
  inWindow,
  minuteOfDay,
  monthLabelOf,
  monthStr,
  todayStr,
  weekStartStr,
} from "@/lib/time";
import { archiveMonth, buildChores, overallPct } from "@/lib/logic";
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
  const [chores, setChores] = useState<ChoreState[]>([]);
  const [weekly, setWeekly] = useState<PeriodLogV2>(() => emptyPeriod(weekStartStr()));
  const [monthly, setMonthly] = useState<PeriodLogV2>(() => emptyPeriod(monthStr()));
  const [history, setHistory] = useState<PeriodLogV2[]>([]);
  const [viewMonth, setViewMonth] = useState<string>(() => monthStr());
  const [page, setPage] = useState(0);
  // Which bin the board shows; null = home (the first bin).
  const [openBinId, setOpenBinId] = useState<string | null>(null);
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
  // Wall-clock minute, for the quiet-hours window. Only read while idle.
  const [clockMin, setClockMin] = useState(() => minuteOfDay());
  const pagesRef = useRef<HTMLDivElement>(null);
  // Where the board mounts its fixed overlay (flying letters + bin dock).
  const [flightRoot, setFlightRoot] = useState<HTMLDivElement | null>(null);

  const people = config.people;

  const dateStr = new Date().toLocaleDateString("en-US", {
    weekday: "short", month: "short", day: "numeric",
  }).toUpperCase();

  // Load (v2 blob, else migrated v1, else seed the template) on mount.
  useEffect(() => {
    requestPersistence();
    const res = loadAll();
    if (res.status === "ok" || res.status === "migrated") {
      const data = res.data;
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
      // "corrupt" also lands here — the board can't render without data, so
      // onboarding still runs. The original was already set aside by loadAll,
      // and Settings › Data lists it as a restorable copy.
      if (res.status === "corrupt") setDataAlert("corrupt");
      setNeedsOnboarding(true);
    }
    // Only nag someone who actually has a board to lose.
    if (res.status === "ok" && backupIsStale()) setDataAlert("stale");
    setLoaded(true);
  }, []);

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

  // Tick once a minute: advance the clock minute, and when the calendar day
  // actually rolls over, update dayKey.
  useEffect(() => {
    const tick = () => {
      setClockMin(minuteOfDay());
      const d = todayStr();
      setDayKey((prev) => (prev === d ? prev : d));
    };
    const id = setInterval(tick, 60000);
    // iOS suspends timers in the background; catch up the moment we're back.
    const onVis = () => { if (document.visibilityState === "visible") tick(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { clearInterval(id); document.removeEventListener("visibilitychange", onVis); };
  }, []);

  // Idle screensaver + keep the wall panel awake. The saver never covers
  // onboarding or the celebration; those are dismissed first, and that tap
  // counts as activity.
  const { idle, wake, sleep } = useIdle(config.display.screensaverMin * 60_000);
  const saverShown = idle && loaded && !needsOnboarding && !celebrateShown;
  // Quiet hours: idle inside the window means a black screen and no wake
  // lock, so the iPad's own Auto-Lock can turn the display off. Any tap
  // brings the board (and the lock) back until the next idle.
  const { quietOn, quietFrom, quietTo } = config.display;
  const quiet = saverShown && quietOn && inWindow(quietFrom, quietTo, clockMin);
  useWakeLock(!quiet);

  // Latest monthly tally, readable from the rollover effect without re-running it.
  const monthlyRef = useRef(monthly);
  useEffect(() => { monthlyRef.current = monthly; }, [monthly]);

  // When the day changes while the app is open, roll everything over live.
  const rolloverDayRef = useRef(dayKey);
  useEffect(() => {
    if (!loaded) return;
    if (rolloverDayRef.current === dayKey) return;
    rolloverDayRef.current = dayKey;
    setCelebrateShown(false);
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

  // The header percentage; the board computes the same number for itself.
  const overall = overallPct(config.bins, chores, people) ?? 0;

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
    // A page turn needs a deliberate swipe: long enough (the larger of 120px
    // or a fifth of the screen), clearly sideways (at least twice as far
    // across as up or down, so scrolling never turns the page), quick (under
    // 600ms, so a slow drag doesn't count), and one finger only.
    const MIN_PX = 120;
    const MIN_FRACTION = 0.2;
    const MAX_MS = 600;
    let startX = 0;
    let startY = 0;
    let startT = 0;
    let tracking = false;
    const onStart = (e: TouchEvent) => {
      tracking = e.touches.length === 1;
      if (!tracking) return;
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      startT = performance.now();
    };
    const onEnd = (e: TouchEvent) => {
      if (!tracking) return;
      tracking = false;
      const t = e.changedTouches[0];
      const diff = startX - t.clientX;
      const dy = Math.abs(startY - t.clientY);
      const minDist = Math.max(MIN_PX, window.innerWidth * MIN_FRACTION);
      if (Math.abs(diff) < minDist) return;
      if (Math.abs(diff) < dy * 2) return;
      if (performance.now() - startT > MAX_MS) return;
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
      <Board
        config={config}
        chores={chores}
        setChores={setChores}
        loaded={loaded}
        active={page === 0}
        dayKey={dayKey}
        nav={pageNav}
        flightRoot={flightRoot}
        openBinId={openBinId}
        onOpenBin={(id) => setOpenBinId(id)}
        onLog={bump}
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
        <SettingsPage config={config} onUpdate={updateConfig} onPreviewScreensaver={sleep} />
        <div className="bottom-pad" />
      </div>
    </div>

    {needsOnboarding && <Onboarding onComplete={completeOnboarding} />}
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
      toast={celebrateShown || saverShown || needsOnboarding ? null : toasts[0] ?? null}
      onDismiss={dismissToast}
    />
    <Screensaver show={saverShown} quiet={quiet} chores={chores} people={people} onDismiss={() => { wake(); setOpenBinId(null); }} />


    {/* ── FLIGHT LAYER slot: the board portals its flying letters + bins here ── */}
    <div ref={setFlightRoot} />
    </div>
  );
}
