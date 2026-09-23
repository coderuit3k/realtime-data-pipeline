"use client";

import { useEffect, useState } from "react";
import { KpiCard } from "@/components/KpiCard";
import { SourceVolumeChart } from "@/components/SourceVolumeChart";
import { ActivityFeed } from "@/components/ActivityFeed";
import type { DashboardResponse, CostResponse } from "@/lib/types";

// sourceId matches lib/settingsMeta.ts's DATA_SOURCES ids and
// lib/athena.ts's buildSourceVolumeQuery source values. lambdaLabel
// matches lib/opsMeta.ts's PIPELINE_LAMBDAS labels -- NOT a
// `${sourceId}_ingestion` string pattern, since github's real label is
// "github_trending_ingestion", not "github_ingestion".
const SOURCES: { sourceId: string; label: string; lambdaLabel: string }[] = [
  { sourceId: "hackernews", label: "Hacker News", lambdaLabel: "hackernews_ingestion" },
  { sourceId: "news", label: "News API", lambdaLabel: "news_ingestion" },
  { sourceId: "weather", label: "Weather", lambdaLabel: "weather_ingestion" },
  { sourceId: "crypto", label: "Crypto", lambdaLabel: "crypto_ingestion" },
  { sourceId: "github", label: "GitHub Trending", lambdaLabel: "github_trending_ingestion" },
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

function statusColor(status: string): string {
  if (status === "ok") return "text-success";
  if (status === "error") return "text-error";
  return "text-textMuted";
}

function statusLabel(status: string): string {
  if (status === "ok") return "● OK";
  if (status === "error") return "● Lỗi";
  return "● Chưa chạy";
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
          <div key={i} className="h-24 rounded-lg border border-border bg-surface animate-pulse" />
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
        <KpiCard label="Bản ghi hôm nay" value={String(data.recordsToday)} />
        <KpiCard
          label="Độ trễ trung bình"
          value={avgLatencyMs === null ? "—" : `${avgLatencyMs}ms`}
          hint="6 Lambda, 24h"
        />
        <KpiCard label="Chi phí tháng này" value={cost ? `$${cost.monthToDateCostUsd.toFixed(2)}` : "—"} hint="đến hôm nay" />
      </div>

      <div className="grid grid-cols-[1.4fr_1fr] gap-4">
        <SourceVolumeChart sourceVolumes={data.sourceVolumes} />
        <ActivityFeed items={data.recentActivity} />
      </div>

      <div className="rounded-lg border border-border bg-surface px-5 py-4 flex flex-col gap-3">
        <span className="text-[13px] font-semibold text-textPrimary">Realtime Ingestion Streams (5 nguồn dị chủng)</span>
        <span className="text-[10.5px] text-textMuted">
          ● OK nghĩa là Lambda chạy không lỗi -- một nguồn có thể OK nhưng ghi 0 bản ghi hôm nay nếu không có dữ liệu mới.
        </span>
        <div className="grid grid-cols-5 gap-3">
          {SOURCES.map(({ sourceId, label, lambdaLabel }) => {
            const health = healthBySource.get(lambdaLabel);
            const records = volumeBySource.get(sourceId) ?? 0;
            return (
              <div key={sourceId} className="rounded-lg border border-border bg-bg px-3 py-3 flex flex-col gap-1.5">
                <span className="text-xs font-semibold text-textPrimary">{label}</span>
                <span className={`text-[11px] ${statusColor(health?.status ?? "idle")}`}>
                  {statusLabel(health?.status ?? "idle")}
                </span>
                <span className="font-mono text-[11px] text-textSecondary">{records} bản ghi hôm nay</span>
                <span className="font-mono text-[10.5px] text-textMuted">
                  {health?.avgDurationMs === null || health?.avgDurationMs === undefined ? "—" : `${health.avgDurationMs}ms`} ·{" "}
                  {relativeTime(health?.lastInvocationAt ?? null)}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="rounded-lg border border-border bg-surface px-5 py-4 flex flex-col gap-3">
          <span className="text-[13px] font-semibold text-textPrimary">Lakehouse Storage</span>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <span className="text-[11px] text-textSecondary">S3 raw</span>
              <span className="font-mono text-sm text-textPrimary">{formatBytes(data.rawStorage.sizeBytes)}</span>
              <span className="font-mono text-[10.5px] text-textMuted">
                {data.rawStorage.objectCount === null ? "—" : `${data.rawStorage.objectCount} object`}
              </span>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-[11px] text-textSecondary">S3 curated</span>
              <span className="font-mono text-sm text-textPrimary">{formatBytes(data.curatedStorage.sizeBytes)}</span>
              <span className="font-mono text-[10.5px] text-textMuted">
                {data.curatedStorage.objectCount === null ? "—" : `${data.curatedStorage.objectCount} object`}
              </span>
            </div>
          </div>
          <div className="flex flex-col gap-1 pt-1 border-t border-border">
            <span className="text-[11px] text-textSecondary">Athena avg query time (24h)</span>
            <span className="font-mono text-sm text-textPrimary">
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
          <div className="rounded-lg border border-border bg-surface px-5 py-4 flex flex-col gap-2">
            <span className="text-[13px] font-semibold text-textPrimary">CloudWatch Alarms</span>
            <span className="font-mono text-xl text-textPrimary">
              {data.alarmsBreaching} / {data.alarmsTotal} <span className="text-xs text-textMuted">breaching</span>
            </span>
          </div>
          <div className="rounded-lg border border-border bg-surface px-5 py-4 flex flex-col gap-2 min-h-0 overflow-auto">
            <span className="text-xs font-semibold text-textPrimary">Log gần đây</span>
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
        <div className="rounded-lg border border-border bg-surface px-5 py-4 flex flex-col gap-2.5">
          <span className="text-xs font-semibold text-textPrimary">Chi phí theo hạng mục</span>
          <div className="flex flex-col gap-2">
            {data.costBreakdown.map((c) => (
              <div key={c.category} className="flex items-center gap-2">
                <span className="w-[110px] text-[11px] text-textSecondary">{c.category}</span>
                <div className="flex-grow h-1.5 rounded bg-border">
                  <div className="h-full rounded bg-textMuted" style={{ width: `${(c.monthlyUsd / maxCost) * 100}%` }} />
                </div>
                <span className="font-mono text-[10.5px] text-textMuted">${c.monthlyUsd.toFixed(2)}</span>
              </div>
            ))}
          </div>
          <span className="text-[10.5px] text-textMuted">
            4 hạng mục có giá cụ thể nhất -- ước tính tĩnh/tháng từ infra/README.md, không phải số liệu Cost Explorer theo thời gian thực. Xem infra/README.md.
          </span>
        </div>

        <div className="rounded-lg border border-border bg-surface px-5 py-4 flex flex-col gap-2.5">
          <span className="text-xs font-semibold text-textPrimary">Liên kết nhanh</span>
          <div className="flex flex-col gap-2">
            <a
              href="https://console.aws.amazon.com/cloudwatch/home#alarmsV2:"
              target="_blank"
              rel="noreferrer"
              className="text-[12px] text-accent"
            >
              CloudWatch Alarms Console →
            </a>
            <a
              href="https://console.aws.amazon.com/athena/home#/query-editor"
              target="_blank"
              rel="noreferrer"
              className="text-[12px] text-accent"
            >
              Athena Query Editor →
            </a>
            <a
              href="https://github.com/coderuit3k/realtime-data-pipeline/actions"
              target="_blank"
              rel="noreferrer"
              className="text-[12px] text-accent"
            >
              GitHub Actions →
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
