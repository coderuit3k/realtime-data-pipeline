import type { ReactNode } from "react";

/** Horizontal rank row: label, proportional bar (the top row is highlighted) and value. */
export function RankRow({
  label,
  value,
  max,
  display,
  lead,
  labelWidth = "w-24",
}: {
  label: string;
  value: number;
  max: number;
  display?: string;
  lead?: ReactNode;
  labelWidth?: string;
}) {
  const isTop = value === max;
  return (
    <div className="flex items-center gap-3">
      {lead}
      <span className={`${labelWidth} shrink-0 truncate text-[12px] text-textSecondary`} title={label}>
        {label}
      </span>
      <div className="h-2 flex-grow rounded-full bg-white/[0.04]">
        <div
          className={`bar-grow h-full rounded-full ${
            isTop ? "bg-gradient-to-r from-accent to-accentBright shadow-glowCyan" : "bg-accent/40"
          }`}
          style={{ width: `${Math.max(2, (value / max) * 100)}%` }}
        />
      </div>
      <span className="min-w-12 shrink-0 text-right text-[12px] font-semibold tabular-nums text-textPrimary">
        {display ?? value}
      </span>
    </div>
  );
}
