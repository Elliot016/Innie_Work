"use client";

import { useEffect } from "react";

// Keep the panel awake while the app is visible. Silent no-op where the
// Screen Wake Lock API is missing (non-HTTPS dev over LAN, iOS < 16.4).
// The OS releases the lock whenever the page is hidden, so it is re-requested
// on every return to visibility — and on the next tap, in case the first
// request was refused (Low Power Mode, battery policy).
//
// iOS notes: needs Safari/iOS 16.4+ and a secure context (the HTTPS deploy or
// localhost — not http://LAN-IP:3000). Low Power Mode can refuse it. For a
// wall-mounted iPad the reliable belt-and-braces is Settings → Display &
// Brightness → Auto-Lock → Never (and/or Guided Access); this hook is the
// polite layer on top, not a substitute.
type NavWithWakeLock = { wakeLock?: Pick<WakeLock, "request"> };

export function useWakeLock(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const wl = (navigator as NavWithWakeLock).wakeLock;
    if (!wl) return;

    let sentinel: WakeLockSentinel | null = null;
    let disposed = false;

    const request = async () => {
      if (disposed || document.visibilityState !== "visible") return;
      if (sentinel && !sentinel.released) return;
      try {
        const s = await wl.request("screen");
        if (disposed) { void s.release(); return; }
        sentinel = s;
      } catch {
        // Refused (policy / low power). Retried on next visibility or tap.
      }
    };
    const onVis = () => { if (document.visibilityState === "visible") void request(); };
    const onTap = () => { void request(); };
    const tapOpts: AddEventListenerOptions = { capture: true, passive: true };

    void request();
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("pointerdown", onTap, tapOpts);
    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("pointerdown", onTap, tapOpts);
      if (sentinel && !sentinel.released) void sentinel.release();
      sentinel = null;
    };
  }, [enabled]);
}
