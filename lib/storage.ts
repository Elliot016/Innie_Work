import {
  Bin,
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
  PERSONAL_BINS,
  ScoringConfig,
  PeriodLogV2,
  PersistedV2,
  Person,
  SpaceData,
  STORAGE_KEY_V2,
  emptyPeriod,
} from "./model";
import { monthStr, todayStr, weekStartStr } from "./time";
import { migrateV1 } from "./migrate";
import { currentRaw, quarantine, snapshotBeforeWrite } from "./backup";

type Raw = Record<string, unknown>;
const isObj = (v: unknown): v is Raw => !!v && typeof v === "object";
const str = (v: unknown, fb: string) => (typeof v === "string" ? v : fb);
const num = (v: unknown, fb: number) => (typeof v === "number" && isFinite(v) ? v : fb);

function parseBins(raw: unknown): Bin[] {
  if (!Array.isArray(raw)) return [];
  return (raw as unknown[])
    .filter(isObj)
    .map((b, i) => ({
      id: str(b.id, `bin${i}`),
      num: str(b.num, String(i + 1).padStart(2, "0")),
      label: str(b.label, `BIN ${i + 1}`),
      order: num(b.order, i),
      message: typeof b.message === "string" && b.message.trim() !== ""
        ? b.message.trim().slice(0, MAX_MESSAGE_LEN)
        : undefined,
    }));
}

// `people` is who a chore may be assigned to or praise; anyone else is
// dropped. For a personal space that's just the owner.
function parseChores(raw: unknown, people: Person[], bins: Bin[]): ChoreDefV2[] {
  if (!Array.isArray(raw)) return [];
  return (raw as unknown[])
    .filter(isObj)
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
    });
}

function parsePeriod(v: unknown, fb: string): PeriodLogV2 {
  if (!isObj(v)) return emptyPeriod(fb);
  const tallies: PeriodLogV2["tallies"] = {};
  if (isObj(v.tallies)) {
    for (const [pid, rec] of Object.entries(v.tallies)) {
      if (!isObj(rec)) continue;
      tallies[pid] = {};
      for (const [cid, n] of Object.entries(rec)) {
        if (typeof n === "number" && isFinite(n) && n > 0) tallies[pid][cid] = n;
      }
    }
  }
  return { period: str(v.period, fb), tallies };
}

function parseHistory(raw: unknown): PeriodLogV2[] {
  if (!Array.isArray(raw)) return [];
  return (raw as unknown[])
    .map((h) => parsePeriod(h, "1970-01"))
    .filter((h) => h.period !== "1970-01" || periodHasData(h));
}

function parseChoreState(raw: unknown): ChoreDayState[] {
  if (!Array.isArray(raw)) return [];
  return (raw as unknown[])
    .filter(isObj)
    .map((c) => ({
      id: str(c.id, ""),
      doneBy: isObj(c.doneBy)
        ? Object.fromEntries(Object.entries(c.doneBy).map(([k, v]) => [k, !!v]))
        : {},
      lastDoneDate: typeof c.lastDoneDate === "string" ? c.lastDoneDate : null,
      lastBy: typeof c.lastBy === "string" ? c.lastBy : null,
      partsDone: Array.isArray(c.partsDone) ? (c.partsDone as unknown[]).map(Boolean) : [],
    }));
}

// A space whose owner is no longer in the household is kept as it is: this
// function repairs, it never discards someone's work. Deleting a person is
// the explicit action that takes their space with them.
function parseSpaces(raw: unknown, people: Person[]): Record<string, SpaceData> {
  const spaces: Record<string, SpaceData> = {};
  if (!isObj(raw)) return spaces;
  for (const [ownerId, v] of Object.entries(raw)) {
    if (!isObj(v)) continue;
    const owner = people.find((p) => p.id === ownerId);
    // No bins means nowhere to put a chore, so the board couldn't render —
    // fall back to the personal template rather than dropping the space.
    const parsed = parseBins(v.bins);
    const bins = parsed.length > 0 ? parsed : PERSONAL_BINS.map((b) => ({ ...b }));
    spaces[ownerId] = {
      bins,
      chores: parseChores(v.chores, owner ? [owner] : [], bins),
      savedDate: str(v.savedDate, todayStr()),
      choreState: parseChoreState(v.choreState),
      weekly: parsePeriod(v.weekly, weekStartStr()),
      monthly: parsePeriod(v.monthly, monthStr()),
      history: parseHistory(v.history),
    };
  }
  return spaces;
}

// Fill in anything missing or malformed so a corrupt blob can never crash
// render. Unknown fields are dropped; wrong-typed fields get defaults.
export function sanitize(raw: unknown): PersistedV2 | null {
  if (!isObj(raw)) return null;
  const d = raw;
  const cfg = (isObj(d.config) ? d.config : {}) as Raw;

  const people: Person[] = Array.isArray(cfg.people)
    ? (cfg.people as unknown[])
        .filter(isObj)
        .map((p, i) => ({
          id: str(p.id, `person${i}`),
          name: str(p.name, `Person ${i + 1}`),
          color: str(p.color, "#F0C94A"),
        }))
    : [];

  const bins = parseBins(cfg.bins);
  const chores = parseChores(cfg.chores, people, bins);

  if (people.length === 0 || bins.length === 0) return null;
  const m = (isObj(cfg.messages) ? cfg.messages : {}) as Raw;
  // A blank title would render an empty banner line; treat it as "unset".
  // Sub-lines may stay blank — they're rendered conditionally.
  const strNE = (v: unknown, fb: string) => (typeof v === "string" && v.trim() !== "" ? v : fb);
  const messages: CelebrationMessages = {
    completeTitle: strNE(m.completeTitle, DEFAULT_MESSAGES.completeTitle),
    completeTagline: str(m.completeTagline, DEFAULT_MESSAGES.completeTagline),
    praiseTitle: strNE(m.praiseTitle, DEFAULT_MESSAGES.praiseTitle),
    praiseSub: str(m.praiseSub, DEFAULT_MESSAGES.praiseSub),
  };
  const sc = (isObj(cfg.scoring) ? cfg.scoring : {}) as Raw;
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
  const dp = (isObj(cfg.display) ? cfg.display : {}) as Raw;
  const display: DisplayConfig = {
    screensaverMin: Math.min(120, Math.max(0,
      Math.round(num(dp.screensaverMin, DEFAULT_DISPLAY.screensaverMin)))),
  };
  const config: HouseholdConfig = { people, bins, chores, messages, scoring, display };

  return {
    schemaVersion: 2,
    config,
    savedDate: str(d.savedDate, todayStr()),
    choreState: parseChoreState(d.choreState),
    weekly: parsePeriod(d.weekly, weekStartStr()),
    monthly: parsePeriod(d.monthly, monthStr()),
    history: parseHistory(d.history),
    spaces: parseSpaces(d.spaces, people),
  };
}

function periodHasData(p: PeriodLogV2): boolean {
  return Object.keys(p.tallies).length > 0;
}

// Distinguishing "nothing here yet" from "something is here but I can't read
// it" is the whole point: the two look identical to the caller otherwise, and
// treating the second as the first is what silently destroys a board.
export type LoadResult =
  | { status: "ok"; data: PersistedV2 }
  | { status: "migrated"; data: PersistedV2 }
  | { status: "empty" }
  | { status: "corrupt"; quarantineKey: string | null };

// v2 blob → sanitize; else migrate v1 keys; else empty (true first run).
export function loadAll(): LoadResult {
  const raw = currentRaw();
  if (raw) {
    let clean: PersistedV2 | null = null;
    try {
      clean = sanitize(JSON.parse(raw));
    } catch {
      clean = null;
    }
    if (clean) return { status: "ok", data: clean };
    // There was a board here and we couldn't read it. Put the original
    // somewhere safe before anything else gets a chance to write over it,
    // and do NOT fall through to the v1 migration — that path calls saveAll.
    return { status: "corrupt", quarantineKey: quarantine(raw) };
  }
  const migrated = migrateV1();
  if (migrated) {
    saveAll(migrated);
    return { status: "migrated", data: migrated };
  }
  return { status: "empty" };
}

export function saveAll(data: PersistedV2): void {
  try {
    // Keep one copy of the day's starting state before today's writes bury it.
    snapshotBeforeWrite();
    localStorage.setItem(STORAGE_KEY_V2, JSON.stringify(data));
  } catch {}
}
