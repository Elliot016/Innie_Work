"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// Resettable idle timer for the screensaver.
//   idle   — true once `delayMs` passes with no activity (or after sleep()).
//   wake   — clear idle and re-arm (any tap/key; also the saver's own onClick).
//   sleep  — force idle now (Settings → PREVIEW).
//   onIdle — called each time idle flips on, from the timer or sleep(), so
//            the caller can reset session state (who's viewing) without a
//            setState inside an effect.
// delayMs <= 0 never arms the timer; sleep() still works so PREVIEW can be
// used while the saver is switched off.
//
// Two listener classes, deliberately:
//   pointerdown / touchstart / wheel  → re-arm only.
//   click / keydown                    → wake.
// Waking on `click` rather than pointerdown/up is what makes dismissal safe:
// the saver unmounts in a microtask after this listener returns, but the
// click's propagation path was fixed when dispatch began (window → … →
// .clip-wrap → .screensaver), so it can never be re-targeted at the board.
export function useIdle(delayMs: number, onIdle?: () => void) {
  const [idle, setIdle] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onIdleRef = useRef(onIdle);
  useEffect(() => { onIdleRef.current = onIdle; }, [onIdle]);

  const goIdle = useCallback(() => { setIdle(true); onIdleRef.current?.(); }, []);

  const arm = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = delayMs > 0 ? setTimeout(goIdle, delayMs) : null;
  }, [delayMs, goIdle]);

  const wake = useCallback(() => { setIdle(false); arm(); }, [arm]);
  const sleep = useCallback(() => { goIdle(); }, [goIdle]);

  useEffect(() => {
    arm(); // (re)arm on mount and whenever the delay setting changes
    const onActivity = () => arm();
    const onWake = () => wake();
    const onVis = () => { if (document.visibilityState === "visible") wake(); };
    const opts: AddEventListenerOptions = { capture: true, passive: true };
    window.addEventListener("pointerdown", onActivity, opts);
    window.addEventListener("touchstart", onActivity, opts);
    window.addEventListener("wheel", onActivity, opts);
    window.addEventListener("click", onWake, opts);
    window.addEventListener("keydown", onWake, opts);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.removeEventListener("pointerdown", onActivity, opts);
      window.removeEventListener("touchstart", onActivity, opts);
      window.removeEventListener("wheel", onActivity, opts);
      window.removeEventListener("click", onWake, opts);
      window.removeEventListener("keydown", onWake, opts);
      document.removeEventListener("visibilitychange", onVis);
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
    };
  }, [arm, wake]);

  return { idle, wake, sleep };
}
