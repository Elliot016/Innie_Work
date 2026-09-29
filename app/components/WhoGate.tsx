"use client";

import { type CSSProperties } from "react";
import { Person, SPACE_MOTTO } from "@/lib/model";

// Who is looking at the terminal right now. Session-only: never stored, and
// reset every time the screensaver comes on, so waking the panel asks again.
export type Viewer =
  | { kind: "none" }
  | { kind: "household" }
  | { kind: "person"; id: string };

export const NOBODY: Viewer = { kind: "none" };

// The wake-up question. The house logo blinks beside it like a terminal
// cursor; one button per person, with the shared household in the middle.
export default function WhoGate({
  people,
  onChoose,
}: {
  people: Person[];
  onChoose: (v: Viewer) => void;
}) {
  const mid = Math.ceil(people.length / 2);
  const personBtn = (p: Person) => (
    <button
      key={p.id}
      className="gate-btn person"
      style={{ "--pc": p.color } as CSSProperties}
      onClick={() => onChoose({ kind: "person", id: p.id })}
    >
      {p.name}
    </button>
  );
  return (
    <div className="gate" role="dialog" aria-label="Who are you?">
      <div className="gate-box">
        <div className="gate-motto">{SPACE_MOTTO}</div>
        <div className="gate-q">
          <span>Who are you?</span>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/pp-atom.png" alt="" className="gate-cursor" aria-hidden />
        </div>
        <div className="gate-opts">
          {people.slice(0, mid).map(personBtn)}
          <button className="gate-btn" onClick={() => onChoose({ kind: "household" })}>
            Household
          </button>
          {people.slice(mid).map(personBtn)}
        </div>
      </div>
    </div>
  );
}
