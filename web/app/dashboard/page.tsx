"use client";

import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { KpiCard } from "@/components/KpiCard";
import { SourceVolumeChart } from "@/components/SourceVolumeChart";
import { ActivityFeed } from "@/components/ActivityFeed";
import { LiveBadge } from "@/components/LiveBadge";
import { LakehouseStorageChart } from "@/components/LakehouseStorageChart";
import { LogPanel } from "@/components/LogPanel";
import { RankRow } from "@/components/RankRow";
import { CardIcon, SectionCard } from "@/components/SectionCard";
import { relativeTime } from "@/lib/time";
import type { DashboardResponse, CostResponse } from "@/lib/types";

// sourceId must match the source values returned by the Athena volume query;
// lambdaLabel must match PIPELINE_LAMBDAS in lib/opsMeta.ts. lambdaLabel is
// spelled out rather than derived as `${sourceId}_ingestion` because GitHub's
// Lambda is "github_trending_ingestion".
const SOURCES: { sourceId: string; label: string; lambdaLabel: string; icon: ReactNode }[] = [
  {
    sourceId: "hackernews",
    label: "Hacker News",
    lambdaLabel: "hackernews_ingestion",
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
        <path d="M8 3h6l4 4v13a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" />
        <path d="M14 3v4h4" />
      </svg>
    ),
  },
  {
    sourceId: "news",
    label: "News API",
    lambdaLabel: "news_ingestion",
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="5" width="18" height="14" rx="1.5" />
        <path d="M7 9h10M7 12.5h10M7 16h6" />
      </svg>
    ),
  },
  {
    sourceId: "weather",
    label: "Weather",
    lambdaLabel: "weather_ingestion",
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
        <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" />
      </svg>
    ),
  },
  {
    sourceId: "crypto",
    label: "Crypto",
    lambdaLabel: "crypto_ingestion",
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="9" />
        <path d="M14.5 9.5c0-1.1-1.1-2-2.5-2s-2.5.8-2.5 1.9c0 2.6 5 1.4 5 4 0 1.1-1.1 1.9-2.5 1.9s-2.5-.9-2.5-2" />
        <path d="M12 6.5v1M12 16v1" />
      </svg>
    ),
  },
  {
    sourceId: "github",
    label: "GitHub Trending",
    lambdaLabel: "github_trending_ingestion",
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
        <line x1="6" y1="3" x2="6" y2="15" />
        <circle cx="18" cy="6" r="3" />
        <circle cx="6" cy="18" r="3" />
        <path d="M18 9a9 9 0 0 1-9 9" />
      </svg>
    ),
  },
];

/**
 * Live metrics from /api/dashboard. Month-to-date cost comes from a separate
 * /api/cost call so a slow or failing Cost Explorer never blocks the page.
 */
export default function DashboardPage() {
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cost, setCost] = useState<CostResponse | null>(null);

  async function load() {
    setError(null);
    try {
      const res = await fetch("/api/dashboard");
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Không tải được dashboard.");
      setData(body);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không tải được dashboard.");
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
        /* secondary: the KPI card just shows "—" */
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
            <div key={i} className="h-28 rounded-xl border border-border bg-surface/75 animate-pulse" />
          ))}
        </div>
        <div className="h-64 rounded-xl border border-border bg-surface/75 animate-pulse" />
      </div>
    );
  }

  // Average only over Lambdas that actually ran; idle ones have no duration.
  const avgLatencyMs = (() => {
    const withDuration = data.lambdaHealth.filter((r) => r.avgDurationMs !== null);
    if (withDuration.length === 0) return null;
    return Math.round(withDuration.reduce((sum, r) => sum + (r.avgDurationMs ?? 0), 0) / withDuration.length);
  })();

  const healthBySource = new Map(data.lambdaHealth.map((r) => [r.functionLabel, r]));
  const volumeBySource = new Map(data.sourceVolumes.map((s) => [s.source, s.records]));
  const maxVolume = Math.max(1, ...data.sourceVolumes.map((s) => s.records));
  const maxCost = Math.max(1, ...data.costBreakdown.map((c) => c.monthlyUsd));
  const breaching = data.alarmsBreaching > 0;

  return (
    <div className="p-6 lg:p-9 flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="font-heading text-3xl font-semibold tracking-tight text-textPrimary">Live Metrics & Ops</h1>
        <p className="text-[13px] text-textMuted">Sức khoẻ pipeline, khối lượng dữ liệu và chi phí đang chạy thật trên AWS.</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          label="Bản ghi hôm nay"
          value={String(data.recordsToday)}
          icon={<CardIcon d="M2 12h4l2.5-7 4 14 2.5-7H22" />}
        />
        <KpiCard
          label="Độ trễ trung bình"
          value={avgLatencyMs === null ? "—" : `${avgLatencyMs}ms`}
          hint="6 Lambda, 24h"
          icon={<CardIcon d={["M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z", "M12 7v5l3.5 2"]} />}
        />
        <KpiCard
          label="Chi phí tháng này"
          value={cost ? `$${cost.monthToDateCostUsd.toFixed(2)}` : "—"}
          hint="đến hôm nay"
          icon={<CardIcon d={["M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z", "M12 6.5v1M12 16v1"]} />}
        />
        <KpiCard
          label="Cảnh báo CloudWatch"
          value={`${data.alarmsBreaching} / ${data.alarmsTotal}`}
          hint={breaching ? "đang có cảnh báo vượt ngưỡng" : "tất cả đều ổn"}
          hintColor={breaching ? "error" : "success"}
          icon={<CardIcon d={["M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9", "M13.7 21a2 2 0 0 1-3.4 0"]} />}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <SourceVolumeChart className="lg:col-span-2" sourceVolumes={data.sourceVolumes} />
        <ActivityFeed items={data.recentActivity} />
      </div>

      <SectionCard
        title="Realtime Ingestion Streams"
        meta={`${SOURCES.length} nguồn dị chủng`}
        icon={<CardIcon d="M13 2 3 14h8l-1 8 10-12h-8l1-8z" />}
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          {SOURCES.map(({ sourceId, label, lambdaLabel, icon }) => {
            const health = healthBySource.get(lambdaLabel);
            const records = volumeBySource.get(sourceId) ?? 0;
            return (
              <div
                key={sourceId}
                className="flex flex-col gap-2 rounded-lg border border-border bg-bg/60 p-4 transition-colors hover:border-accent/30"
              >
                <span className="flex items-center gap-2 text-[13px] font-semibold text-textPrimary">
                  <span className="text-textSecondary">{icon}</span>
                  {label}
                </span>
                <LiveBadge status={health?.status ?? "idle"} />
                <span className="mt-1 text-2xl font-semibold tabular-nums text-textPrimary">{records}</span>
                <span className="-mt-1.5 text-[11.5px] text-textMuted">bản ghi hôm nay</span>
                <div className="h-1 rounded-full bg-white/[0.05]">
                  <div
                    className="bar-grow h-full rounded-full bg-accent/70"
                    style={{ width: `${Math.max(2, (records / maxVolume) * 100)}%` }}
                  />
                </div>
                <span className="text-[11.5px] tabular-nums text-textMuted">
                  {health?.avgDurationMs === null || health?.avgDurationMs === undefined ? "—" : `${health.avgDurationMs}ms`} ·{" "}
                  {relativeTime(health?.lastInvocationAt ?? null, new Date(), { maxUnit: "hours" })}
                </span>
              </div>
            );
          })}
        </div>
      </SectionCard>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <SectionCard title="Lakehouse Storage" icon={<CardIcon d={["M3 5a9 3 0 1 0 18 0 9 3 0 1 0-18 0", "M3 5v14a9 3 0 0 0 18 0V5", "M3 12a9 3 0 0 0 18 0"]} />}>
          <LakehouseStorageChart rawStorage={data.rawStorage} curatedStorage={data.curatedStorage} />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 border-t border-border pt-4">
            <div className="flex flex-col gap-1">
              <span className="text-[11.5px] text-textSecondary">Athena avg query time (24h)</span>
              <span className="text-sm font-semibold tabular-nums text-textPrimary">
                {data.athenaAvgQueryMs === null ? "chưa có query trong 24h" : `${data.athenaAvgQueryMs}ms`}
              </span>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-[11.5px] text-textSecondary">Partition projection</span>
              <span className="text-[11.5px] text-textMuted">year/month/day, integer projection (Glue Catalog, infra/glue.tf)</span>
            </div>
          </div>
        </SectionCard>

        <LogPanel logs={data.recentLogs} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
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
        </SectionCard>

        <SectionCard title="Liên kết nhanh" icon={<CardIcon d={["M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7", "M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"]} />}>
          <div className="flex flex-col gap-2">
            {[
              ["CloudWatch Alarms Console", "https://console.aws.amazon.com/cloudwatch/home#alarmsV2:"],
              ["Athena Query Editor", "https://console.aws.amazon.com/athena/home#/query-editor"],
              ["GitHub Actions", "https://github.com/coderuit3k/realtime-data-pipeline/actions"],
            ].map(([text, href]) => (
              <a
                key={href}
                href={href}
                target="_blank"
                rel="noreferrer"
                className="flex items-center justify-between rounded-lg border border-border bg-bg/60 px-4 py-3 text-[13px] text-textPrimary transition-colors hover:border-accent/40 hover:text-accentBright focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
              >
                {text}
                <CardIcon d="M7 17 17 7M8 7h9v9" />
              </a>
            ))}
          </div>
        </SectionCard>
      </div>
    </div>
  );
}
