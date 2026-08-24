"use client";

import { useEffect, type CSSProperties } from "react";

export interface Toast {
  key: string;
  title: string;
  sub: string;
  color: string | null; // the person's colour; null = default phosphor
}

export const TOAST_MS = 4000;

// A completion message, shown the way the celebration is — full screen, in the
// colour of whoever earned it — instead of stacking up on the board. Fades
// itself out after a few seconds so a wall display never gets stuck on one.
export default function ToastOverlay({
  toast,
  onDismiss,
}: {
  toast: Toast | null;
  onDismiss: () => void;
}) {
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(onDismiss, TOAST_MS);
    return () => clearTimeout(t);
  }, [toast, onDismiss]);

  if (!toast) return null;
  const style = toast.color ? ({ "--pc": toast.color } as CSSProperties) : undefined;
  return (
    <div
      className={`toast-ov${toast.color ? " tinted" : ""}`}
      style={style}
      onClick={onDismiss}
      role="button"
      aria-label="Dismiss"
    >
      <div className="toast-box">
        <div className="toast-title">{toast.title}</div>
        {toast.sub.trim() !== "" && <div className="toast-sub">{toast.sub}</div>}
      </div>
    </div>
  );
}
