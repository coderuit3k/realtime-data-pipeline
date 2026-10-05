"use client";

import { useEffect, useState } from "react";
import type { CicdResponse } from "@/lib/types";
import { KpiCard } from "@/components/KpiCard";
import { CardIcon, SectionCard } from "@/components/SectionCard";
import { StageTimeline } from "@/components/StageTimeline";

/** GitHub reports a null conclusion while a run is still in progress. */
function conclusionLabel(conclusion: string | null): string {
  if (conclusion === "success") return "apply ok";
  if (conclusion === null) return "đang chạy";
  return conclusion;
}

/** Compact "3m12s" style; null means GitHub reported no start time. */
function formatDuration(ms: number | null): string {
  if (ms === null) return "—";
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m${seconds}s` : `${seconds}s`;
}

function chipClasses(conclusion: string | null): string {
  if (conclusion === "success") return "bg-success/15 text-success";
  if (conclusion === null) return "bg-accent/15 text-accentBright";
  return "bg-error/15 text-error";
}

/**
 * Latest deploy workflow as a stage timeline plus recent runs. Approval
 * itself happens on GitHub; this page only links to the waiting run.
 */
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
      <div className="p-6 lg:p-9 flex flex-col gap-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-28 rounded-xl border border-border bg-surface animate-pulse" />
          ))}
        </div>
        <div className="h-40 rounded-xl border border-border bg-surface animate-pulse" />
        <div className="h-64 rounded-xl border border-border bg-surface animate-pulse" />
      </div>
    );
  }

  const finished = data.recentRuns.filter((r) => r.conclusion !== null);
  const succeeded = finished.filter((r) => r.conclusion === "success").length;
  const durations = data.recentRuns.map((r) => r.durationMs).filter((d): d is number => d !== null);
  const avgDuration = durations.length ? durations.reduce((s, d) => s + d, 0) / durations.length : null;
  const maxDuration = Math.max(1, ...durations);
  const latest = data.recentRuns[0];
  const hasWaiting = data.stages.some((s) => s.status === "waiting");

  return (
    <div className="p-6 lg:p-9 flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="font-heading text-3xl font-semibold tracking-tight text-textPrimary">CI/CD Pipeline</h1>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <KpiCard
          label="Tỉ lệ thành công"
          value={finished.length ? `${Math.round((succeeded / finished.length) * 100)}%` : "—"}
          hint={`${succeeded}/${finished.length} lần chạy gần nhất`}
          hintColor={finished.length > 0 && succeeded === finished.length ? "success" : "muted"}
          icon={<CardIcon d="M20 6 9 17l-5-5" />}
        />
        <KpiCard
          label="Thời lượng trung bình"
          value={avgDuration === null ? "—" : formatDuration(avgDuration)}
          hint={`trên ${durations.length} lần chạy`}
          icon={<CardIcon d={["M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z", "M12 7v5l3.5 2"]} />}
        />
        <KpiCard
          label="Lần chạy gần nhất"
          value={latest ? conclusionLabel(latest.conclusion) : "—"}
          hint={latest?.title}
          hintColor={latest?.conclusion === "success" ? "success" : "muted"}
          icon={<CardIcon d={["M6 3v12", "M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6z", "M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6z", "M18 9a9 9 0 0 1-9 9"]} />}
        />
      </div>

      <SectionCard title="Pipeline hiện tại" icon={<CardIcon d="M13 2 3 14h8l-1 8 10-12h-8l1-8z" />}>
        <StageTimeline stages={data.stages} approveUrl={data.latestDeployRunUrl} />
        {data.latestDeployRunUrl && !hasWaiting && (
          <a
            href={data.latestDeployRunUrl}
            target="_blank"
            rel="noreferrer"
            className="w-fit text-[12.5px] text-accent transition-colors hover:text-accentBright focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
          >
            Xem lần chạy mới nhất trên GitHub Actions
          </a>
        )}
      </SectionCard>

      <SectionCard title="Lịch sử chạy gần đây" meta={`${data.recentRuns.length} lần`} icon={<CardIcon d="M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5" />}>
        <div className="flex flex-col">
          {data.recentRuns.map((run) => (
            <a
              key={run.htmlUrl}
              href={run.htmlUrl}
              target="_blank"
              rel="noreferrer"
              className="flex flex-col gap-2 border-b border-border py-3 transition-colors last:border-b-0 hover:bg-white/[0.03] focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent sm:flex-row sm:items-center sm:gap-4 sm:px-2"
            >
              <span className={`w-fit flex-shrink-0 rounded-full px-2.5 py-0.5 text-[11.5px] font-semibold ${chipClasses(run.conclusion)}`}>
                {conclusionLabel(run.conclusion)}
              </span>
              <span className="min-w-0 flex-1 truncate text-[13px] text-textPrimary" title={run.title}>
                {run.title}
              </span>
              <span className="flex-shrink-0 text-[11.5px] tabular-nums text-textMuted">
                {run.branch} · {run.sha}
              </span>
              <span className="flex items-center gap-2 sm:w-36 sm:flex-shrink-0">
                <span className="h-1 flex-1 rounded-full bg-white/[0.05]">
                  <span
                    className="bar-grow block h-full rounded-full bg-accent/60"
                    style={{ width: `${Math.max(3, ((run.durationMs ?? 0) / maxDuration) * 100)}%` }}
                  />
                </span>
                <span className="w-12 text-right text-[11.5px] tabular-nums text-textSecondary">{formatDuration(run.durationMs)}</span>
              </span>
            </a>
          ))}
          {data.recentRuns.length === 0 && <span className="text-[12.5px] text-textMuted">Chưa có lần chạy nào.</span>}
        </div>
      </SectionCard>
    </div>
  );
}
