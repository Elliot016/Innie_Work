import { LEGACY_KEY_V2, PersistedV2, STORAGE_KEY_V2 } from "./model";
import { todayStr } from "./time";
import { migrateV1 } from "./migrate";

// ── Local safety net ───────────────────────────────────────────────────────
// The board lives in localStorage, which is bound to the exact origin. Opening
// a different URL (a Vercel preview build, a renamed project, a re-added home
// screen icon) gives you a brand-new empty board while the old one sits
// untouched under the old origin — nothing in here can reach across that line.
//
// So there are two layers. Snapshots and quarantine protect against damage on
// *this* origin: a bad settings edit, a half-written blob, a schema change.
// The downloaded file is the only thing that survives an origin change or a
// wiped device, which is why the app nags about it.

const SNAP_PREFIX = "pnp:snap:";
const CORRUPT_PREFIX = "pnp:corrupt:";
const LAST_BACKUP_KEY = "pnp:lastBackup";

const MAX_SNAPSHOTS = 7;   // one per day; a ~4.5KB blob makes this ~32KB total
const MAX_QUARANTINE = 3;
export const BACKUP_STALE_DAYS = 14;

function keysWithPrefix(prefix: string): string[] {
  const out: string[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(prefix)) out.push(k);
    }
  } catch {}
  return out.sort();   // both prefixes use sortable date/ISO suffixes
}

function trimTo(prefix: string, max: number): void {
  const keys = keysWithPrefix(prefix);
  try {
    for (const k of keys.slice(0, Math.max(0, keys.length - max))) {
      localStorage.removeItem(k);
    }
  } catch {}
}

/** The raw blob currently on disk, whichever key it lives under. */
export function currentRaw(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY_V2) ?? localStorage.getItem(LEGACY_KEY_V2);
  } catch {
    return null;
  }
}

// ── Snapshots ──────────────────────────────────────────────────────────────

export interface SnapshotEntry {
  key: string;
  label: string;      // "2026-08-26", "before the rebrand", "unreadable · …"
  corrupt: boolean;
  raw: string;
  /** Someone else's data, not ours to delete — hides the delete control. */
  protected?: boolean;
}

// Boards written by earlier versions of this app. They are still sitting in
// storage on any device that has been through a rename: `loadAll` only reads
// LEGACY_KEY_V2 when the current key is missing, so once a new board exists
// the old one becomes invisible without ever being deleted. This is how you
// find it again.
const LEGACY_SOURCES: { key: string; label: string }[] = [
  { key: LEGACY_KEY_V2, label: "before the rebrand" },
];

/**
 * Keep yesterday's board before today's first write lands on top of it. One
 * snapshot per day: the point is to be able to step back to a *known good*
 * day, not to record every keystroke — snapshotting on every save would push
 * the last good copy out of the window within minutes of a bad edit.
 */
export function snapshotBeforeWrite(): void {
  const raw = currentRaw();
  if (!raw) return;
  const key = SNAP_PREFIX + todayStr();
  try {
    if (localStorage.getItem(key) !== null) return;   // already have today's
    localStorage.setItem(key, raw);
  } catch {
    return;   // out of quota: the live board matters more than its history
  }
  trimTo(SNAP_PREFIX, MAX_SNAPSHOTS);
}

/**
 * Set aside a blob we could not read instead of letting the next save write
 * over it. Unreadable is not the same as worthless — this is exactly the data
 * a human might still rescue by hand.
 */
export function quarantine(raw: string): string | null {
  const key = CORRUPT_PREFIX + new Date().toISOString();
  try {
    localStorage.setItem(key, raw);
  } catch {
    return null;
  }
  trimTo(CORRUPT_PREFIX, MAX_QUARANTINE);
  return key;
}

/** Every recoverable copy on this device, newest first. */
export function listSnapshots(): SnapshotEntry[] {
  const read = (k: string, corrupt: boolean): SnapshotEntry | null => {
    let raw: string | null = null;
    try { raw = localStorage.getItem(k); } catch {}
    if (!raw) return null;
    const label = corrupt
      ? `unreadable · ${k.slice(CORRUPT_PREFIX.length, CORRUPT_PREFIX.length + 16).replace("T", " ")}`
      : k.slice(SNAP_PREFIX.length);
    return { key: k, label, corrupt, raw };
  };
  const mine = [
    ...keysWithPrefix(SNAP_PREFIX).map((k) => read(k, false)),
    ...keysWithPrefix(CORRUPT_PREFIX).map((k) => read(k, true)),
  ]
    .filter((e): e is SnapshotEntry => e !== null)
    .reverse();

  const legacy: SnapshotEntry[] = [];
  for (const src of LEGACY_SOURCES) {
    // Skip it when it is simply the board we are already running.
    let raw: string | null = null;
    try { raw = localStorage.getItem(src.key); } catch {}
    if (!raw || raw === currentRaw()) continue;
    legacy.push({ key: src.key, label: src.label, corrupt: false, raw, protected: true });
  }

  // The original hard-coded version stored a different shape entirely, so it
  // is converted on the fly rather than offered as raw text.
  try {
    if (localStorage.getItem("inniework") !== null) {
      const converted = migrateV1();
      if (converted) {
        legacy.push({
          key: "inniework",
          label: "original version (converted)",
          corrupt: false,
          raw: JSON.stringify(converted),
          protected: true,
        });
      }
    }
  } catch {}

  return [...mine, ...legacy];
}

export function deleteSnapshot(key: string): void {
  try { localStorage.removeItem(key); } catch {}
}

// ── The exported file — the only copy that crosses origins ─────────────────

export function backupFilename(): string {
  return `purge-and-polish-${todayStr()}.json`;
}

/**
 * Hand the blob to the OS as a real file. On iPadOS this lands in Files (and
 * iCloud Drive if that's the default), which is what actually survives a new
 * URL, a re-added home screen icon or a wiped device.
 */
export function downloadBackup(raw: string): boolean {
  try {
    const url = URL.createObjectURL(new Blob([raw], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = backupFilename();
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Revoking immediately can cancel the download on some WebKit builds.
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    markBackedUp();
    return true;
  } catch {
    return false;
  }
}

export function markBackedUp(): void {
  try { localStorage.setItem(LAST_BACKUP_KEY, todayStr()); } catch {}
}

export function lastBackupDate(): string | null {
  try { return localStorage.getItem(LAST_BACKUP_KEY); } catch { return null; }
}

/** Whole days since the last export, or null if there has never been one. */
export function daysSinceBackup(): number | null {
  const d = lastBackupDate();
  if (!d) return null;
  const then = Date.parse(d + "T00:00:00");
  const now = Date.parse(todayStr() + "T00:00:00");
  if (!isFinite(then) || !isFinite(now)) return null;
  return Math.max(0, Math.round((now - then) / 86_400_000));
}

export function backupIsStale(): boolean {
  const n = daysSinceBackup();
  return n === null || n >= BACKUP_STALE_DAYS;
}

/**
 * Ask the browser not to evict us under storage pressure. Safari grants this
 * automatically to home-screen apps and ignores the call otherwise; Chrome
 * decides from engagement. Harmless everywhere, so it is never awaited.
 */
export function requestPersistence(): void {
  try {
    navigator.storage?.persist?.().catch(() => {});
  } catch {}
}

/** A one-line description of a blob, for confirming before you overwrite. */
export function describe(data: PersistedV2): string {
  return `${data.config.people.length} people · ${data.config.chores.length} chores · ${data.history.length} archived months`;
}
