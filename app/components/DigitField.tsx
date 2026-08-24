"use client";

import { useEffect, useRef, useState } from "react";

interface Digit {
  x: number;
  y: number;
  ch: string;
  scary: boolean;
  delay: number;
}

// The ambient number field: faint digits scattered behind the board, a
// few of which slowly lurk. Seeded in an effect (never during render) so the
// server and client markup always match.
export default function DigitField() {
  const [digits, setDigits] = useState<Digit[]>([]);

  const reduced = useRef(false);

  useEffect(() => {
    reduced.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const seed = () => {
      if (reduced.current) { setDigits([]); return; }
      const w = window.innerWidth;
      const h = window.innerHeight;
      const cols = Math.max(1, Math.floor(w / 52));
      const rows = Math.max(1, Math.floor(h / 50));
      const next: Digit[] = [];
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          next.push({
            x: c * 52 + 16 + Math.random() * 12,
            y: r * 50 + 12 + Math.random() * 10,
            ch: String(Math.floor(Math.random() * 10)),
            scary: Math.random() < 0.06,
            delay: Math.random() * 7,
          });
        }
      }
      setDigits(next);
    };

    seed();
    const onResize = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(seed, 300);
    };
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      if (timer) clearTimeout(timer);
    };
  }, []);

  return (
    <div className="digit-field" aria-hidden>
      {digits.map((d, i) => (
        <span
          key={i}
          className={d.scary ? "digit-scary" : undefined}
          style={{
            left: d.x,
            top: d.y,
            ...(d.scary ? { animationDelay: `${d.delay}s` } : null),
          }}
        >
          {d.ch}
        </span>
      ))}
    </div>
  );
}
