// One-time migration from the v1 storage keys (hardcoded Elliot/Paisley app)
// to the v2 blob. The old keys are left untouched as a rollback backup.

import {
  ChoreDayState,
  PeriodLogV2,
  PersistedV2,
  Person,
  emptyPeriod,
  templateConfig,
} from "./model";
import { monthStr, todayStr, weekStartStr } from "./time";
import { archiveMonth } from "./logic";

const V1_STORAGE_KEY = "inniework";
const V1_WEEKLY_KEY = "inniework_weekly";
const V1_MONTHLY_KEY = "inniework_monthly";
const V1_HISTORY_KEY = "inniework_history";
// v1's all-or-nothing reset gate: chore state predating this tag was discarded
// on load, and the migration honors that exact behavior.
const V1_RESET_TAG = "2026-06-29-cycles";

interface V1PersistedChore {
  id: string;
  eDone: boolean;
  pDone: boolean;
  lastDoneDate: string | null;
  lastWho: string | null;
  partsDone?: boolean[];
}
interface V1PersistedData {
  savedDate: string;
  chores: V1PersistedChore[];
  resetTag?: string;
}
interface V1PeriodLog {
  period: string;
  elliot: Record<string, number>;
  paisley: Record<string, number>;
}

const SEED_PEOPLE: Person[] = [
  { id: "elliot", name: "Elliot", color: "#F0C94A" },
  { id: "paisley", name: "Paisley", color: "#F5A0B0" },
];

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function periodV2(v1: V1PeriodLog | null, fallbackPeriod: string): PeriodLogV2 {
  if (!v1) return emptyPeriod(fallbackPeriod);
  return {
    period: v1.period ?? fallbackPeriod,
    tallies: { elliot: { ...(v1.elliot ?? {}) }, paisley: { ...(v1.paisley ?? {}) } },
  };
}

// lastWho stored display names ("Elliot"); match them to seeded person ids.
function personIdFromName(name: string | null): string | null {
  if (!name) return null;
  const hit = SEED_PEOPLE.find((p) => p.name.toLowerCase() === name.toLowerCase());
  return hit ? hit.id : null;
}

export function migrateV1(): PersistedV2 | null {
  const v1 = read<V1PersistedData>(V1_STORAGE_KEY);
  const v1Weekly = read<V1PeriodLog>(V1_WEEKLY_KEY);
  const v1Monthly = read<V1PeriodLog>(V1_MONTHLY_KEY);
  const v1History = read<V1PeriodLog[]>(V1_HISTORY_KEY);
  if (!v1 && !v1Weekly && !v1Monthly && !v1History) return null; // true first run

  const config = templateConfig(SEED_PEOPLE);

  // Chore state: honor the v1 reset gate exactly as v1's load did.
  const stale = !v1 || v1.resetTag !== V1_RESET_TAG;
  const choreState: ChoreDayState[] = stale
    ? []
    : v1!.chores.map((c) => ({
        id: c.id,
        doneBy: { elliot: !!c.eDone, paisley: !!c.pDone },
        lastDoneDate: c.lastDoneDate ?? null,
        lastBy: personIdFromName(c.lastWho),
        partsDone: c.partsDone ?? [],
      }));

  // Tallies: current week/month plus every archived month, all re-keyed.
  let history: PeriodLogV2[] = (v1History ?? []).map((h) => periodV2(h, "1970-01"));
  let monthly = periodV2(v1Monthly, monthStr());
  if (monthly.period !== monthStr()) {
    // Month turned over while unopened: archive the finished one (v1 did the
    // same on load) and start the current month at zero.
    history = archiveMonth(monthly, history);
    monthly = emptyPeriod(monthStr());
  }
  let weekly = periodV2(v1Weekly, weekStartStr());
  if (weekly.period !== weekStartStr()) weekly = emptyPeriod(weekStartStr());

  return {
    schemaVersion: 2,
    config,
    savedDate: stale ? todayStr() : v1!.savedDate,
    choreState,
    weekly,
    monthly,
    history,
  };
}
