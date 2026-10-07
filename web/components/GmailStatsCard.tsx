import type { GmailStats } from "@/lib/types";
import { CardIcon, SectionCard } from "./SectionCard";
import { RankRow } from "./RankRow";

const CATEGORY_LABELS: Record<keyof GmailStats["byCategory"], string> = {
  newsletter: "Bản tin",
  notification: "Thông báo",
  personal: "Cá nhân",
  recruiting: "Tuyển dụng",
  other: "Khác",
};

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-border bg-bg/70 px-3.5 py-3">
      <span className="text-[11.5px] text-textSecondary">{label}</span>
      <span className="text-2xl font-semibold tabular-nums text-textPrimary">{value}</span>
    </div>
  );
}

/** Aggregate mailbox numbers only (counts per day and category): nothing from any email's text. */
export function GmailStatsCard({
  stats,
  loading,
  error,
}: {
  stats: GmailStats | null;
  loading: boolean;
  error: boolean;
}) {
  const icon = <CardIcon d={["M4 6h16v12H4z", "M4 7l8 6 8-6"]} />;

  if (loading || error || !stats) {
    const message = loading
      ? "Đang tải thống kê hộp thư…"
      : error
        ? "Không tải được thống kê hộp thư."
        : "Chưa có thống kê hộp thư.";
    return (
      <SectionCard className="lg:col-span-3" title="Hộp thư Gmail" icon={icon}>
        <span className="text-[12.5px] text-textMuted">{message}</span>
      </SectionCard>
    );
  }

  const maxDay = Math.max(1, ...stats.perDay.map((d) => d.total));
  const maxCategory = Math.max(1, ...Object.values(stats.byCategory));

  return (
    <SectionCard
      className="lg:col-span-3"
      title="Hộp thư Gmail"
      meta={`${stats.windowDays} ngày gần nhất`}
      icon={icon}
    >
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="Email" value={stats.totals.emails} />
        <Stat label="Cần trả lời" value={stats.totals.needsReply} />
        <Stat label="Khẩn" value={stats.totals.urgent} />
        <Stat label="Có hạn chót" value={stats.totals.withDeadline} />
        <Stat label="Chưa phân loại" value={stats.totals.unclassified} />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="flex flex-col gap-2">
          <span className="text-[11.5px] text-textSecondary">Email mỗi ngày</span>
          <div className="flex h-28 items-end gap-1" role="img" aria-label="Số email mỗi ngày">
            {stats.perDay.map((d) => (
              <div key={d.date} className="flex h-full flex-1 flex-col justify-end" title={`${d.date}: ${d.total}`}>
                <div
                  className="w-full rounded-sm bg-accent/70"
                  style={{ height: `${Math.max(d.total > 0 ? 4 : 1, (d.total / maxDay) * 100)}%` }}
                />
              </div>
            ))}
          </div>
          <div className="flex justify-between text-[10.5px] text-textMuted">
            <span>{stats.perDay[0]?.date.slice(5)}</span>
            <span>{stats.perDay[stats.perDay.length - 1]?.date.slice(5)}</span>
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <span className="text-[11.5px] text-textSecondary">Theo loại</span>
          {(Object.keys(CATEGORY_LABELS) as (keyof typeof CATEGORY_LABELS)[]).map((key) => (
            <RankRow
              key={key}
              label={CATEGORY_LABELS[key]}
              value={stats.byCategory[key]}
              max={maxCategory}
              display={String(stats.byCategory[key])}
              labelWidth="w-24"
            />
          ))}
        </div>
      </div>
    </SectionCard>
  );
}
