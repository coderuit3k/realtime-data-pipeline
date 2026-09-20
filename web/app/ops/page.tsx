"use client";

import { useEffect, useState } from "react";
import type { OpsResponse } from "@/lib/types";

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
  const match = message.match(/\b(ERROR|WARN|INFO)\b/);
  return (match?.[1] as "ERROR" | "WARN" | "INFO") ?? "INFO";
}

function logLevelColor(level: "ERROR" | "WARN" | "INFO"): string {
  if (level === "ERROR") return "text-error";
  if (level === "WARN") return "text-warning";
  return "text-accent";
}

export default function OpsPage() {
  const [data, setData] = useState<OpsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

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
      <div className="p-9 grid grid-cols-4 gap-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-24 rounded-2xl border border-border bg-surface animate-pulse" />
        ))}
      </div>
    );
  }

  const okCount = data.lambdaHealth.filter((r) => r.status === "ok").length;
  const maxCost = Math.max(1, ...data.costBreakdown.map((c) => c.monthlyUsd));

  return (
    <div className="p-9 flex flex-col gap-5">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-textPrimary">Ops &amp; Monitoring</h1>
        <p className="mt-1.5 text-sm text-textSecondary">
          {data.lambdaHealth.length} Lambda · EventBridge {data.schedule.scheduleExpression} · {data.alarmsTotal} CloudWatch alarm
        </p>
      </div>

      <div className="grid grid-cols-4 gap-4">
        <div className="rounded-2xl border border-border bg-surface px-4 py-4 flex flex-col gap-2">
          <span className="text-[11.5px] text-textSecondary">Lambda functions</span>
          <span className="font-mono text-xl text-textPrimary">
            {okCount} / {data.lambdaHealth.length} <span className="text-xs text-success">OK</span>
          </span>
        </div>
        <div className="rounded-2xl border border-border bg-surface px-4 py-4 flex flex-col gap-2">
          <span className="text-[11.5px] text-textSecondary">EventBridge schedule</span>
          <span className="font-mono text-sm text-textPrimary">
            {data.schedule.scheduleExpression}{" "}
            <span className={`text-xs ${data.schedule.enabled ? "text-success" : "text-error"}`}>
              {data.schedule.enabled ? "ENABLED" : "DISABLED"}
            </span>
          </span>
        </div>
        <div className="rounded-2xl border border-border bg-surface px-4 py-4 flex flex-col gap-2">
          <span className="text-[11.5px] text-textSecondary">CloudWatch alarms</span>
          <span className="font-mono text-xl text-textPrimary">
            {data.alarmsBreaching} / {data.alarmsTotal} <span className="text-xs text-textMuted">breaching</span>
          </span>
        </div>
        <div className="rounded-2xl border border-border bg-surface px-4 py-4 flex flex-col gap-2">
          <span className="text-[11.5px] text-textSecondary">Chi phí ước tính / tháng</span>
          <span className="font-mono text-xl text-textPrimary">${data.costEstimateUsd.toFixed(2)}</span>
        </div>
      </div>

      <div className="flex gap-4 flex-grow min-h-0">
        <div className="flex-[1.6] rounded-2xl border border-border bg-surface px-5 py-5 flex flex-col gap-3 min-h-0 overflow-auto">
          <span className="text-[13px] font-semibold text-textPrimary">Lambda health</span>
          <table className="font-mono w-full border-collapse text-xs">
            <thead>
              <tr>
                <th className="text-left text-textSecondary text-[10.5px] uppercase border-b border-border py-2 px-2.5">Function</th>
                <th className="text-left text-textSecondary text-[10.5px] uppercase border-b border-border py-2 px-2.5">Trạng thái</th>
                <th className="text-left text-textSecondary text-[10.5px] uppercase border-b border-border py-2 px-2.5">Lần chạy cuối</th>
                <th className="text-left text-textSecondary text-[10.5px] uppercase border-b border-border py-2 px-2.5">Lỗi 24h</th>
                <th className="text-left text-textSecondary text-[10.5px] uppercase border-b border-border py-2 px-2.5">Thời lượng TB</th>
              </tr>
            </thead>
            <tbody>
              {data.lambdaHealth.map((row) => (
                <tr key={row.functionLabel}>
                  <td className="text-textSecondary border-b border-border py-2 px-2.5">{row.functionLabel}</td>
                  <td className={`border-b border-border py-2 px-2.5 ${statusColor(row.status)}`}>{statusLabel(row.status)}</td>
                  <td className="text-textSecondary border-b border-border py-2 px-2.5">{relativeTime(row.lastInvocationAt)}</td>
                  <td className="text-textSecondary border-b border-border py-2 px-2.5">{row.errors24h}</td>
                  <td className="text-textSecondary border-b border-border py-2 px-2.5">
                    {row.avgDurationMs === null ? "—" : `${row.avgDurationMs}ms`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex-1 flex flex-col gap-4 min-h-0">
          <div className="flex-[1.2] rounded-2xl border border-border bg-surface px-5 py-4 flex flex-col gap-2.5 min-h-0 overflow-auto">
            <span className="text-xs font-semibold text-textPrimary">Logs gần đây</span>
            <div className="font-mono flex flex-col gap-1.5 text-[10.5px] text-textMuted">
              {data.recentLogs.length === 0 && <span>Chưa có log trong 24h qua.</span>}
              {data.recentLogs.map((log, i) => {
                const level = detectLogLevel(log.message);
                return (
                  <span key={i}>
                    <span className={logLevelColor(level)}>{level}</span> {log.source}: {log.message}
                  </span>
                );
              })}
            </div>
          </div>

          <div className="flex-1 rounded-2xl border border-border bg-surface px-5 py-4 flex flex-col gap-2.5 min-h-0">
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
          </div>
        </div>
      </div>
    </div>
  );
}
