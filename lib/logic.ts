import {
  Bin,
  ChoreDayState,
  ChoreDefV2,
  ChoreKind,
  ChoreState,
  HouseholdConfig,
  MAX_HISTORY,
  PeriodLogV2,
  Person,
  ScoringConfig,
  Urgency,
  periodTotal,
} from "./model";
import { computeDaysAgo, dateDaysAgo, todayStr } from "./time";

// Who a chore applies to. Empty assignees = the whole household, so people
// added later are automatically included.
export function resolveAssignees(def: ChoreDefV2, people: Person[]): Person[] {
  if (def.assignees.length === 0) return people;
  const byId = new Map(people.map((p) => [p.id, p]));
  return def.assignees.map((id) => byId.get(id)).filter((p): p is Person => !!p);
}

export function dailyDone(c: ChoreState, people: Person[]): boolean {
  const assignees = resolveAssignees(c.def, people);
  return assignees.length > 0 && assignees.every((p) => c.doneBy[p.id]);
}

export function buildChores(
  config: HouseholdConfig,
  saved: { savedDate: string; choreState: ChoreDayState[] } | null
): ChoreState[] {
  const today = todayStr();
  const sameDay = saved?.savedDate === today;
  return [...config.chores]
    .sort((a, b) => a.order - b.order)
    .map((def) => {
      const sc = saved?.choreState.find((c) => c.id === def.id);
      if (def.kind === "daily") {
        return {
          def,
          expanded: false,
          doneBy: sameDay ? { ...(sc?.doneBy ?? {}) } : {},
          done: false, // derived per-render via dailyDone
          lastBy: null,
          lastDoneDate: null,
          daysAgo: 0,
          partsDone: [],
        };
      }
      if (def.kind === "once") {
        // One-and-done: pending until somebody logs it; no aging.
        const lastDoneDate = sc?.lastDoneDate ?? null;
        return {
          def,
          expanded: false,
          doneBy: {},
          done: lastDoneDate !== null,
          lastBy: sc?.lastBy ?? null,
          lastDoneDate,
          daysAgo: 0,
          partsDone: (def.parts ?? []).map((_, i) => sc?.partsDone?.[i] ?? false),
        };
      }
      // Cycle chores age by days-since-last-done. Unseen chores start at day 1.
      const lastDoneDate = sc?.lastDoneDate ?? dateDaysAgo(1);
      const daysAgo = computeDaysAgo(lastDoneDate);
      return {
        def,
        expanded: false,
        doneBy: {},
        done: daysAgo === 0,
        lastBy: sc?.lastBy ?? null,
        lastDoneDate,
        daysAgo,
        // Part ticks persist across days — walk one dog today, the other tomorrow.
        partsDone: (def.parts ?? []).map((_, i) => sc?.partsDone?.[i] ?? false),
      };
    });
}

export function allPartsDone(c: ChoreState): boolean {
  return c.partsDone.every(Boolean);
}

export function getUrgency(c: ChoreState): Urgency {
  if (c.def.kind === "daily") return "green";
  if (c.def.kind === "once") return "green"; // one-offs don't age
  if (c.done) return "green";
  if (c.daysAgo <= c.def.greenMax) return "green";
  if (c.daysAgo <= c.def.yellowMax) return "yellow";
  return "red";
}

export function sinceText(c: ChoreState, people: Person[]): string {
  if (c.def.kind === "daily") {
    const assignees = resolveAssignees(c.def, people);
    if (assignees.length > 0 && assignees.every((p) => c.doneBy[p.id])) return "all done ✓";
    if (assignees.some((p) => c.doneBy[p.id])) {
      return assignees
        .map((p) => `${p.name.toLowerCase()} ${c.doneBy[p.id] ? "✓" : "—"}`)
        .join(" · ");
    }
    return "daily · resets midnight";
  }
  if (c.done) {
    const by = people.find((p) => p.id === c.lastBy);
    return by ? `done · ${by.name}` : "done today";
  }
  if (c.def.kind === "once") return "one & done";
  return `${c.daysAgo} of ${c.def.cycleDays} days`;
}

export function sinceClass(c: ChoreState, people: Person[]): string {
  const urg = getUrgency(c);
  if (c.def.kind === "daily" && dailyDone(c, people)) return "green-text";
  if (urg === "yellow") return "yellow-text";
  if (urg === "red") return "red-text";
  return "";
}

// Move a finished month into the archive, newest first. Empty months aren't
// worth keeping, and a re-archived month replaces its earlier copy.
export function archiveMonth(done: PeriodLogV2, history: PeriodLogV2[]): PeriodLogV2[] {
  if (periodTotal(done) === 0) return history;
  return [done, ...history.filter((h) => h.period !== done.period)]
    .sort((a, b) => b.period.localeCompare(a.period))
    .slice(0, MAX_HISTORY);
}

// ── Bin progress
// Units: a daily chore contributes one unit per assignee (done when that
// person has logged it today). A cycle chore contributes one unit, done when
// in good standing (not yet aging) — so 100% means "nothing needs doing".
// Which kinds count at all is up to the household's scoring config.
export function countsKind(scoring: ScoringConfig, kind: ChoreKind): boolean {
  return scoring.countKind === "all" || scoring.countKind === kind;
}

// null = nothing counted here, which renders as "—" rather than a misleading
// "0%". Display never claims 100 unless every counted unit is actually done,
// so a 199/200 board reads 99% instead of rounding up to a false 100%.
export function pctOf(done: number, total: number): number | null {
  if (total <= 0) return null;
  if (done >= total) return 100;
  return Math.min(99, Math.round((done / total) * 100));
}

export function binProgress(
  bin: Bin,
  chores: ChoreState[],
  people: Person[],
  scoring: ScoringConfig
): { done: number; total: number } {
  let done = 0;
  let total = 0;
  for (const c of chores) {
    if (c.def.binId !== bin.id) continue;
    if (!countsKind(scoring, c.def.kind)) continue;
    if (c.def.kind === "daily") {
      const assignees = resolveAssignees(c.def, people);
      total += assignees.length;
      done += assignees.filter((p) => c.doneBy[p.id]).length;
    } else if (c.def.kind === "once") {
      // Pending work until it's actually logged.
      total += 1;
      if (c.done) done += 1;
    } else {
      total += 1;
      if (c.done || c.daysAgo <= c.def.greenMax) done += 1;
    }
  }
  return { done, total };
}

export function binPct(
  bin: Bin, chores: ChoreState[], people: Person[], scoring: ScoringConfig
): number | null {
  const { done, total } = binProgress(bin, chores, people, scoring);
  return pctOf(done, total);
}

export function overallProgress(
  bins: Bin[], chores: ChoreState[], people: Person[], scoring: ScoringConfig
): { done: number; total: number } {
  let done = 0;
  let total = 0;
  for (const b of bins) {
    const p = binProgress(b, chores, people, scoring);
    done += p.done;
    total += p.total;
  }
  return { done, total };
}

export function overallPct(
  bins: Bin[], chores: ChoreState[], people: Person[], scoring: ScoringConfig
): number | null {
  const { done, total } = overallProgress(bins, chores, people, scoring);
  return pctOf(done, total);
}

// Unrounded 0..100 — what the celebration edge compares against, so a 99.5%
// board never trips a 100% threshold.
export function overallExactPct(
  bins: Bin[], chores: ChoreState[], people: Person[], scoring: ScoringConfig
): number | null {
  const { done, total } = overallProgress(bins, chores, people, scoring);
  return total <= 0 ? null : (done / total) * 100;
}

// ── Per-chore completion messages
export interface ActiveMessage {
  choreId: string;
  choreName: string;
  text: string;              // {name} already substituted
  tintColor: string | null;  // target person's color; null = everyone (green)
  byName: string | null;     // who triggered it, for the sub-line
}

export function fillName(tpl: string, name: string): string {
  return tpl.replace(/\{name\}/gi, name);
}

// Does this chore's message apply right now, and who is it about? Purely a
// live predicate — nothing is persisted, so there's no replay to clean up.
export function choreMessageState(
  c: ChoreState,
  people: Person[]
): { fires: boolean; target: Person | null; by: Person | null } {
  const none = { fires: false, target: null, by: null };
  const def = c.def;
  if (!(def.message ?? "").trim()) return none;

  const targetId = def.messageFor ?? "";
  const target = targetId ? people.find((p) => p.id === targetId) ?? null : null;
  if (targetId && !target) return none; // target no longer exists

  if (def.kind === "daily") {
    if (!target) return { fires: dailyDone(c, people), target: null, by: null };
    const assigned = resolveAssignees(def, people).some((p) => p.id === target.id);
    return { fires: assigned && !!c.doneBy[target.id], target, by: target };
  }
  // cycle + once: `done` already means "logged today"; lastBy is the only
  // per-person record these kinds keep.
  if (!c.done) return none;
  const last = people.find((p) => p.id === c.lastBy) ?? null;
  if (!target) return { fires: true, target: null, by: last };
  return { fires: c.lastBy === target.id, target, by: target };
}

export function activeChoreMessages(chores: ChoreState[], people: Person[]): ActiveMessage[] {
  return [...chores]
    .sort((a, b) => a.def.order - b.def.order)
    .flatMap((c) => {
      const { fires, target, by } = choreMessageState(c, people);
      if (!fires) return [];
      return [{
        choreId: c.def.id,
        choreName: c.def.name,
        text: fillName((c.def.message ?? "").trim(), by?.name ?? "Everyone"),
        tintColor: target ? target.color : null,
        byName: by ? by.name : null,
      }];
    });
}
