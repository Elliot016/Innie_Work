"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ChoreDayState,
  ChoreState,
  HouseholdConfig,
  PeriodLogV2,
  emptyPeriod,
} from "@/lib/model";
import { archiveMonth, buildChores } from "@/lib/logic";
import { computeDaysAgo, monthStr, todayStr, weekStartStr } from "@/lib/time";

// What an engine reads on load and hands back to save: the per-chore state
// and the tallies. The household blob and a personal space both have this
// shape, which is what lets one hook run either.
export interface EngineSaved {
  savedDate: string;
  choreState: ChoreDayState[];
  weekly: PeriodLogV2;
  monthly: PeriodLogV2;
  history: PeriodLogV2[];
}

// One running chore list — the household's, or one person's space. Owns the
// runtime chore state and the tallies, rolls them over live when the day
// changes, and hands back the persisted shape. It knows nothing about
// storage or which list it is: the page loads it and asks it what to save.
//
//   onRemoveChores — a finished one-and-done left the board at rollover; the
//                    owner drops it from the chore definitions too.
//   onRollover     — the day changed while loaded (re-arm the celebration).
export function useChoreEngine({
  dayKey,
  onRemoveChores,
  onRollover,
}: {
  dayKey: string;
  onRemoveChores: (ids: Set<string>) => void;
  onRollover?: () => void;
}) {
  const [chores, setChores] = useState<ChoreState[]>([]);
  const [weekly, setWeekly] = useState<PeriodLogV2>(() => emptyPeriod(weekStartStr()));
  const [monthly, setMonthly] = useState<PeriodLogV2>(() => emptyPeriod(monthStr()));
  const [history, setHistory] = useState<PeriodLogV2[]>([]);

  // Callbacks are read through refs so the rollover effect always reaches
  // the owner's latest handler without re-running on every render.
  const removeRef = useRef(onRemoveChores);
  useEffect(() => { removeRef.current = onRemoveChores; }, [onRemoveChores]);
  const rolloverRef = useRef(onRollover);
  useEffect(() => { rolloverRef.current = onRollover; }, [onRollover]);

  // Nothing rolls over until something has been loaded.
  const ready = useRef(false);
  const rolloverDayRef = useRef(dayKey);

  // Latest monthly tally, readable from the rollover effect without re-running it.
  const monthlyRef = useRef(monthly);
  useEffect(() => { monthlyRef.current = monthly; }, [monthly]);

  // Load a chore list: definitions from `config`, state and tallies from
  // `saved` (null = brand new). Periods that have lapsed while the app was
  // closed are filed away rather than dropped.
  const load = useCallback((config: HouseholdConfig, saved: EngineSaved | null) => {
    setChores(buildChores(config, saved));
    if (saved) {
      setWeekly(saved.weekly.period === weekStartStr() ? saved.weekly : emptyPeriod(weekStartStr()));
      if (saved.monthly.period === monthStr()) {
        setMonthly(saved.monthly);
        setHistory(saved.history);
      } else {
        // Months turned over while unopened: file the finished one away
        // instead of dropping it, and start this month at zero.
        setHistory(archiveMonth(saved.monthly, saved.history));
        setMonthly(emptyPeriod(monthStr()));
      }
    } else {
      setWeekly(emptyPeriod(weekStartStr()));
      setMonthly(emptyPeriod(monthStr()));
      setHistory([]);
    }
    ready.current = true;
    rolloverDayRef.current = todayStr();
  }, []);

  // When the day changes while loaded, roll everything over live.
  useEffect(() => {
    if (!ready.current) return;
    if (rolloverDayRef.current === dayKey) return;
    rolloverDayRef.current = dayKey;
    rolloverRef.current?.();
    // Completed one-and-done chores leave the board with the old day.
    const doneOnce = new Set(
      chores.filter((c) => c.def.kind === "once" && c.done).map((c) => c.def.id)
    );
    if (doneOnce.size > 0) removeRef.current(doneOnce);
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
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dayKey]);

  // Apply a definitions edit and rebuild the runtime chore list, carrying
  // over today's done-state for chores that survive the edit.
  const rebuild = useCallback((next: HouseholdConfig) => {
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
  }, []);

  // Adjust this week's AND this month's tally for a person/chore (clamped at 0).
  const bump = useCallback((choreId: string, personId: string, delta: number) => {
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
  }, []);

  // The persisted shape. Identity changes only when the data does, so a save
  // effect can depend on it without saving every render.
  const toSaved = useCallback((): EngineSaved => ({
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
  }), [chores, weekly, monthly, history]);

  return { chores, setChores, weekly, monthly, history, load, rebuild, bump, toSaved };
}
