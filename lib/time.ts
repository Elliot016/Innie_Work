// ── Local-date helpers (all use the device's local calendar day).

export function fmtDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function todayStr(): string {
  return fmtDate(new Date());
}

export function monthStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// Monday of the current week, as "YYYY-MM-DD".
export function weekStartStr(): string {
  const n = new Date();
  const dow = n.getDay(); // 0 Sun … 6 Sat
  const back = dow === 0 ? -6 : 1 - dow;
  return fmtDate(new Date(n.getFullYear(), n.getMonth(), n.getDate() + back));
}

export function computeDaysAgo(lastDoneDate: string | null): number {
  if (!lastDoneDate) return 999;
  const [y, m, day] = lastDoneDate.split("-").map(Number);
  const then = new Date(y, m - 1, day).getTime();
  const now = new Date();
  const nowDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return Math.floor((nowDay - then) / (1000 * 60 * 60 * 24));
}

// Date string for N days before today.
export function dateDaysAgo(n: number): string {
  const d = new Date();
  return fmtDate(new Date(d.getFullYear(), d.getMonth(), d.getDate() - n));
}

// "2026-06" → "JUNE 2026"
export function monthLabelOf(period: string): string {
  const [y, m] = period.split("-").map(Number);
  return new Date(y, m - 1, 1)
    .toLocaleDateString("en-US", { month: "long", year: "numeric" })
    .toUpperCase();
}

// Human label for a cycle length.
export function freqLabel(cycleDays: number): string {
  if (cycleDays <= 1) return "Daily";
  if (cycleDays === 7) return "Weekly";
  if (cycleDays === 14) return "Twice a month";
  if (cycleDays === 30 || cycleDays === 31) return "Monthly";
  return `Every ${cycleDays} days`;
}
