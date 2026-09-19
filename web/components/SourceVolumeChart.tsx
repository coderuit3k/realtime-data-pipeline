import type { SourceVolume } from "@/lib/types";

const LABELS: Record<string, string> = {
  hackernews: "HackerNews",
  news: "News API",
  weather: "Weather",
  crypto: "Crypto",
  github: "GitHub",
};

export function SourceVolumeChart({ sourceVolumes }: { sourceVolumes: SourceVolume[] }) {
  const max = Math.max(1, ...sourceVolumes.map((s) => s.records));
  return (
    <div className="rounded-2xl border border-border bg-surface p-6 flex flex-col gap-4">
      <span className="text-sm font-semibold text-textPrimary">Khối lượng theo nguồn (hôm nay)</span>
      <div className="flex items-end gap-6 h-40">
        {sourceVolumes.map((s) => (
          <div key={s.source} className="flex flex-col items-center gap-2 flex-1 h-full">
            <span className="font-mono text-xs text-textSecondary">{s.records}</span>
            <div className="w-full flex-1 flex items-end">
              <div
                className="w-full rounded-t bg-accent"
                style={{ height: `${(s.records / max) * 100}%` }}
              />
            </div>
            <span className="text-xs text-textMuted">{LABELS[s.source] ?? s.source}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
