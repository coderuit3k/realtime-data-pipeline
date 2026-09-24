"use client";

import { useEffect, useState } from "react";
import type { CicdResponse, PipelineStage } from "@/lib/types";

function stageColor(status: PipelineStage["status"]): { ring: string; bg: string; text: string } {
  if (status === "success") return { ring: "border-success", bg: "bg-success/10", text: "text-success" };
  if (status === "waiting") return { ring: "border-warning", bg: "bg-warning/10", text: "text-warning" };
  if (status === "in_progress") return { ring: "border-accent", bg: "bg-accent/10", text: "text-accent" };
  if (status === "failure") return { ring: "border-error", bg: "bg-error/10", text: "text-error" };
  if (status === "cancelled" || status === "skipped")
    return { ring: "border-textMuted", bg: "bg-textMuted/10", text: "text-textMuted" };
  return { ring: "border-border", bg: "bg-surface", text: "text-textMuted" };
}

function conclusionLabel(conclusion: string | null): string {
  if (conclusion === "success") return "apply ok";
  if (conclusion === null) return "đang chạy";
  return conclusion;
}

function formatDuration(ms: number | null): string {
  if (ms === null) return "—";
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m${seconds}s` : `${seconds}s`;
}

export default function CicdPage() {
  const [data, setData] = useState<CicdResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setError(null);
    try {
      const res = await fetch("/api/cicd");
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Không tải được CI/CD.");
      setData(body);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không tải được CI/CD.");
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
      <div className="p-9 flex flex-col gap-4">
        <div className="h-40 rounded-lg border border-border bg-surface animate-pulse" />
        <div className="h-64 rounded-lg border border-border bg-surface animate-pulse" />
      </div>
    );
  }

  return (
    <div className="p-9 flex flex-col gap-5">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-textPrimary">CI/CD Pipeline</h1>
        <p className="mt-1.5 text-sm text-textSecondary">
          GitHub Actions · OIDC · gate phê duyệt thủ công trước <span className="font-mono">terraform apply</span> production
        </p>
      </div>

      <div className="rounded-lg border border-border bg-surface/75 backdrop-blur-md px-6 py-5 flex flex-col gap-4">
        <span className="text-xs font-semibold text-textPrimary">Pipeline hiện tại</span>
        <div className="flex items-center">
          {data.stages.map((stage, i) => {
            const colors = stageColor(stage.status);
            return (
              <div key={stage.name} className="flex items-center flex-grow">
                <div className="flex flex-col items-center gap-2 w-[170px]">
                  <div className={`w-9 h-9 rounded-full border flex items-center justify-center ${colors.ring} ${colors.bg}`}>
                    {stage.status === "success" && (
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className={colors.text}>
                        <path d="M20 6 9 17l-5-5" />
                      </svg>
                    )}
                    {stage.status === "in_progress" && (
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className={`${colors.text} animate-spin motion-reduce:animate-none`}>
                        <path d="M21 12a9 9 0 1 1-9-9" />
                      </svg>
                    )}
                    {stage.status === "waiting" && (
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className={colors.text}>
                        <circle cx="12" cy="12" r="9" />
                        <path d="M12 7v5l3.5 2" />
                      </svg>
                    )}
                    {(stage.status === "failure" || stage.status === "cancelled" || stage.status === "skipped") && (
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className={colors.text}>
                        <path d="M18 6 6 18M6 6l12 12" />
                      </svg>
                    )}
                    {!["success", "in_progress", "waiting", "failure", "cancelled", "skipped"].includes(stage.status) && (
                      <span className={`text-xs font-mono ${colors.text}`}>{i + 1}</span>
                    )}
                  </div>
                  <span className="text-[11.5px] text-textPrimary text-center">
                    {stage.name}
                    <br />
                    <span className="font-mono text-textMuted">{stage.detail || stage.status}</span>
                  </span>
                </div>
                {i < data.stages.length - 1 && <div className={`flex-grow h-0.5 ${colors.bg} -mt-7`} />}
              </div>
            );
          })}
        </div>
        {data.latestDeployRunUrl && (
          <div className="flex justify-end">
            <a
              href={data.latestDeployRunUrl}
              target="_blank"
              rel="noreferrer"
              className="rounded-lg px-4 py-2 text-xs font-semibold bg-warning text-bg transition-opacity hover:opacity-90"
            >
              Xem trên GitHub Actions để phê duyệt
            </a>
          </div>
        )}
      </div>

      <div className="rounded-lg border border-border bg-surface/75 backdrop-blur-md px-5 py-5 flex flex-col gap-3 flex-grow min-h-0 overflow-auto">
        <span className="text-xs font-semibold text-textPrimary">Lịch sử chạy gần đây</span>
        <div className="flex flex-col">
          {data.recentRuns.map((run) => (
            <div key={run.htmlUrl} className="flex items-center gap-3.5 py-2.5 border-b border-border last:border-b-0 transition-colors hover:bg-bg/40">
              <span
                className={`w-2 h-2 rounded-full flex-shrink-0 ${
                  run.conclusion === "success" ? "bg-success" : run.conclusion === null ? "bg-accent" : "bg-error"
                }`}
              />
              <span className="flex-grow text-xs text-textPrimary">{run.title}</span>
              <span className="font-mono text-[11px] text-textMuted tabular-nums">
                {run.branch} · {run.sha}
              </span>
              <a
                href={run.htmlUrl}
                target="_blank"
                rel="noreferrer"
                className={`font-mono text-[11px] tabular-nums ${run.conclusion === "success" ? "text-success" : "text-error"}`}
              >
                {conclusionLabel(run.conclusion)} · {formatDuration(run.durationMs)}
              </a>
            </div>
          ))}
          {data.recentRuns.length === 0 && <span className="text-xs text-textMuted">Chưa có lần chạy nào.</span>}
        </div>
      </div>
    </div>
  );
}
