import {
  Bin,
  ChoreDayState,
  ChoreDefV2,
  ChoreState,
  HouseholdConfig,
  MAX_HISTORY,
  PeriodLogV2,
  Person,
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
export function binProgress(
  bin: Bin,
  chores: ChoreState[],
  people: Person[]
): { done: number; total: number } {
  let done = 0;
  let total = 0;
  for (const c of chores) {
    if (c.def.binId !== bin.id) continue;
    if (c.def.kind === "daily") {
      const assignees = resolveAssignees(c.def, people);
      total += assignees.length;
      done += assignees.filter((p) => c.doneBy[p.id]).length;
    } else {
      total += 1;
      if (c.done || c.daysAgo <= c.def.greenMax) done += 1;
    }
  }
  return { done, total };
}

export function binPct(bin: Bin, chores: ChoreState[], people: Person[]): number {
  const { done, total } = binProgress(bin, chores, people);
  return total === 0 ? 0 : Math.round((done / total) * 100);
}

export function overallPct(bins: Bin[], chores: ChoreState[], people: Person[]): number {
  let done = 0;
  let total = 0;
  for (const b of bins) {
    const p = binProgress(b, chores, people);
    done += p.done;
    total += p.total;
  }
  return total === 0 ? 0 : Math.round((done / total) * 100);
}
