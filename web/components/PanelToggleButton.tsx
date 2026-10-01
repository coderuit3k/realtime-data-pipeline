"use client";

// Chevron points where the panel will move: toward its own edge to collapse,
// away from it to expand.
export function PanelToggleButton({
  collapsed,
  edge,
  label,
  onClick,
  alert = false,
}: {
  collapsed: boolean;
  edge: "left" | "right";
  label: string;
  onClick: () => void;
  alert?: boolean;
}) {
  const pointsLeft = (edge === "left") !== collapsed;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-expanded={!collapsed}
      title={label}
      className="relative w-7 h-7 flex items-center justify-center rounded-md text-textSecondary hover:text-accent hover:bg-bg/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent flex-shrink-0"
    >
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
        <path d={pointsLeft ? "m15 18-6-6 6-6" : "m9 18 6-6-6-6"} />
      </svg>
      {alert && <span className="absolute top-0.5 right-0.5 w-2 h-2 rounded-full bg-error" />}
    </button>
  );
}
