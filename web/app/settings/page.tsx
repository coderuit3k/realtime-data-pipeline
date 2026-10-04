"use client";

import { useEffect, useState } from "react";
import type { SettingsResponse } from "@/lib/types";
import { DATA_SOURCES } from "@/lib/settingsMeta";
import { Chip } from "@/components/Chip";
import { KpiCard } from "@/components/KpiCard";
import { CardIcon, SectionCard } from "@/components/SectionCard";

/**
 * Read-only view of source schedules and whether each secret is set; secret
 * values never reach the browser.
 */
export default function SettingsPage() {
  const [data, setData] = useState<SettingsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setError(null);
    try {
      const res = await fetch("/api/settings");
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Không tải được Settings.");
      setData(body);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không tải được Settings.");
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
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {[0, 1].map((i) => (
            <div key={i} className="h-28 rounded-xl border border-border bg-surface animate-pulse" />
          ))}
        </div>
        <div className="h-96 rounded-xl border border-border bg-surface animate-pulse" />
      </div>
    );
  }

  const enabledCount = DATA_SOURCES.filter((s) => (s.usesNewsSchedule ? data.newsSchedule : data.sharedSchedule).enabled).length;
  const configuredCount = data.secrets.filter((s) => s.configured === true).length;
  const unknownCount = data.secrets.filter((s) => s.configured === null).length;

  return (
    <div className="p-6 lg:p-9 flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="font-heading text-3xl font-semibold tracking-tight text-textPrimary">Settings</h1>
        <p className="text-[13px] text-textMuted">Cấu hình nguồn dữ liệu, secrets &amp; lịch vận hành</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <KpiCard
          label="Nguồn đang bật"
          value={`${enabledCount} / ${DATA_SOURCES.length}`}
          hint={enabledCount === DATA_SOURCES.length ? "tất cả theo lịch" : "có nguồn đang tắt"}
          hintColor={enabledCount === DATA_SOURCES.length ? "success" : "error"}
          icon={<CardIcon d="M13 2 3 14h8l-1 8 10-12h-8l1-8z" />}
        />
        <KpiCard
          label="Secrets đã cấu hình"
          value={`${configuredCount} / ${data.secrets.length}`}
          hint={
            unknownCount > 0
              ? `${unknownCount} secret chưa kiểm tra được`
              : configuredCount === data.secrets.length
                ? "đầy đủ"
                : "còn secret chưa cấu hình"
          }
          hintColor={unknownCount > 0 ? "muted" : configuredCount === data.secrets.length ? "success" : "error"}
          icon={<CardIcon d={["M5 11h14v10H5z", "M8 11V7a4 4 0 0 1 8 0v4"]} />}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1.4fr_1fr] gap-4 items-start">
        <SectionCard title="Nguồn dữ liệu" meta={`${DATA_SOURCES.length} nguồn`} icon={<CardIcon d="M13 2 3 14h8l-1 8 10-12h-8l1-8z" />}>
          <div className="flex flex-col gap-2.5">
            {DATA_SOURCES.map((source) => {
              const schedule = source.usesNewsSchedule ? data.newsSchedule : data.sharedSchedule;
              return (
                <div key={source.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-bg/60 px-4 py-3">
                  <span
                    className={`h-2.5 w-2.5 flex-shrink-0 rounded-full ${schedule.enabled ? "bg-success" : "bg-error"}`}
                    role="img"
                    aria-label={schedule.enabled ? "Đang bật" : "Đang tắt"}
                  />
                  <div className="min-w-0 flex-1">
                    <span className="text-[13px] font-semibold text-textPrimary">{source.name}</span>
                    <div className="text-[11.5px] text-textMuted">{source.detail}</div>
                  </div>
                  <span className="rounded-md bg-white/[0.06] px-2.5 py-1 text-[12px] tabular-nums text-textSecondary">
                    {schedule.scheduleExpression}
                  </span>
                </div>
              );
            })}
          </div>
          <p className="text-[11.5px] text-textMuted">Chỉnh sửa nguồn dữ liệu qua common/config.py + redeploy.</p>
        </SectionCard>

        <SectionCard title="Secrets Manager" meta={`${data.secrets.length} secret`} icon={<CardIcon d={["M5 11h14v10H5z", "M8 11V7a4 4 0 0 1 8 0v4"]} />}>
          <div className="flex flex-col gap-2.5">
            {data.secrets.map((secret) => (
              <div key={secret.name} className="flex items-center justify-between gap-3 rounded-lg border border-border bg-bg/60 px-4 py-3">
                <span className="min-w-0 break-all text-[12.5px] text-textSecondary">{secret.name}</span>
                <Chip tone={secret.configured === null ? "muted" : secret.configured ? "success" : "error"}>
                  {secret.configured === null ? "không kiểm tra được" : secret.configured ? "configured" : "chưa cấu hình"}
                </Chip>
              </div>
            ))}
          </div>
          <p className="text-[11.5px] text-textMuted">Giá trị được set qua AWS CLI, Terraform không quản lý value.</p>
        </SectionCard>
      </div>
    </div>
  );
}
