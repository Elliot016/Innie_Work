"use client";

// Full-screen moment when the household hits 100%: Refinement Complete.
// Tap anywhere to return to work.
export default function KierOverlay({
  show,
  onDismiss,
}: {
  show: boolean;
  onDismiss: () => void;
}) {
  if (!show) return null;
  return (
    <div className="kier" onClick={onDismiss} role="button" aria-label="Dismiss">
      <div className="kier-box">
        <div className="k-t1">Refinement Complete</div>
        <div className="k-t2">100%</div>
        <div className="k-t3">Praise Kier</div>
        <div className="k-t4">Tap to return to work</div>
      </div>
    </div>
  );
}
