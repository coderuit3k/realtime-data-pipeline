import type { ReactNode } from "react";

type KpiCardProps = {
  label: string;
  value: string;
  hint?: string;
  hintColor?: "success" | "error" | "muted";
  icon?: ReactNode;
};

const HINT_COLORS = { success: "text-success", error: "text-error", muted: "text-textMuted" } as const;

/** Single headline metric with an optional icon and a hint line underneath. */
export function KpiCard({ label, value, hint, hintColor = "muted", icon }: KpiCardProps) {
  return (
    <div className="rounded-xl border border-border bg-surface/75 backdrop-blur-md p-5 flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-xs text-textSecondary">{label}</span>
        {icon && <span className="p-1 rounded bg-bg text-accent">{icon}</span>}
      </div>
      <span className="font-mono tabular-nums text-2xl text-textPrimary">{value}</span>
      {hint && (
        <span className={`text-xs ${HINT_COLORS[hintColor]}`}>
          {hint}
        </span>
      )}
    </div>
  );
}
