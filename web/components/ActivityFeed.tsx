import type { ActivityItem } from "@/lib/types";
import { CardIcon, SectionCard } from "./SectionCard";

/**
 * Today's most recent ingested records, one line per item. Thumbnails come
 * from third-party URLs, so a broken one hides itself instead of showing a
 * broken-image icon.
 */
export function ActivityFeed({ items }: { items: ActivityItem[] }) {
  return (
    <SectionCard title="Hoạt động gần đây" icon={<CardIcon d="M12 7v5l3.5 2M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z" />}>
      {items.length === 0 && <span className="text-xs text-textMuted">Chưa có bản ghi hôm nay.</span>}
      {items.map((item, i) => (
        <div key={i} className="flex items-center gap-2.5 text-[12.5px] text-textSecondary">
          {item.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={item.imageUrl}
              alt=""
              className="h-6 w-6 shrink-0 rounded-full object-cover"
              loading="lazy"
              onError={(e) => {
                e.currentTarget.style.display = "none";
              }}
            />
          ) : (
            <span className="w-2 h-2 rounded-full bg-accent flex-shrink-0" />
          )}
          <span className="min-w-0 truncate" title={item.label}>
            <span className="text-textMuted">{item.source}</span> · {item.label}
          </span>
        </div>
      ))}
    </SectionCard>
  );
}
