// ── Data model v2: everything a household can configure, plus persisted state.

export interface Person {
  id: string;
  name: string;
  color: string; // one hex; dim/tint variants come from color-mix in CSS
}

export interface Bin {
  id: string;
  num: string;   // "01"
  label: string; // "DAILY"
  order: number;
}

// daily: each assignee logs it every day. cycle: any assignee, repeats on a
// cadence. once: any assignee, one-and-done — auto-removed the next day.
export type ChoreKind = "daily" | "cycle" | "once";
export type Urgency = "green" | "yellow" | "red";

export interface ChoreDefV2 {
  id: string;
  name: string;
  icon: string | null; // path into public/chores (BUILT_IN_ICONS)
  binId: string;
  kind: ChoreKind;
  cycleDays: number;   // 1 for daily
  greenMax: number;    // in good standing through this many days
  yellowMax: number;   // aging through this many days; beyond = red
  parts?: string[];    // sub-tasks that must all be ticked (e.g. each dog)
  order: number;
  // Who this chore belongs to. Empty = everyone in the household, including
  // people added later. Daily kind: each assignee logs it. Cycle kind: any
  // one assignee completes it.
  assignees: string[];
  // One short line shown in the board's banner stack when this chore is
  // completed. Blank/undefined = no message.
  message?: string;
  // Who the message is about: a personId, or undefined/"" for everyone.
  messageFor?: string;
}

export const MAX_MESSAGE_LEN = 80;

// Copy shown on the celebration overlay and the per-person praise banner.
export interface CelebrationMessages {
  completeTitle: string;
  completeTagline: string;
  praiseTitle: string;  // "{name}" becomes the person's name
  praiseSub: string;    // "{name}" allowed here too
}

export const DEFAULT_MESSAGES: CelebrationMessages = {
  completeTitle: "Purification Complete",
  completeTagline: "Your Outties are Happy",
  praiseTitle: "Good Job, Innie {name}!",
  praiseSub: "You have completed your tasks.",
};

// Which chore kind counts toward every percentage, plus the celebration edge.
export interface ScoringConfig {
  countKind: ChoreKind;
  kierThreshold: number; // whole percent, 1..100
}

export const DEFAULT_SCORING: ScoringConfig = {
  countKind: "daily",
  kierThreshold: 100,
};

// Idle screensaver. 0 = never.
export interface DisplayConfig {
  screensaverMin: number; // whole minutes, 0..120
}

export const DEFAULT_DISPLAY: DisplayConfig = {
  screensaverMin: 3,
};

export interface HouseholdConfig {
  people: Person[];
  bins: Bin[];
  chores: ChoreDefV2[];
  messages: CelebrationMessages;
  scoring: ScoringConfig;
  display: DisplayConfig;
}

// Per-chore rolling state (persisted).
export interface ChoreDayState {
  id: string;
  doneBy: Record<string, boolean>; // personId -> done today (daily kind)
  lastDoneDate: string | null;     // cycle kind
  lastBy: string | null;           // personId
  partsDone: boolean[];
}

// Accumulated tallies for a week or month: personId -> choreId -> count.
export interface PeriodLogV2 {
  period: string; // weekStart "YYYY-MM-DD" or month "YYYY-MM"
  tallies: Record<string, Record<string, number>>;
}

export interface PersistedV2 {
  schemaVersion: 2;
  config: HouseholdConfig;
  savedDate: string; // daily checkboxes only count if saved today
  choreState: ChoreDayState[];
  weekly: PeriodLogV2;
  monthly: PeriodLogV2;
  history: PeriodLogV2[];
}

// Runtime chore state (def + day state + derived fields).
export interface ChoreState {
  def: ChoreDefV2;
  doneBy: Record<string, boolean>;
  done: boolean;
  lastBy: string | null;
  lastDoneDate: string | null;
  daysAgo: number;
  expanded: boolean;
  partsDone: boolean[];
}

// ── Constants
export const STORAGE_KEY_V2 = "inniework:v2";
export const MAX_HISTORY = 36;

export const DEFAULT_PALETTE = [
  "#F0C94A", // gold
  "#F5A0B0", // rose
  "#7EC8F5", // sky
  "#7FE0A8", // mint
  "#C6A8F5", // lavender
  "#F5A87E", // coral
  "#6FDBD4", // teal
  "#D8E87A", // lime
];

export const BUILT_IN_ICONS = [
  "/chores/dishes.png",
  "/chores/laundry.png",
  "/chores/putaway.svg",
  "/chores/poop.png",
  "/chores/plants.png",
  "/chores/countertops.svg",
  "/chores/vacuum.png",
  "/chores/sheets.png",
  "/chores/toilets.png",
  "/chores/Doggy.png",
  "/chores/mopping.svg",
  "/chores/walking.png",
];

export const TEMPLATE_BINS: Bin[] = [
  { id: "b1", num: "01", label: "DAILY", order: 0 },
  { id: "b2", num: "02", label: "PETS", order: 1 },
  { id: "b3", num: "03", label: "PLANTS", order: 2 },
  { id: "b4", num: "04", label: "CLEAN", order: 3 },
  { id: "b5", num: "05", label: "RESET", order: 4 },
];

export const TEMPLATE_CHORES: ChoreDefV2[] = [
  { id: "dishes",      name: "Dishes",               icon: "/chores/dishes.png",      binId: "b1", kind: "daily", cycleDays: 1,  greenMax: 1,  yellowMax: 1,  order: 0,  assignees: [] },
  { id: "laundry",     name: "Laundry",              icon: "/chores/laundry.png",     binId: "b1", kind: "daily", cycleDays: 1,  greenMax: 1,  yellowMax: 1,  order: 1,  assignees: [] },
  { id: "putaway",     name: "Put Stuff Away",       icon: "/chores/putaway.svg",     binId: "b1", kind: "daily", cycleDays: 1,  greenMax: 1,  yellowMax: 1,  order: 2,  assignees: [] },
  { id: "poop",        name: "Pick Up Poop",         icon: "/chores/poop.png",        binId: "b2", kind: "cycle", cycleDays: 4,  greenMax: 2,  yellowMax: 3,  order: 3,  assignees: [] },
  { id: "dogwalk",     name: "Walk the Dogs",        icon: "/chores/walking.png",     binId: "b2", kind: "cycle", cycleDays: 30, greenMax: 24, yellowMax: 28, order: 4,  assignees: [], parts: ["Koa", "Panko"] },
  { id: "dogtrain",    name: "Dog Training",         icon: "/chores/Doggy.png",       binId: "b2", kind: "cycle", cycleDays: 14, greenMax: 9,  yellowMax: 11, order: 5,  assignees: [] },
  { id: "plants",      name: "Water Outdoor Plants", icon: "/chores/plants.png",      binId: "b3", kind: "cycle", cycleDays: 3,  greenMax: 1,  yellowMax: 2,  order: 6,  assignees: [] },
  { id: "plants_in",   name: "Water Indoor Plants",  icon: "/chores/plants.png",      binId: "b3", kind: "cycle", cycleDays: 14, greenMax: 9,  yellowMax: 11, order: 7,  assignees: [] },
  { id: "countertops", name: "Countertops",          icon: "/chores/countertops.svg", binId: "b4", kind: "cycle", cycleDays: 7,  greenMax: 5,  yellowMax: 6,  order: 8,  assignees: [] },
  { id: "vacuum",      name: "Vacuuming",            icon: "/chores/vacuum.png",      binId: "b4", kind: "cycle", cycleDays: 7,  greenMax: 5,  yellowMax: 6,  order: 9,  assignees: [] },
  { id: "toilets",     name: "Toilets",              icon: "/chores/toilets.png",     binId: "b4", kind: "cycle", cycleDays: 14, greenMax: 9,  yellowMax: 11, order: 10, assignees: [] },
  { id: "mopping",     name: "Mopping",              icon: "/chores/mopping.svg",     binId: "b5", kind: "cycle", cycleDays: 30, greenMax: 21, yellowMax: 25, order: 11, assignees: [] },
  { id: "sheets",      name: "Bed Sheets",           icon: "/chores/sheets.png",      binId: "b5", kind: "cycle", cycleDays: 7,  greenMax: 5,  yellowMax: 6,  order: 12, assignees: [] },
];

export function templateConfig(people: Person[]): HouseholdConfig {
  return {
    people,
    bins: [...TEMPLATE_BINS],
    chores: TEMPLATE_CHORES.map((c) => ({ ...c })),
    messages: { ...DEFAULT_MESSAGES },
    scoring: { ...DEFAULT_SCORING },
    display: { ...DEFAULT_DISPLAY },
  };
}

export function emptyConfig(people: Person[]): HouseholdConfig {
  return {
    people,
    bins: [...TEMPLATE_BINS],
    chores: [],
    messages: { ...DEFAULT_MESSAGES },
    scoring: { ...DEFAULT_SCORING },
    display: { ...DEFAULT_DISPLAY },
  };
}

export function emptyPeriod(period: string): PeriodLogV2 {
  return { period, tallies: {} };
}

export function periodTotal(p: PeriodLogV2): number {
  return Object.values(p.tallies).reduce(
    (sum, rec) => sum + Object.values(rec).reduce((a, b) => a + b, 0),
    0
  );
}
