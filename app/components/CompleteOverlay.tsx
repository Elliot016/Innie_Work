"use client";

// Full-screen moment when the household hits 100%. The title and tagline are
// household-editable under Manage; tap anywhere to return to work.
export default function CompleteOverlay({
  show,
  pct,
  title,
  tagline,
  onDismiss,
}: {
  show: boolean;
  pct: number;
  title: string;
  tagline: string;
  onDismiss: () => void;
}) {
  if (!show) return null;
  return (
    <div className="complete-ov" onClick={onDismiss} role="button" aria-label="Dismiss">
      <div className="complete-box">
        <div className="co-t1">{title}</div>
        <div className="co-t2">{pct}%</div>
        <div className="co-t3">{tagline}</div>
        <div className="co-t4">Tap to Return to Work</div>
      </div>
    </div>
  );
}
