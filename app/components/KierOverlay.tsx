"use client";

// Full-screen moment when the household hits 100%. The title and tagline are
// household-editable under Manage; tap anywhere to return to work.
export default function KierOverlay({
  show,
  title,
  tagline,
  onDismiss,
}: {
  show: boolean;
  title: string;
  tagline: string;
  onDismiss: () => void;
}) {
  if (!show) return null;
  return (
    <div className="kier" onClick={onDismiss} role="button" aria-label="Dismiss">
      <div className="kier-box">
        <div className="k-t1">{title}</div>
        <div className="k-t2">100%</div>
        <div className="k-t3">{tagline}</div>
        <div className="k-t4">Tap to Return to Work</div>
      </div>
    </div>
  );
}
