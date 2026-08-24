import {
  CelebrationMessages,
  ChoreDayState,
  ChoreDefV2,
  ChoreKind,
  DEFAULT_DISPLAY,
  DEFAULT_MESSAGES,
  DEFAULT_SCORING,
  DisplayConfig,
  HouseholdConfig,
  MAX_MESSAGE_LEN,
  ScoringConfig,
  PeriodLogV2,
  PersistedV2,
  Person,
  LEGACY_KEY_V2,
  STORAGE_KEY_V2,
  emptyPeriod,
} from "./model";
import { monthStr, todayStr, weekStartStr } from "./time";
import { migrateV1 } from "./migrate";

// Fill in anything missing or malformed so a corrupt blob can never crash
// render. Unknown fields are dropped; wrong-typed fields get defaults.
export function sanitize(raw: unknown): PersistedV2 | null {
  if (!raw || typeof raw !== "object") return null;
  const d = raw as Record<string, unknown>;
  const cfg = (d.config ?? {}) as Record<string, unknown>;

  const str = (v: unknown, fb: string) => (typeof v === "string" ? v : fb);
  const num = (v: unknown, fb: number) => (typeof v === "number" && isFinite(v) ? v : fb);

  const people: Person[] = Array.isArray(cfg.people)
    ? (cfg.people as unknown[])
        .filter((p): p is Record<string, unknown> => !!p && typeof p === "object")
        .map((p, i) => ({
          id: str(p.id, `person${i}`),
          name: str(p.name, `Person ${i + 1}`),
          color: str(p.color, "#F0C94A"),
        }))
    : [];

  const bins = Array.isArray(cfg.bins)
    ? (cfg.bins as unknown[])
        .filter((b): b is Record<string, unknown> => !!b && typeof b === "object")
        .map((b, i) => ({
          id: str(b.id, `bin${i}`),
          num: str(b.num, String(i + 1).padStart(2, "0")),
          label: str(b.label, `BIN ${i + 1}`),
          order: num(b.order, i),
          message: typeof b.message === "string" && b.message.trim() !== ""
            ? b.message.trim().slice(0, MAX_MESSAGE_LEN)
            : undefined,
        }))
    : [];

  const chores: ChoreDefV2[] = Array.isArray(cfg.chores)
    ? (cfg.chores as unknown[])
        .filter((c): c is Record<string, unknown> => !!c && typeof c === "object")
        .map((c, i) => {
          const cycleDays = Math.max(1, num(c.cycleDays, 1));
          // A message aimed at a deleted person takes the message with it —
          // re-pointing it at "everyone" would show the wrong praise to all.
          const wantsFor = typeof c.messageFor === "string" && c.messageFor !== "";
          const msgFor = wantsFor && people.some((p) => p.id === c.messageFor)
            ? (c.messageFor as string)
            : undefined;
          const dangling = wantsFor && !msgFor;
          const msg = typeof c.message === "string"
            ? c.message.trim().slice(0, MAX_MESSAGE_LEN)
            : "";
          return {
            id: str(c.id, `chore${i}`),
            name: str(c.name, `Chore ${i + 1}`),
            icon: typeof c.icon === "string" ? c.icon : null,
            binId: str(c.binId, bins[0]?.id ?? "bin0"),
            kind: c.kind === "daily" ? ("daily" as const) : c.kind === "once" ? ("once" as const) : ("cycle" as const),
            cycleDays,
            greenMax: Math.min(num(c.greenMax, cycleDays), cycleDays),
            yellowMax: Math.min(Math.max(num(c.yellowMax, cycleDays), num(c.greenMax, cycleDays)), cycleDays),
            parts: Array.isArray(c.parts) ? (c.parts as unknown[]).filter((p): p is string => typeof p === "string") : undefined,
            order: num(c.order, i),
            assignees: Array.isArray(c.assignees)
              ? (c.assignees as unknown[]).filter((a): a is string => typeof a === "string" && people.some((p) => p.id === a))
              : [],
            message: msg && !dangling ? msg : undefined,
            messageFor: msgFor,
          };
        })
    : [];

  if (people.length === 0 || bins.length === 0) return null;
  const m = (cfg.messages ?? {}) as Record<string, unknown>;
  // A blank title would render an empty banner line; treat it as "unset".
  // Sub-lines may stay blank — they're rendered conditionally.
  const strNE = (v: unknown, fb: string) => (typeof v === "string" && v.trim() !== "" ? v : fb);
  const messages: CelebrationMessages = {
    completeTitle: strNE(m.completeTitle, DEFAULT_MESSAGES.completeTitle),
    completeTagline: str(m.completeTagline, DEFAULT_MESSAGES.completeTagline),
    praiseTitle: strNE(m.praiseTitle, DEFAULT_MESSAGES.praiseTitle),
    praiseSub: str(m.praiseSub, DEFAULT_MESSAGES.praiseSub),
  };
  const sc = (cfg.scoring ?? {}) as Record<string, unknown>;
  // Earlier builds stored a boolean per kind; collapse those to the first
  // kind that was counting so the setting survives the shape change.
  const legacyKind: ChoreKind | null =
    sc.daily === true ? "daily" : sc.cycle === true ? "cycle" : sc.once === true ? "once" : null;
  const rawKind = sc.countKind;
  // "all" is no longer a valid choice; boards holding it fall back to the default.
  const countKind: ChoreKind =
    rawKind === "daily" || rawKind === "cycle" || rawKind === "once"
      ? rawKind
      : legacyKind ?? DEFAULT_SCORING.countKind;
  const scoring: ScoringConfig = {
    countKind,
    celebrateAt: Math.min(100, Math.max(1,
      Math.round(num(sc.celebrateAt, DEFAULT_SCORING.celebrateAt)))),
  };
  const dp = (cfg.display ?? {}) as Record<string, unknown>;
  const display: DisplayConfig = {
    screensaverMin: Math.min(120, Math.max(0,
      Math.round(num(dp.screensaverMin, DEFAULT_DISPLAY.screensaverMin)))),
  };
  const config: HouseholdConfig = { people, bins, chores, messages, scoring, display };

  const period = (v: unknown, fb: string): PeriodLogV2 => {
    if (!v || typeof v !== "object") return emptyPeriod(fb);
    const p = v as Record<string, unknown>;
    const tallies: PeriodLogV2["tallies"] = {};
    if (p.tallies && typeof p.tallies === "object") {
      for (const [pid, rec] of Object.entries(p.tallies as Record<string, unknown>)) {
        if (!rec || typeof rec !== "object") continue;
        tallies[pid] = {};
        for (const [cid, n] of Object.entries(rec as Record<string, unknown>)) {
          if (typeof n === "number" && isFinite(n) && n > 0) tallies[pid][cid] = n;
        }
      }
    }
    return { period: str(p.period, fb), tallies };
  };

  const choreState: ChoreDayState[] = Array.isArray(d.choreState)
    ? (d.choreState as unknown[])
        .filter((c): c is Record<string, unknown> => !!c && typeof c === "object")
        .map((c) => ({
          id: str(c.id, ""),
          doneBy:
            c.doneBy && typeof c.doneBy === "object"
              ? Object.fromEntries(
                  Object.entries(c.doneBy as Record<string, unknown>).map(([k, v]) => [k, !!v])
                )
              : {},
          lastDoneDate: typeof c.lastDoneDate === "string" ? c.lastDoneDate : null,
          lastBy: typeof c.lastBy === "string" ? c.lastBy : null,
          partsDone: Array.isArray(c.partsDone) ? (c.partsDone as unknown[]).map(Boolean) : [],
        }))
    : [];

  return {
    schemaVersion: 2,
    config,
    savedDate: str(d.savedDate, todayStr()),
    choreState,
    weekly: period(d.weekly, weekStartStr()),
    monthly: period(d.monthly, monthStr()),
    history: Array.isArray(d.history)
      ? (d.history as unknown[]).map((h) => period(h, "1970-01")).filter((h) => h.period !== "1970-01" || periodHasData(h))
      : [],
  };
}

function periodHasData(p: PeriodLogV2): boolean {
  return Object.keys(p.tallies).length > 0;
}

// v2 blob → sanitize; else migrate v1 keys; else null (true first run).
export function loadAll(): PersistedV2 | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_V2) ?? localStorage.getItem(LEGACY_KEY_V2);
    if (raw) {
      const clean = sanitize(JSON.parse(raw));
      if (clean) return clean;
    }
  } catch {}
  const migrated = migrateV1();
  if (migrated) {
    saveAll(migrated);
    return migrated;
  }
  return null;
}

export function saveAll(data: PersistedV2): void {
  try {
    localStorage.setItem(STORAGE_KEY_V2, JSON.stringify(data));
  } catch {}
}
