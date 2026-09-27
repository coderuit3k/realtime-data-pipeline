import type { ActivityItem } from "@/lib/types";

export function ActivityFeed({ items }: { items: ActivityItem[] }) {
  return (
    <div className="rounded-lg border border-border bg-surface/75 backdrop-blur-md p-6 flex flex-col gap-3">
      <span className="text-sm font-semibold text-textPrimary">Hoạt động gần đây</span>
      {items.length === 0 && <span className="text-xs text-textMuted">Chưa có bản ghi hôm nay.</span>}
      {items.map((item, i) => (
        <div key={i} className="flex gap-2 items-center text-xs text-textSecondary">
          {item.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={item.imageUrl}
              alt=""
              className="w-5 h-5 rounded-full shrink-0 object-cover"
              loading="lazy"
              onError={(e) => {
                e.currentTarget.style.display = "none";
              }}
            />
          ) : (
            <span className="w-2 h-2 rounded-full bg-accent flex-shrink-0" />
          )}
          <span>
            <span className="text-textMuted">[{item.source}]</span> {item.label}
          </span>
        </div>
      ))}
    </div>
  );
}
