"use client";

import { useEffect, useState } from "react";
import type { OpsResponse, CostResponse } from "@/lib/types";
import { relativeTime } from "@/lib/time";
import { KpiCard } from "@/components/KpiCard";
import { LiveBadge } from "@/components/LiveBadge";
import { LogPanel } from "@/components/LogPanel";
import { RankRow } from "@/components/RankRow";
import { CardIcon, SectionCard } from "@/components/SectionCard";

const ROW_GRID = "grid grid-cols-2 gap-x-4 gap-y-1.5 md:grid-cols-[2fr_1fr_1.2fr_0.6fr_0.9fr] md:items-center";

/**
 * Lambda health, schedule, alarms, logs and cost. Not linked from the sidebar
 * (the dashboard covers it) but still reachable by URL. Cost is fetched
 * separately so a failing Cost Explorer call never blocks the page.
 */
export default function OpsPage() {
  const [data, setData] = useState<OpsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cost, setCost] = useState<CostResponse | null>(null);

  async function load() {
    setError(null);
    try {
      const res = await fetch("/api/ops");
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Không tải được Ops.");
      setData(body);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không tải được Ops.");
    }
  }

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    fetch("/api/cost")
      .then((res) => res.json().then((body) => ({ ok: res.ok, body })))
      .then(({ ok, body }) => {
        if (ok && typeof body?.monthToDateCostUsd === "number") setCost(body);
      })
      .catch(() => {
        /* secondary: the cost card just shows "—" */
      });
  }, []);

  if (error) {
    return (
      <div className="p-9 flex flex-col gap-4">
        <p className="text-error text-sm">{error}</p>
        <button onClick={load} className="w-fit rounded-lg border border-border px-4 py-2 text-sm text-textPrimary">
          Thử lại
        </button>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="p-6 lg:p-9 flex flex-col gap-4">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-28 rounded-xl border border-border bg-surface animate-pulse" />
          ))}
        </div>
        <div className="h-64 rounded-xl border border-border bg-surface animate-pulse" />
      </div>
    );
  }

  const okCount = data.lambdaHealth.filter((r) => r.status === "ok").length;
  const maxCost = Math.max(1, ...data.costBreakdown.map((c) => c.monthlyUsd));
  const breaching = data.alarmsBreaching > 0;

  return (
    <div className="p-6 lg:p-9 flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="font-heading text-3xl font-semibold tracking-tight text-textPrimary">Ops &amp; Monitoring</h1>
        <p className="text-[13px] text-textMuted">
          {data.lambdaHealth.length} Lambda · EventBridge {data.schedule.scheduleExpression} · {data.alarmsTotal} CloudWatch alarm
        </p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          label="Lambda functions"
          value={`${okCount} / ${data.lambdaHealth.length}`}
          hint={okCount === data.lambdaHealth.length ? "tất cả đang OK" : "có Lambda chưa OK"}
          hintColor={okCount === data.lambdaHealth.length ? "success" : "error"}
          icon={<CardIcon d="M13 2 3 14h8l-1 8 10-12h-8l1-8z" />}
        />
        <KpiCard
          label="EventBridge schedule"
          value={data.schedule.scheduleExpression}
          hint={data.schedule.enabled ? "ENABLED" : "DISABLED"}
          hintColor={data.schedule.enabled ? "success" : "error"}
          icon={<CardIcon d={["M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z", "M12 7v5l3.5 2"]} />}
        />
        <KpiCard
          label="CloudWatch alarms"
          value={`${data.alarmsBreaching} / ${data.alarmsTotal}`}
          hint={breaching ? "đang có cảnh báo vượt ngưỡng" : "tất cả đều ổn"}
          hintColor={breaching ? "error" : "success"}
          icon={<CardIcon d={["M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9", "M13.7 21a2 2 0 0 1-3.4 0"]} />}
        />
        <KpiCard
          label="Chi phí tháng này"
          value={cost ? `$${cost.monthToDateCostUsd.toFixed(2)}` : "—"}
          hint="đến hôm nay"
          icon={<CardIcon d={["M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z", "M12 6.5v1M12 16v1"]} />}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1.6fr_1fr] gap-4 items-start">
        <SectionCard title="Lambda health" meta="24 giờ qua" icon={<CardIcon d="M13 2 3 14h8l-1 8 10-12h-8l1-8z" />}>
          <div className="flex flex-col">
            <div className={`${ROW_GRID} hidden border-b border-border pb-2 text-[12px] text-textMuted md:grid`}>
              <span>Function</span>
              <span>Trạng thái</span>
              <span>Lần chạy cuối</span>
              <span>Lỗi 24h</span>
              <span>Thời lượng TB</span>
            </div>
            {data.lambdaHealth.map((row) => (
              <div key={row.functionLabel} className={`${ROW_GRID} border-b border-border py-3 last:border-b-0`}>
                <span className="col-span-2 text-[13px] font-semibold text-textPrimary md:col-span-1">{row.functionLabel}</span>
                <LiveBadge status={row.status} />
                <span className="text-[12px] text-textSecondary">
                  <span className="text-textMuted md:hidden">Chạy cuối: </span>
                  {relativeTime(row.lastInvocationAt, new Date(), { maxUnit: "hours" })}
                </span>
                <span className={`text-[12px] tabular-nums ${row.errors24h > 0 ? "font-semibold text-error" : "text-textSecondary"}`}>
                  <span className="font-normal text-textMuted md:hidden">Lỗi: </span>
                  {row.errors24h}
                </span>
                <span className="text-[12px] tabular-nums text-textSecondary">
                  <span className="text-textMuted md:hidden">TB: </span>
                  {row.avgDurationMs === null ? "—" : `${row.avgDurationMs}ms`}
                </span>
              </div>
            ))}
          </div>
        </SectionCard>

        <div className="flex flex-col gap-4">
          <LogPanel logs={data.recentLogs} />

          <SectionCard title="Chi phí theo hạng mục" icon={<CardIcon d={["M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z", "M12 6.5v1M12 16v1"]} />}>
            <div className="flex flex-col gap-3">
              {data.costBreakdown.map((c) => (
                <RankRow
                  key={c.category}
                  label={c.category}
                  value={c.monthlyUsd}
                  max={maxCost}
                  display={`$${c.monthlyUsd.toFixed(2)}`}
                  labelWidth="w-28"
                />
              ))}
            </div>
            <span className="text-[11.5px] text-textMuted">
              3 hạng mục có giá cụ thể nhất -- không phải tổng đầy đủ, xem infra/README.md
            </span>
          </SectionCard>
        </div>
      </div>
    </div>
  );
}
