import type { SourceVolume } from "@/lib/types";
import { CardIcon, SectionCard } from "./SectionCard";

const LABELS: Record<string, string> = {
  hackernews: "HackerNews",
  news: "News API",
  weather: "Weather",
  crypto: "Crypto",
  github: "GitHub",
};

/** Today's record count per source as bars scaled to the busiest source. */
export function SourceVolumeChart({ sourceVolumes, className }: { sourceVolumes: SourceVolume[]; className?: string }) {
  // Floor of 1 avoids dividing by zero when every source is empty.
  const max = Math.max(1, ...sourceVolumes.map((s) => s.records));
  return (
    <SectionCard title="Khối lượng theo nguồn (hôm nay)" icon={<CardIcon d="M2 12h4l2.5-7 4 14 2.5-7H22" />} className={className}>
      <div className="flex h-44 items-end gap-2 sm:gap-5">
        {sourceVolumes.map((s) => (
          <div key={s.source} className="flex h-full min-w-0 flex-1 flex-col items-center gap-2">
            <span className="text-xs font-semibold tabular-nums text-textPrimary">{s.records}</span>
            <div className="flex w-full flex-1 items-end">
              <div
                className="bar-grow-y w-full rounded-t-md bg-gradient-to-t from-accent to-accentBright"
                style={{ height: `${Math.max(2, (s.records / max) * 100)}%` }}
              />
            </div>
            <span className="w-full truncate text-center text-[11.5px] text-textMuted">{LABELS[s.source] ?? s.source}</span>
          </div>
        ))}
      </div>
    </SectionCard>
  );
}
