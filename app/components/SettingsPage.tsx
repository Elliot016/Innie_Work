"use client";

import { useState, type CSSProperties } from "react";
import {
  Bin,
  BUILT_IN_ICONS,
  ChoreDefV2,
  DEFAULT_PALETTE,
  HouseholdConfig,
  Person,
} from "@/lib/model";

type Mutate = (mutate: (cfg: HouseholdConfig) => HouseholdConfig) => void;

const pc = (color: string) => ({ "--pc": color } as CSSProperties);

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
function PersonForm({ person, config, onUpdate }: { person: Person; config: HouseholdConfig; onUpdate: Mutate }) {
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
              })),
            }))
          }
        />
      )}
    </div>
  );
}

// ── BINS ───────────────────────────────────────────────────────────────────
function BinForm({ bin, config, onUpdate }: { bin: Bin; config: HouseholdConfig; onUpdate: Mutate }) {
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
  );
}

// ── CHORES ─────────────────────────────────────────────────────────────────
function ChoreForm({ chore, config, onUpdate }: { chore: ChoreDefV2; config: HouseholdConfig; onUpdate: Mutate }) {
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
      <DeleteButton
        onConfirm={() =>
          onUpdate((cfg) => ({ ...cfg, chores: cfg.chores.filter((c) => c.id !== chore.id) }))
        }
      />
    </div>
  );
}

// ── PAGE ───────────────────────────────────────────────────────────────────
export default function SettingsPage({ config, onUpdate }: { config: HouseholdConfig; onUpdate: Mutate }) {
  const [open, setOpen] = useState<string | null>(null);
  const toggle = (id: string) => setOpen((prev) => (prev === id ? null : id));

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

  const binLabel = (binId: string) => {
    const b = config.bins.find((bb) => bb.id === binId);
    return b ? `${b.num} ${b.label}` : "?";
  };

  return (
    <div className="settings-body">
      <div className="set-section">
        <div className="set-title">People</div>
        {config.people.map((p) => (
          <div key={p.id} className="set-row-wrap">
            <button className="set-row" onClick={() => toggle(p.id)}>
              <span className="set-row-name" style={pc(p.color)}>
                <span className="leg-dot" style={{ background: p.color }} />{p.name}
              </span>
              <span className="set-row-hint">{open === p.id ? "CLOSE" : "EDIT"}</span>
            </button>
            {open === p.id && <PersonForm person={p} config={config} onUpdate={onUpdate} />}
          </div>
        ))}
        <button className="set-row add" onClick={addPerson}>[ + ADD PERSON ]</button>
      </div>

      <div className="set-section">
        <div className="set-title">Bins</div>
        {[...config.bins].sort((a, b) => a.order - b.order).map((b) => (
          <div key={b.id} className="set-row-wrap">
            <button className="set-row" onClick={() => toggle(b.id)}>
              <span className="set-row-name">{b.num} · {b.label}</span>
              <span className="set-row-hint">
                {config.chores.filter((c) => c.binId === b.id).length} CHORES · {open === b.id ? "CLOSE" : "EDIT"}
              </span>
            </button>
            {open === b.id && <BinForm bin={b} config={config} onUpdate={onUpdate} />}
          </div>
        ))}
        <button className="set-row add" onClick={addBin}>[ + ADD BIN ]</button>
      </div>

      <div className="set-section">
        <div className="set-title">Chores</div>
        {[...config.chores].sort((a, b) => a.order - b.order).map((c) => (
          <div key={c.id} className="set-row-wrap">
            <button className="set-row" onClick={() => toggle(c.id)}>
              <span className="set-row-name">{c.name}</span>
              <span className="set-row-hint">{binLabel(c.binId)} · {open === c.id ? "CLOSE" : "EDIT"}</span>
            </button>
            {open === c.id && <ChoreForm chore={c} config={config} onUpdate={onUpdate} />}
          </div>
        ))}
        <button className="set-row add" onClick={addChore}>[ + ADD CHORE ]</button>
      </div>
    </div>
  );
}
