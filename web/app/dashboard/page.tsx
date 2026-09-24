"use client";

import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { KpiCard } from "@/components/KpiCard";
import { SourceVolumeChart } from "@/components/SourceVolumeChart";
import { ActivityFeed } from "@/components/ActivityFeed";
import { LiveBadge } from "@/components/LiveBadge";
import type { DashboardResponse, CostResponse } from "@/lib/types";

// sourceId matches lib/settingsMeta.ts's DATA_SOURCES ids and
// lib/athena.ts's buildSourceVolumeQuery source values. lambdaLabel
// matches lib/opsMeta.ts's PIPELINE_LAMBDAS labels -- NOT a
// `${sourceId}_ingestion` string pattern, since github's real label is
// "github_trending_ingestion", not "github_ingestion".
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

function relativeTime(iso: string | null, now: Date = new Date()): string {
  if (!iso) return "chưa có dữ liệu";
  const diffMs = now.getTime() - new Date(iso).getTime();
  const minutes = Math.max(0, Math.round(diffMs / 60000));
  if (minutes < 1) return "vừa xong";
  if (minutes < 60) return `${minutes} phút trước`;
  const hours = Math.round(minutes / 60);
  return `${hours} giờ trước`;
}

function detectLogLevel(message: string): "ERROR" | "WARN" | "INFO" {
  const match = message.match(/\b(ERROR|WARN(?:ING)?|INFO)\b/);
  if (!match) return "INFO";
  return match[1] === "WARNING" ? "WARN" : (match[1] as "ERROR" | "WARN" | "INFO");
}

function logLevelColor(level: "ERROR" | "WARN" | "INFO"): string {
  if (level === "ERROR") return "text-error";
  if (level === "WARN") return "text-warning";
  return "text-accent";
}

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
        /* cost is secondary -- never block the page over it */
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
      <div className="p-9 grid grid-cols-3 gap-4">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-24 rounded-lg border border-border bg-surface/75 backdrop-blur-md animate-pulse" />
        ))}
      </div>
    );
  }

  const avgLatencyMs = (() => {
    const withDuration = data.lambdaHealth.filter((r) => r.avgDurationMs !== null);
    if (withDuration.length === 0) return null;
    return Math.round(withDuration.reduce((sum, r) => sum + (r.avgDurationMs ?? 0), 0) / withDuration.length);
  })();

  const healthBySource = new Map(data.lambdaHealth.map((r) => [r.functionLabel, r]));
  const volumeBySource = new Map(data.sourceVolumes.map((s) => [s.source, s.records]));
  const maxCost = Math.max(1, ...data.costBreakdown.map((c) => c.monthlyUsd));

  return (
    <div className="p-9 flex flex-col gap-5">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-textPrimary">Live Metrics & Ops</h1>
        <p className="mt-1.5 text-sm text-textSecondary">
          {data.sourcesHealthy}/{data.sourcesTotal} nguồn OK · EventBridge {data.schedule.scheduleExpression}{" "}
          <span className={data.schedule.enabled ? "text-success" : "text-error"}>
            {data.schedule.enabled ? "ENABLED" : "DISABLED"}
          </span>{" "}
          · {data.alarmsTotal} CloudWatch alarm
        </p>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <KpiCard
          label="Bản ghi hôm nay"
          value={String(data.recordsToday)}
          icon={
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
              <path d="M2 12h4l2.5-7 4 14 2.5-7H22" />
            </svg>
          }
        />
        <KpiCard
          label="Độ trễ trung bình"
          value={avgLatencyMs === null ? "—" : `${avgLatencyMs}ms`}
          hint="6 Lambda, 24h"
          icon={
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="9" />
              <path d="M12 7v5l3.5 2" />
            </svg>
          }
        />
        <KpiCard
          label="Chi phí tháng này"
          value={cost ? `$${cost.monthToDateCostUsd.toFixed(2)}` : "—"}
          hint="đến hôm nay"
          icon={
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="9" />
              <path d="M14.5 9.5c0-1.1-1.1-2-2.5-2s-2.5.8-2.5 1.9c0 2.6 5 1.4 5 4 0 1.1-1.1 1.9-2.5 1.9s-2.5-.9-2.5-2" />
              <path d="M12 6.5v1M12 16v1" />
            </svg>
          }
        />
      </div>

      <div className="grid grid-cols-[1.4fr_1fr] gap-4">
        <SourceVolumeChart sourceVolumes={data.sourceVolumes} />
        <ActivityFeed items={data.recentActivity} />
      </div>

      <div className="rounded-lg border border-border bg-surface/75 backdrop-blur-md px-5 py-4 flex flex-col gap-3">
        <span className="text-[13px] font-semibold text-textPrimary">Realtime Ingestion Streams (5 nguồn dị chủng)</span>
        <span className="text-[10.5px] text-textMuted">
          ● OK nghĩa là Lambda chạy không lỗi -- một nguồn có thể OK nhưng ghi 0 bản ghi hôm nay nếu không có dữ liệu mới.
        </span>
        <div className="grid grid-cols-5 gap-3">
          {SOURCES.map(({ sourceId, label, lambdaLabel, icon }) => {
            const health = healthBySource.get(lambdaLabel);
            const records = volumeBySource.get(sourceId) ?? 0;
            return (
              <div
                key={sourceId}
                className="rounded-lg border border-border bg-surfaceHigh px-3 py-3 flex flex-col gap-1.5 transition-transform hover:scale-[1.01]"
              >
                <span className="flex items-center gap-1.5 text-xs font-semibold text-textPrimary">
                  <span className="text-textSecondary">{icon}</span>
                  {label}
                </span>
                <LiveBadge status={health?.status ?? "idle"} />
                <span className="font-mono tabular-nums text-[11px] text-textSecondary">{records} bản ghi hôm nay</span>
                <span className="font-mono tabular-nums text-[10.5px] text-textMuted">
                  {health?.avgDurationMs === null || health?.avgDurationMs === undefined ? "—" : `${health.avgDurationMs}ms`} ·{" "}
                  {relativeTime(health?.lastInvocationAt ?? null)}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="rounded-lg border border-border bg-surface/75 backdrop-blur-md px-5 py-4 flex flex-col gap-3">
          <span className="text-[13px] font-semibold text-textPrimary">Lakehouse Storage</span>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <span className="text-[11px] text-textSecondary">S3 raw</span>
              <span className="font-mono tabular-nums text-sm text-textPrimary">{formatBytes(data.rawStorage.sizeBytes)}</span>
              <span className="font-mono tabular-nums text-[10.5px] text-textMuted">
                {data.rawStorage.objectCount === null ? "—" : `${data.rawStorage.objectCount} object`}
              </span>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-[11px] text-textSecondary">S3 curated</span>
              <span className="font-mono tabular-nums text-sm text-textPrimary">{formatBytes(data.curatedStorage.sizeBytes)}</span>
              <span className="font-mono tabular-nums text-[10.5px] text-textMuted">
                {data.curatedStorage.objectCount === null ? "—" : `${data.curatedStorage.objectCount} object`}
              </span>
            </div>
          </div>
          <div className="flex flex-col gap-1 pt-1 border-t border-border">
            <span className="text-[11px] text-textSecondary">Athena avg query time (24h)</span>
            <span className="font-mono tabular-nums text-sm text-textPrimary">
              {data.athenaAvgQueryMs === null ? "chưa có query trong 24h" : `${data.athenaAvgQueryMs}ms`}
            </span>
          </div>
          <div className="flex flex-col gap-1 pt-1 border-t border-border">
            <span className="text-[11px] text-textSecondary">Partition projection</span>
            <span className="font-mono text-[10.5px] text-textMuted">
              year/month/day, integer projection (Glue Catalog, infra/glue.tf)
            </span>
          </div>
        </div>

        <div className="flex flex-col gap-4">
          <div className="rounded-lg border-t-2 border-t-warning border border-border bg-surface/75 backdrop-blur-md px-5 py-4 flex flex-col gap-2">
            <span className="text-[13px] font-semibold text-textPrimary">CloudWatch Alarms</span>
            <span className="font-mono tabular-nums text-xl text-textPrimary">
              {data.alarmsBreaching} / {data.alarmsTotal} <span className="text-xs text-textMuted">breaching</span>
            </span>
          </div>
          <div className="rounded-lg border border-border bg-surface/75 backdrop-blur-md px-5 py-4 flex flex-col gap-2 min-h-0 overflow-auto">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-error/70" />
                <span className="w-2.5 h-2.5 rounded-full bg-warning/70" />
                <span className="w-2.5 h-2.5 rounded-full bg-success/70" />
                <span className="ml-1 text-xs font-semibold text-textPrimary">Log gần đây</span>
              </div>
              <LiveBadge status="ok" label="LIVE" />
            </div>
            <div className="font-mono flex flex-col gap-1.5 text-[10.5px] text-textMuted">
              {data.recentLogs.length === 0 && <span>Chưa có log trong 24h qua.</span>}
              {data.recentLogs.map((log, i) => {
                const level = detectLogLevel(log.message);
                return (
                  <span key={i} className="break-all">
                    <span className={logLevelColor(level)}>{level}</span> {log.source}: {log.message}
                  </span>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="rounded-lg border border-border bg-surface/75 backdrop-blur-md px-5 py-4 flex flex-col gap-2.5">
          <span className="text-xs font-semibold text-textPrimary">Chi phí theo hạng mục</span>
          <div className="flex flex-col gap-2">
            {data.costBreakdown.map((c) => (
              <div key={c.category} className="flex items-center gap-2">
                <span className="w-[110px] text-[11px] text-textSecondary">{c.category}</span>
                <div className="flex-grow h-1.5 rounded bg-border">
                  <div className="h-full rounded bg-gradient-to-r from-accent to-accentBright" style={{ width: `${(c.monthlyUsd / maxCost) * 100}%` }} />
                </div>
                <span className="font-mono tabular-nums text-[10.5px] text-textMuted">${c.monthlyUsd.toFixed(2)}</span>
              </div>
            ))}
          </div>
          <span className="text-[10.5px] text-textMuted">
            4 hạng mục có giá cụ thể nhất -- ước tính tĩnh/tháng từ infra/README.md, không phải số liệu Cost Explorer theo thời gian thực. Xem infra/README.md.
          </span>
        </div>

        <div className="rounded-lg border border-border bg-surface/75 backdrop-blur-md px-5 py-4 flex flex-col gap-2.5">
          <span className="text-xs font-semibold text-textPrimary">Liên kết nhanh</span>
          <div className="flex flex-col gap-2">
            <a
              href="https://console.aws.amazon.com/cloudwatch/home#alarmsV2:"
              target="_blank"
              rel="noreferrer"
              className="text-[12px] text-accent transition-colors hover:text-accentBright"
            >
              CloudWatch Alarms Console →
            </a>
            <a
              href="https://console.aws.amazon.com/athena/home#/query-editor"
              target="_blank"
              rel="noreferrer"
              className="text-[12px] text-accent transition-colors hover:text-accentBright"
            >
              Athena Query Editor →
            </a>
            <a
              href="https://github.com/coderuit3k/realtime-data-pipeline/actions"
              target="_blank"
              rel="noreferrer"
              className="text-[12px] text-accent transition-colors hover:text-accentBright"
            >
              GitHub Actions →
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
