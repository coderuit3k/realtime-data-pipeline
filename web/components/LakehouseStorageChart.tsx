import type { StorageStats } from "@/lib/types";

function formatBytes(bytes: number | null): string {
  if (bytes === null) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }
  return `${value.toFixed(1)} ${units[unitIndex]}`;
}

const ZONES = [
  { key: "raw", label: "S3 raw", swatch: "bg-accent" },
  { key: "curated", label: "S3 curated", swatch: "bg-secondary" },
] as const;

export function LakehouseStorageChart({
  rawStorage,
  curatedStorage,
}: {
  rawStorage: StorageStats;
  curatedStorage: StorageStats;
}) {
  const rawBytes = rawStorage.sizeBytes ?? 0;
  const curatedBytes = curatedStorage.sizeBytes ?? 0;
  const total = rawBytes + curatedBytes;
  const hasData = total > 0;
  const rawPct = hasData ? (rawBytes / total) * 100 : 50;
  const curatedPct = hasData ? (curatedBytes / total) * 100 : 50;
  const stats = { raw: rawStorage, curated: curatedStorage };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline gap-2">
        <span className="font-mono tabular-nums text-2xl text-textPrimary">
          {hasData ? formatBytes(total) : "—"}
        </span>
        <span className="text-[11px] text-textMuted">tổng dung lượng lakehouse</span>
      </div>

      <div className="h-6 rounded-full bg-border overflow-hidden flex" role="img" aria-label="Tỉ lệ dung lượng S3 raw so với S3 curated">
        <div
          className="h-full bg-accent transition-[width]"
          style={{ width: `${rawPct}%`, opacity: hasData ? 1 : 0.3 }}
          title={`S3 raw: ${formatBytes(rawStorage.sizeBytes)}`}
        />
        <div className="w-[2px] shrink-0" />
        <div
          className="h-full bg-secondary transition-[width]"
          style={{ width: `${curatedPct}%`, opacity: hasData ? 1 : 0.3 }}
          title={`S3 curated: ${formatBytes(curatedStorage.sizeBytes)}`}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        {ZONES.map((zone) => (
          <div key={zone.key} className="flex flex-col gap-1">
            <span className="flex items-center gap-1.5 text-[11px] text-textSecondary">
              <span className={`w-2 h-2 rounded-full ${zone.swatch}`} />
              {zone.label}
            </span>
            <span className="font-mono tabular-nums text-sm text-textPrimary">
              {formatBytes(stats[zone.key].sizeBytes)}
            </span>
            <span className="font-mono tabular-nums text-[10.5px] text-textMuted">
              {stats[zone.key].objectCount === null ? "—" : `${stats[zone.key].objectCount} object`}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
