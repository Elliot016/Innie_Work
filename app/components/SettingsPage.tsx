"use client";

import { useRef, useState, type CSSProperties } from "react";
import { sanitize, saveAll } from "@/lib/storage";
import {
  BACKUP_STALE_DAYS,
  currentRaw,
  daysSinceBackup,
  deleteSnapshot,
  describe,
  downloadBackup,
  listSnapshots,
  markBackedUp,
  type SnapshotEntry,
} from "@/lib/backup";
import {
  Bin,
  BUILT_IN_ICONS,
  ChoreDefV2,
  DEFAULT_PALETTE,
  DisplayConfig,
  HouseholdConfig,
  MAX_MESSAGE_LEN,
  Person,
  ChoreKind,
  ScoringConfig,
} from "@/lib/model";

type Mutate = (mutate: (cfg: HouseholdConfig) => HouseholdConfig) => void;

const pc = (color: string) => ({ "--pc": color } as CSSProperties);

const KIND_OPTIONS: { k: ChoreKind; label: string }[] = [
  { k: "daily", label: "DAILY" },
  { k: "cycle", label: "CYCLE" },
  { k: "once", label: "ONCE" },
];

function newId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`;
}

// Two-tap delete button: first tap arms it, second tap fires.
function DeleteButton({ label, onConfirm, hint }: { label?: string; onConfirm: () => void; hint?: string }) {
  const [armed, setArmed] = useState(false);
  return (
    <button
      className={`set-btn danger${armed ? " armed" : ""}`}
      onClick={() => {
        if (!armed) { setArmed(true); return; }
        setArmed(false);
        onConfirm();
      }}
      onBlur={() => setArmed(false)}
    >
      {armed ? (hint ?? "CONFIRM?") : (label ?? "DELETE")}
    </button>
  );
}

// ── PEOPLE ─────────────────────────────────────────────────────────────────
function PersonForm({ person, config, onUpdate, onDone }: { person: Person; config: HouseholdConfig; onUpdate: Mutate; onDone: () => void }) {
  const edit = (patch: Partial<Person>) =>
    onUpdate((cfg) => ({
      ...cfg,
      people: cfg.people.map((p) => (p.id === person.id ? { ...p, ...patch } : p)),
    }));
  return (
    <div className="set-form">
      <label className="set-label">Name
        <input
          className="set-input"
          value={person.name}
          onChange={(e) => edit({ name: e.target.value })}
        />
      </label>
      <div className="set-label">Color
        <div className="swatch-row">
          {DEFAULT_PALETTE.map((c) => (
            <button
              key={c}
              className={`swatch${person.color === c ? " sel" : ""}`}
              style={{ background: c }}
              onClick={() => edit({ color: c })}
              aria-label={`Color ${c}`}
            />
          ))}
        </div>
      </div>
      <div className="set-form-actions">
        <button className="set-btn done" onClick={onDone}>✓ DONE</button>
        {config.people.length > 1 && (
          <DeleteButton
            hint="CONFIRM? (their history stays)"
            onConfirm={() =>
              onUpdate((cfg) => ({
                ...cfg,
                people: cfg.people.filter((p) => p.id !== person.id),
                // Strip them from explicit assignee lists; a list emptied this
                // way falls back to "everyone".
                chores: cfg.chores.map((ch) => ({
                  ...ch,
                  assignees: ch.assignees.filter((a) => a !== person.id),
                  // A message aimed at them goes with them.
                  ...(ch.messageFor === person.id ? { message: undefined, messageFor: undefined } : {}),
                })),
              }))
            }
          />
        )}
      </div>
    </div>
  );
}

// ── BINS ───────────────────────────────────────────────────────────────────
function BinForm({ bin, config, onUpdate, onDone }: { bin: Bin; config: HouseholdConfig; onUpdate: Mutate; onDone: () => void }) {
  const edit = (patch: Partial<Bin>) =>
    onUpdate((cfg) => ({
      ...cfg,
      bins: cfg.bins.map((b) => (b.id === bin.id ? { ...b, ...patch } : b)),
    }));
  return (
    <div className="set-form">
      <label className="set-label">Number
        <input className="set-input narrow" value={bin.num} onChange={(e) => edit({ num: e.target.value })} />
      </label>
      <label className="set-label">Label
        <input className="set-input" value={bin.label} onChange={(e) => edit({ label: e.target.value.toUpperCase() })} />
      </label>
      <label className="set-label">Message when cleared (optional)
        <input
          className="set-input"
          maxLength={MAX_MESSAGE_LEN}
          value={bin.message ?? ""}
          placeholder="e.g. The pets are content"
          onChange={(e) => {
            const v = e.target.value;
            edit({ message: v.trim() === "" ? undefined : v });
          }}
        />
      </label>
      <div className="set-hint">
        Shown in caps, in the colour of whoever finishes the bin, when everything in it is done.
      </div>
      <div className="set-form-actions">
        <button className="set-btn done" onClick={onDone}>✓ DONE</button>
        {config.bins.length > 1 && (
          <DeleteButton
            hint="CONFIRM? (its chores move)"
            onConfirm={() =>
              onUpdate((cfg) => {
                const rest = cfg.bins.filter((b) => b.id !== bin.id);
                const target = rest[0];
                return {
                  ...cfg,
                  bins: rest,
                  chores: cfg.chores.map((ch) =>
                    ch.binId === bin.id ? { ...ch, binId: target.id } : ch
                  ),
                };
              })
            }
          />
        )}
      </div>
    </div>
  );
}

// ── CHORES ─────────────────────────────────────────────────────────────────
function ChoreForm({ chore, config, onUpdate, onDone }: { chore: ChoreDefV2; config: HouseholdConfig; onUpdate: Mutate; onDone: () => void }) {
  const edit = (patch: Partial<ChoreDefV2>) =>
    onUpdate((cfg) => ({
      ...cfg,
      chores: cfg.chores.map((c) => (c.id === chore.id ? { ...c, ...patch } : c)),
    }));
  const num = (v: string, fb: number) => {
    const n = parseInt(v, 10);
    return isNaN(n) ? fb : Math.max(1, n);
  };
  const everyone = chore.assignees.length === 0;
  return (
    <div className="set-form">
      <label className="set-label">Name
        <input className="set-input" value={chore.name} onChange={(e) => edit({ name: e.target.value })} />
      </label>
      <label className="set-label">Bin
        <select
          className="set-input"
          value={chore.binId}
          onChange={(e) => edit({ binId: e.target.value })}
        >
          {[...config.bins].sort((a, b) => a.order - b.order).map((b) => (
            <option key={b.id} value={b.id}>{b.num} {b.label}</option>
          ))}
        </select>
      </label>
      <div className="set-label">Kind
        <div className="set-toggle">
          <button
            className={`set-btn${chore.kind === "daily" ? " sel" : ""}`}
            onClick={() => edit({ kind: "daily", cycleDays: 1, greenMax: 1, yellowMax: 1 })}
          >DAILY · EACH ASSIGNEE</button>
          <button
            className={`set-btn${chore.kind === "cycle" ? " sel" : ""}`}
            onClick={() => chore.kind !== "cycle" && edit({ kind: "cycle", cycleDays: 7, greenMax: 5, yellowMax: 6 })}
          >CYCLE · ANY ASSIGNEE</button>
          <button
            className={`set-btn${chore.kind === "once" ? " sel" : ""}`}
            onClick={() => edit({ kind: "once", cycleDays: 1, greenMax: 1, yellowMax: 1 })}
          >ONCE · ONE &amp; DONE</button>
        </div>
      </div>
      {chore.kind === "cycle" && (
        <div className="set-numrow">
          <label className="set-label">Every
            <input
              type="number" min={1} className="set-input narrow" value={chore.cycleDays}
              onChange={(e) => {
                const cycleDays = num(e.target.value, chore.cycleDays);
                edit({
                  cycleDays,
                  greenMax: Math.min(chore.greenMax, cycleDays),
                  yellowMax: Math.min(chore.yellowMax, cycleDays),
                });
              }}
            /> days
          </label>
          <label className="set-label">Yellow at
            <input
              type="number" min={1} max={chore.cycleDays} className="set-input narrow" value={chore.greenMax + 1}
              onChange={(e) => {
                const g = Math.min(Math.max(0, num(e.target.value, chore.greenMax + 1) - 1), chore.cycleDays);
                edit({ greenMax: g, yellowMax: Math.max(g, chore.yellowMax) });
              }}
            />
          </label>
          <label className="set-label">Red at
            <input
              type="number" min={1} max={chore.cycleDays + 1} className="set-input narrow" value={chore.yellowMax + 1}
              onChange={(e) => {
                const y = Math.min(Math.max(chore.greenMax, num(e.target.value, chore.yellowMax + 1) - 1), chore.cycleDays);
                edit({ yellowMax: y });
              }}
            />
          </label>
        </div>
      )}
      <div className="set-label">Assigned to
        <div className="assignee-row">
          <button
            className={`set-btn${everyone ? " sel" : ""}`}
            onClick={() => edit({ assignees: [] })}
          >EVERYONE</button>
          {config.people.map((p) => {
            const on = chore.assignees.includes(p.id);
            return (
              <button
                key={p.id}
                className={`set-btn person${!everyone && on ? " sel" : ""}`}
                style={pc(p.color)}
                onClick={() => {
                  if (everyone) { edit({ assignees: [p.id] }); return; }
                  const next = on
                    ? chore.assignees.filter((a) => a !== p.id)
                    : [...chore.assignees, p.id];
                  edit({ assignees: next }); // emptied list = back to everyone
                }}
              >{p.name}</button>
            );
          })}
        </div>
      </div>
      <label className="set-label">Sub-tasks (comma separated, optional)
        <input
          className="set-input"
          value={(chore.parts ?? []).join(", ")}
          placeholder="e.g. Koa, Panko"
          onChange={(e) => {
            const parts = e.target.value.split(",").map((p) => p.trim()).filter(Boolean);
            edit({ parts: parts.length > 0 ? parts : undefined });
          }}
        />
      </label>
      <label className="set-label">Completion message (optional)
        <input
          className="set-input"
          maxLength={MAX_MESSAGE_LEN}
          value={chore.message ?? ""}
          placeholder="e.g. Thank you for the dishes"
          onChange={(e) => {
            const v = e.target.value;
            // Clearing the message clears its target too, so none linger.
            edit(v.trim() === "" ? { message: undefined, messageFor: undefined } : { message: v });
          }}
        />
      </label>
      {(chore.message ?? "").trim() !== "" && (
        <>
          <div className="set-label">Message for
            <div className="assignee-row">
              <button
                className={`set-btn${!chore.messageFor ? " sel" : ""}`}
                onClick={() => edit({ messageFor: undefined })}
              >EVERYONE</button>
              {config.people.map((p) => (
                <button
                  key={p.id}
                  className={`set-btn person${chore.messageFor === p.id ? " sel" : ""}`}
                  style={pc(p.color)}
                  onClick={() => edit({ messageFor: p.id })}
                >{p.name}</button>
              ))}
            </div>
          </div>
          <div className="set-hint">Shown in caps. {"{name}"} becomes the person&rsquo;s name.</div>
          {chore.messageFor && chore.kind === "daily" && chore.assignees.length > 0
            && !chore.assignees.includes(chore.messageFor) && (
            <div className="set-warn">That person isn&rsquo;t assigned to this chore — the message will never show.</div>
          )}
        </>
      )}
      <div className="set-label">Icon
        <div className="icon-grid">
          <button
            className={`icon-opt${chore.icon === null ? " sel" : ""}`}
            onClick={() => edit({ icon: null })}
          >—</button>
          {BUILT_IN_ICONS.map((icon) => (
            <button
              key={icon}
              className={`icon-opt${chore.icon === icon ? " sel" : ""}`}
              onClick={() => edit({ icon })}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={icon} alt="" />
            </button>
          ))}
        </div>
      </div>
      <div className="set-form-actions">
        <button className="set-btn done" onClick={onDone}>✓ DONE</button>
        <DeleteButton
          onConfirm={() =>
            onUpdate((cfg) => ({ ...cfg, chores: cfg.chores.filter((c) => c.id !== chore.id) }))
          }
        />
      </div>
    </div>
  );
}

// ── DATA (backup / restore) ────────────────────────────────────────────────
// Storage is per device and per home-screen bookmark, so this is how a
// household moves its board to a new iPad or recovers after a re-install:
// copy the backup text on the old device, paste it on the new one.
function DataSection({ open, head }: { open: boolean; head: React.ReactNode }) {
  const [text, setText] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [armed, setArmed] = useState(false);
  const [snaps, setSnaps] = useState<SnapshotEntry[] | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const parse = (raw: string) => {
    try { return sanitize(JSON.parse(raw)); } catch { return null; }
  };
  const summary = (raw: string) => {
    const clean = parse(raw);
    return clean ? describe(clean) : null;
  };

  // A home-screen app hides the URL bar, so this is the only way to see which
  // address a board actually belongs to. A per-deploy Vercel URL here means
  // every deploy hands you a fresh, empty board.
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const looksEphemeral = /-[a-z0-9]{8,}-[^.]*\.vercel\.app$/i.test(origin);

  const since = daysSinceBackup();
  const staleNote =
    since === null
      ? "No backup file downloaded yet."
      : since === 0
        ? "Backed up today."
        : `Last backup ${since} day${since === 1 ? "" : "s"} ago.`;

  // ── the copy that crosses origins
  const saveFile = () => {
    const blob = currentRaw();
    if (!blob) { setStatus("Nothing to back up yet."); return; }
    setStatus(downloadBackup(blob)
      ? "Saved. Keep it in Files or iCloud Drive — that copy survives a new URL or a new iPad."
      : "Couldn't start the download. Use COPY BACKUP below instead.");
  };

  const loadFile = async (f: File | null) => {
    if (!f) return;
    const raw = await f.text();
    if (!parse(raw)) { setStatus("That file doesn't look like a backup."); return; }
    setText(raw);
    setArmed(false);
    setStatus("File loaded. Press IMPORT & REPLACE to apply it.");
  };

  // ── clipboard fallback, unchanged in spirit
  const copyNow = async () => {
    const blob = currentRaw() ?? "";
    setText(blob);
    try {
      await navigator.clipboard.writeText(blob);
      markBackedUp();
      setStatus("Copied. Paste it into Notes, Messages, or the new device.");
    } catch {
      setStatus("Select the text below and copy it.");
    }
  };

  const importNow = () => {
    const clean = parse(text);
    if (!clean) { setStatus("That doesn't look like a valid backup."); setArmed(false); return; }
    if (!armed) { setArmed(true); setStatus(`Replace this device's board with: ${describe(clean)}?`); return; }
    saveAll(clean);
    // The simplest correct rehydration: every hook reloads from storage.
    location.reload();
  };

  const restoreSnap = (e: SnapshotEntry) => {
    setText(e.raw);
    setArmed(false);
    const sum = summary(e.raw);
    setStatus(sum
      ? `Loaded ${e.label}. Press IMPORT & REPLACE to apply it.`
      : `${e.label} can't be read automatically — the raw text is in the box for hand-editing.`);
  };

  return (
    <div className="set-section">
      {head}
      {open && (
      <div className="set-form" style={{ paddingTop: 6 }}>
        <div className="set-hint">
          Your board lives only in this browser, on this exact web address. A different
          address — a preview build, a renamed project, a re-added home screen icon —
          is a different, empty board. A downloaded file is the only copy that follows you.
        </div>
        <div className="set-hint" style={{ color: looksEphemeral ? "var(--red)" : undefined }}>
          This board belongs to: {origin || "unknown"}
          {looksEphemeral
            ? " — that is a one-off deploy address, so the next deploy will give you a different, empty board. Download a backup now, then open the permanent address and restore it there."
            : ""}
        </div>

        <div className="set-toggle">
          <button className="set-btn sel" onClick={saveFile}>[ DOWNLOAD BACKUP FILE ]</button>
          <button className="set-btn" onClick={() => fileRef.current?.click()}>[ RESTORE FROM FILE ]</button>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json,text/plain"
          style={{ display: "none" }}
          onChange={(e) => { void loadFile(e.target.files?.[0] ?? null); e.target.value = ""; }}
        />
        <div className="set-hint">
          {staleNote}{since !== null && since >= BACKUP_STALE_DAYS ? " Worth doing again." : ""}
        </div>

        <div className="set-toggle">
          <button
            className="set-btn"
            onClick={() => setSnaps(snaps ? null : listSnapshots())}
          >{snaps ? "[ HIDE EARLIER COPIES ]" : "[ EARLIER COPIES ON THIS DEVICE ]"}</button>
        </div>
        {snaps && (
          <div className="set-hint">
            {snaps.length === 0
              ? "No earlier copies found on this device."
              : "Everything this browser still holds — daily auto-copies plus any board left behind by an earlier version of the app. None of these survive a new web address; only a downloaded file does."}
          </div>
        )}
        {snaps?.map((e) => (
          <div key={e.key} className="set-toggle">
            <button className="set-btn" onClick={() => restoreSnap(e)}>
              {e.label}{summary(e.raw) ? ` · ${summary(e.raw)}` : ""}
            </button>
            {!e.protected && (
              <button
                className="set-btn danger"
                onClick={() => { deleteSnapshot(e.key); setSnaps(listSnapshots()); }}
              >[ DELETE ]</button>
            )}
          </div>
        ))}

        <label className="set-label">Backup text (paste here to restore)
          <textarea
            className="set-input set-textarea"
            value={text}
            spellCheck={false}
            onChange={(e) => { setText(e.target.value); setArmed(false); setStatus(null); }}
            placeholder="Paste a backup here…"
          />
        </label>
        <div className="set-toggle">
          <button className="set-btn" onClick={copyNow}>[ COPY BACKUP ]</button>
        </div>
        {text.trim() !== "" && summary(text) && (
          <div className="set-hint">Contains: {summary(text)}</div>
        )}
        <div className="set-form-actions">
          <button
            className={`set-btn danger${armed ? " armed" : ""}`}
            disabled={text.trim() === ""}
            onClick={importNow}
          >{armed ? "CONFIRM REPLACE" : "IMPORT & REPLACE"}</button>
        </div>
        {status && <div className="set-hint">{status}</div>}
      </div>
      )}
    </div>
  );
}

export default function SettingsPage({
  config,
  onUpdate,
  onPreviewScreensaver,
}: {
  config: HouseholdConfig;
  onUpdate: Mutate;
  onPreviewScreensaver: () => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const toggle = (id: string) => setOpen((prev) => (prev === id ? null : id));

  // Top-level sections start collapsed so the page reads as a small menu.
  const [openSecs, setOpenSecs] = useState<Set<string>>(() => new Set());
  const toggleSec = (id: string) =>
    setOpenSecs((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  const secHead = (id: string, title: string, hint: string) => (
    <button className="set-sec-head" onClick={() => toggleSec(id)}>
      <span className="set-title">{title}</span>
      <span className="set-row-hint">{hint} · {openSecs.has(id) ? "CLOSE" : "OPEN"}</span>
    </button>
  );

  const addPerson = () =>
    onUpdate((cfg) => {
      const id = newId("p");
      const color = DEFAULT_PALETTE[cfg.people.length % DEFAULT_PALETTE.length];
      setOpen(id);
      return { ...cfg, people: [...cfg.people, { id, name: `Person ${cfg.people.length + 1}`, color }] };
    });

  const addBin = () =>
    onUpdate((cfg) => {
      const id = newId("b");
      setOpen(id);
      return {
        ...cfg,
        bins: [...cfg.bins, {
          id,
          num: String(cfg.bins.length + 1).padStart(2, "0"),
          label: "NEW",
          order: cfg.bins.length,
        }],
      };
    });

  const addChore = () =>
    onUpdate((cfg) => {
      const id = newId("c");
      setOpen(id);
      return {
        ...cfg,
        chores: [...cfg.chores, {
          id,
          name: "New Chore",
          icon: null,
          binId: [...cfg.bins].sort((a, b) => a.order - b.order)[0].id,
          kind: "cycle",
          cycleDays: 7,
          greenMax: 5,
          yellowMax: 6,
          order: cfg.chores.length,
          assignees: [],
        }],
      };
    });

  const scoring = config.scoring;
  const setScoring = (patch: Partial<ScoringConfig>) =>
    onUpdate((cfg) => ({ ...cfg, scoring: { ...cfg.scoring, ...patch } }));
  const setMessage = (key: keyof HouseholdConfig["messages"], value: string) =>
    onUpdate((cfg) => ({ ...cfg, messages: { ...cfg.messages, [key]: value } }));
  const display = config.display;
  const setDisplay = (patch: Partial<DisplayConfig>) =>
    onUpdate((cfg) => ({ ...cfg, display: { ...cfg.display, ...patch } }));

  const binLabel = (binId: string) => {
    const b = config.bins.find((bb) => bb.id === binId);
    return b ? `${b.num} ${b.label}` : "?";
  };

  return (
    <div className="settings-body">
      <div className="set-section">
        {secHead("people", "People", String(config.people.length))}
        {openSecs.has("people") && (<>
        {config.people.map((p) => (
          <div key={p.id} className="set-row-wrap">
            <button className="set-row" onClick={() => toggle(p.id)}>
              <span className="set-row-name" style={pc(p.color)}>
                <span className="leg-dot" style={{ background: p.color }} />{p.name}
              </span>
              <span className="set-row-hint">{open === p.id ? "CLOSE" : "EDIT"}</span>
            </button>
            {open === p.id && <PersonForm person={p} config={config} onUpdate={onUpdate} onDone={() => setOpen(null)} />}
          </div>
        ))}
        <button className="set-row add" onClick={addPerson}>[ + ADD PERSON ]</button>
        </>)}
      </div>

      <div className="set-section">
        {secHead("bins", "Bins", String(config.bins.length))}
        {openSecs.has("bins") && (<>
        {[...config.bins].sort((a, b) => a.order - b.order).map((b) => (
          <div key={b.id} className="set-row-wrap">
            <button className="set-row" onClick={() => toggle(b.id)}>
              <span className="set-row-name">{b.num} · {b.label}</span>
              <span className="set-row-hint">
                {config.chores.filter((c) => c.binId === b.id).length} CHORES · {open === b.id ? "CLOSE" : "EDIT"}
              </span>
            </button>
            {open === b.id && <BinForm bin={b} config={config} onUpdate={onUpdate} onDone={() => setOpen(null)} />}
          </div>
        ))}
        <button className="set-row add" onClick={addBin}>[ + ADD BIN ]</button>
        </>)}
      </div>

      <div className="set-section">
        {secHead("chores", "Chores", String(config.chores.length))}
        {openSecs.has("chores") && (<>
        {[...config.chores].sort((a, b) => a.order - b.order).map((c) => (
          <div key={c.id} className="set-row-wrap">
            <button className="set-row" onClick={() => toggle(c.id)}>
              <span className="set-row-name">{c.name}</span>
              <span className="set-row-hint">{binLabel(c.binId)} · {open === c.id ? "CLOSE" : "EDIT"}</span>
            </button>
            {open === c.id && <ChoreForm chore={c} config={config} onUpdate={onUpdate} onDone={() => setOpen(null)} />}
          </div>
        ))}
        <button className="set-row add" onClick={addChore}>[ + ADD CHORE ]</button>
        </>)}
      </div>

      <div className="set-section">
        {secHead("scoring", "Scoring", `${scoring.countKind.toUpperCase()} · ${scoring.celebrateAt}%`)}
        {openSecs.has("scoring") && (
        <div className="set-form" style={{ paddingTop: 6 }}>
          <div className="set-label">Counts toward the percentage
            <div className="set-toggle">
              {KIND_OPTIONS.map(({ k, label }) => (
                <button
                  key={k}
                  className={`set-btn${scoring.countKind === k ? " sel" : ""}`}
                  onClick={() => setScoring({ countKind: k })}
                >{label}</button>
              ))}
            </div>
          </div>
          <div className="set-hint">Drives the top percentage only. Each bin always shows its own progress.</div>
          <label className="set-label">Celebrate at
            <input
              type="number" min={1} max={100}
              className="set-input narrow"
              value={scoring.celebrateAt}
              onChange={(e) => {
                const n = parseInt(e.target.value, 10);
                setScoring({ celebrateAt: isNaN(n) ? scoring.celebrateAt : Math.min(100, Math.max(1, n)) });
              }}
            /> %
          </label>
          <div className="set-hint">Fires once a day, when the board crosses up into that number.</div>
        </div>
        )}
      </div>

      <div className="set-section">
        {secHead("messages", "Messages", `${scoring.celebrateAt}%`)}
        {openSecs.has("messages") && (
        <div className="set-form" style={{ paddingTop: 6 }}>
          <label className="set-label">Celebration title
            <input
              className="set-input"
              value={config.messages.completeTitle}
              onChange={(e) => setMessage("completeTitle", e.target.value)}
            />
          </label>
          <label className="set-label">Celebration tagline
            <input
              className="set-input"
              value={config.messages.completeTagline}
              onChange={(e) => setMessage("completeTagline", e.target.value)}
            />
          </label>
          <label className="set-label">Praise title
            <input
              className="set-input"
              value={config.messages.praiseTitle}
              onChange={(e) => setMessage("praiseTitle", e.target.value)}
            />
          </label>
          <label className="set-label">Praise subtitle
            <input
              className="set-input"
              value={config.messages.praiseSub}
              onChange={(e) => setMessage("praiseSub", e.target.value)}
            />
          </label>
          <div className="set-hint">{"{name}"} becomes the person&rsquo;s name. Titles are shown in caps.</div>
        </div>
        )}
      </div>

      <div className="set-section">
        {secHead("display", "Display",
          display.screensaverMin === 0 ? "SCREENSAVER OFF" : `SCREENSAVER · ${display.screensaverMin} MIN`)}
        {openSecs.has("display") && (
        <div className="set-form" style={{ paddingTop: 6 }}>
          <label className="set-label">Screensaver after
            <input
              type="number" min={0} max={120}
              className="set-input narrow"
              value={display.screensaverMin}
              onChange={(e) => {
                const n = parseInt(e.target.value, 10);
                setDisplay({ screensaverMin: isNaN(n) ? 0 : Math.min(120, Math.max(0, n)) });
              }}
            /> min
          </label>
          <div className="set-hint">0 = never. Any tap wakes the board.</div>
          <div className="set-toggle">
            <button className="set-btn" onClick={onPreviewScreensaver}>[ PREVIEW ]</button>
          </div>
        </div>
        )}
      </div>

      <DataSection open={openSecs.has("data")} head={secHead("data", "Data", "BACKUP · RESTORE")} />
    </div>
  );
}
