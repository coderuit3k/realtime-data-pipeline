type LiveBadgeProps = {
  status: "ok" | "error" | "idle";
  label?: string;
};

const STATUS_CONFIG = {
  ok: { dot: "bg-success", text: "text-success", pulse: true, defaultLabel: "OK" },
  error: { dot: "bg-error", text: "text-error", pulse: false, defaultLabel: "LỖI" },
  idle: { dot: "bg-textMuted", text: "text-textMuted", pulse: false, defaultLabel: "CHƯA CHẠY" },
} as const;

export function LiveBadge({ status, label }: LiveBadgeProps) {
  const config = STATUS_CONFIG[status];
  return (
    <span className={`inline-flex items-center gap-1.5 font-mono text-[10.5px] tracking-wide ${config.text}`}>
      <span className="relative flex h-1.5 w-1.5">
        {config.pulse && (
          <span className={`absolute inline-flex h-full w-full animate-ping rounded-full ${config.dot} opacity-75`} />
        )}
        <span className={`relative inline-flex h-1.5 w-1.5 rounded-full ${config.dot} ${config.pulse ? "shadow-glowEmerald" : ""}`} />
      </span>
      {label ?? config.defaultLabel}
    </span>
  );
}
