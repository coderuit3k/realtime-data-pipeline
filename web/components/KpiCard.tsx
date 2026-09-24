type KpiCardProps = {
  label: string;
  value: string;
  hint?: string;
  hintColor?: "success" | "muted";
};

export function KpiCard({ label, value, hint, hintColor = "muted" }: KpiCardProps) {
  return (
    <div className="rounded-lg border border-border bg-surface/75 backdrop-blur-md p-5 flex flex-col gap-2">
      <span className="text-xs text-textSecondary">{label}</span>
      <span className="font-mono tabular-nums text-2xl text-textPrimary">{value}</span>
      {hint && (
        <span className={`text-xs ${hintColor === "success" ? "text-success" : "text-textMuted"}`}>
          {hint}
        </span>
      )}
    </div>
  );
}
