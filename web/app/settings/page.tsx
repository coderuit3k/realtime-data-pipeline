"use client";

import { useEffect, useState } from "react";
import type { SettingsResponse } from "@/lib/types";
import { DATA_SOURCES } from "@/lib/settingsMeta";

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
      <div className="p-9 flex flex-col gap-4">
        <div className="h-96 rounded-2xl border border-border bg-surface animate-pulse" />
      </div>
    );
  }

  return (
    <div className="p-9 flex flex-col gap-5">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-textPrimary">Settings</h1>
        <p className="mt-1.5 text-sm text-textSecondary">Cấu hình nguồn dữ liệu, secrets &amp; lịch vận hành</p>
      </div>

      <div className="grid grid-cols-[1.4fr_1fr] gap-4 flex-grow min-h-0">
        <div className="rounded-2xl border border-border bg-surface px-5 py-5 flex flex-col gap-3.5 overflow-auto">
          <span className="text-xs font-semibold text-textPrimary">Nguồn dữ liệu</span>
          <div className="flex flex-col gap-2.5">
            {DATA_SOURCES.map((source) => {
              const schedule = source.usesNewsSchedule ? data.newsSchedule : data.sharedSchedule;
              return (
                <div key={source.id} className="flex items-center gap-3 rounded-lg border border-border px-3 py-2.5">
                  <span
                    className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${schedule.enabled ? "bg-success" : "bg-error"}`}
                  />
                  <div className="flex-grow">
                    <span className="text-xs text-textPrimary">{source.name}</span>
                    <div className="text-[10.5px] text-textMuted">{source.detail}</div>
                  </div>
                  <span className="font-mono text-[11px] px-2.5 py-1 rounded-md bg-bg text-textSecondary">
                    {schedule.scheduleExpression}
                  </span>
                </div>
              );
            })}
          </div>
          <p className="text-[10.5px] text-textMuted">Chỉnh sửa nguồn dữ liệu qua common/config.py + redeploy.</p>
        </div>

        <div className="rounded-2xl border border-border bg-surface px-5 py-5 flex flex-col gap-3">
          <span className="text-xs font-semibold text-textPrimary">Secrets Manager</span>
          {data.secrets.map((secret) => (
            <div key={secret.name} className="flex justify-between items-center">
              <span className="text-xs text-textSecondary">{secret.name}</span>
              <span className={`font-mono text-[11px] ${secret.configured ? "text-success" : "text-error"}`}>
                {secret.configured ? "● configured" : "○ chưa cấu hình"}
              </span>
            </div>
          ))}
          <p className="text-[10.5px] text-textMuted">Giá trị được set qua AWS CLI, Terraform không quản lý value.</p>
        </div>
      </div>
    </div>
  );
}
