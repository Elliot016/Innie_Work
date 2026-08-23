"use client";

import { useState } from "react";
import { DEFAULT_PALETTE, Person } from "@/lib/model";

// First-run flow: name the household members, then start from the standard
// template or an empty board.
export default function Onboarding({
  onComplete,
}: {
  onComplete: (people: Person[], mode: "template" | "empty") => void;
}) {
  const [rows, setRows] = useState<{ name: string; color: string }[]>([
    { name: "", color: DEFAULT_PALETTE[0] },
    { name: "", color: DEFAULT_PALETTE[1] },
  ]);

  const edit = (i: number, patch: Partial<{ name: string; color: string }>) =>
    setRows((prev) => prev.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const people: Person[] = rows
    .filter((r) => r.name.trim().length > 0)
    .map((r, i) => ({
      id: `p_${i}_${r.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "")}`,
      name: r.name.trim(),
      color: r.color,
    }));

  const ready = people.length > 0;

  return (
    <div className="onboard">
      <div className="onboard-box">
        <div className="ob-eyebrow">Lumon Home Division</div>
        <div className="ob-title">New Household Detected</div>
        <div className="ob-sub">Who works here? Add at least one person.</div>

        {rows.map((r, i) => (
          <div key={i} className="ob-row">
            <input
              className="set-input"
              placeholder={`Person ${i + 1}`}
              value={r.name}
              onChange={(e) => edit(i, { name: e.target.value })}
            />
            <div className="swatch-row">
              {DEFAULT_PALETTE.map((c) => (
                <button
                  key={c}
                  className={`swatch${r.color === c ? " sel" : ""}`}
                  style={{ background: c }}
                  onClick={() => edit(i, { color: c })}
                  aria-label={`Color ${c}`}
                />
              ))}
            </div>
          </div>
        ))}
        <button
          className="set-row add"
          onClick={() => setRows((prev) => [...prev, { name: "", color: DEFAULT_PALETTE[prev.length % DEFAULT_PALETTE.length] }])}
        >[ + ANOTHER PERSON ]</button>

        <div className="ob-actions">
          <button className="set-btn sel" disabled={!ready} onClick={() => onComplete(people, "template")}>
            STANDARD TEMPLATE
          </button>
          <button className="set-btn" disabled={!ready} onClick={() => onComplete(people, "empty")}>
            BEGIN EMPTY
          </button>
        </div>
        <div className="ob-hint">The template seeds 13 common chores in 5 bins — everything is editable later under ⚙ Manage.</div>
      </div>
    </div>
  );
}
