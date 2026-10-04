import type { LogEntry } from "@/lib/types";
import { detectLogLevel, logLevelColor } from "@/lib/logLevel";
import { LiveBadge } from "./LiveBadge";

type LogPanelProps = {
  /** null while loading. */
  logs: LogEntry[] | null;
  error?: boolean;
  className?: string;
};

/** Terminal-style recent CloudWatch lines, shared by the home and dashboard pages. */
export function LogPanel({ logs, error = false, className = "" }: LogPanelProps) {
  return (
    <section className={`rounded-xl border border-border bg-surface/75 backdrop-blur-md p-5 flex flex-col gap-3 ${className}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-error/70" />
          <span className="w-2.5 h-2.5 rounded-full bg-warning/70" />
          <span className="w-2.5 h-2.5 rounded-full bg-success/70" />
          <h2 className="ml-1.5 text-[13px] font-semibold text-textPrimary">Log gần đây</h2>
        </div>
        <LiveBadge status="ok" label="LIVE" />
      </div>
      <div className="flex max-h-80 flex-col gap-2 overflow-auto text-[11.5px] leading-relaxed text-textMuted">
        {logs === null && !error && <span>Đang tải log…</span>}
        {error && <span>Không tải được log.</span>}
        {logs !== null && logs.length === 0 && <span>Chưa có log trong 24h qua.</span>}
        {logs?.map((log, i) => {
          const level = detectLogLevel(log.message);
          return (
            <span key={i} className="break-all">
              <span className={`font-semibold ${logLevelColor(level)}`}>{level}</span> {log.source}: {log.message}
            </span>
          );
        })}
      </div>
    </section>
  );
}
