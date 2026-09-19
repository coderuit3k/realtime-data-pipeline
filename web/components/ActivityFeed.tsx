import type { ActivityItem } from "@/lib/types";

export function ActivityFeed({ items }: { items: ActivityItem[] }) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-6 flex flex-col gap-3">
      <span className="text-sm font-semibold text-textPrimary">Hoạt động gần đây</span>
      {items.length === 0 && <span className="text-xs text-textMuted">Chưa có bản ghi hôm nay.</span>}
      {items.map((item, i) => (
        <div key={i} className="flex gap-2 items-start text-xs text-textSecondary">
          <span className="w-2 h-2 mt-1 rounded-full bg-accent flex-shrink-0" />
          <span>
            <span className="text-textMuted">[{item.source}]</span> {item.label}
          </span>
        </div>
      ))}
    </div>
  );
}
