"use client";

import { useEffect, useState } from "react";
import { KpiCard } from "@/components/KpiCard";
import { SourceVolumeChart } from "@/components/SourceVolumeChart";
import { ActivityFeed } from "@/components/ActivityFeed";
import type { DashboardResponse, CostResponse } from "@/lib/types";

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
        <button
          onClick={load}
          className="w-fit rounded-lg border border-border px-4 py-2 text-sm text-textPrimary"
        >
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

  const allHealthy = data.sourcesHealthy === data.sourcesTotal;

  return (
    <div className="p-9 flex flex-col gap-5">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-textPrimary">Tổng quan hệ thống</h1>
      </div>
      <div className="grid grid-cols-4 gap-4">
        <KpiCard label="Bản ghi hôm nay" value={String(data.recordsToday)} />
        <KpiCard
          label="Nguồn hoạt động"
          value={`${data.sourcesHealthy} / ${data.sourcesTotal}`}
          hint={allHealthy ? "Tất cả healthy" : "Có nguồn chưa ghi hôm nay"}
          hintColor={allHealthy ? "success" : "muted"}
        />
        <KpiCard
          label="Cảnh báo đang bật"
          value={String(data.alarmsBreaching)}
          hint={`trong ${data.alarmsTotal} alarm`}
        />
        <KpiCard
          label="Chi phí ước tính"
          value={cost ? `$${cost.monthToDateCostUsd.toFixed(2)}` : "—"}
          hint="tháng này"
        />
      </div>
      <div className="grid grid-cols-[1.4fr_1fr] gap-4">
        <SourceVolumeChart sourceVolumes={data.sourceVolumes} />
        <ActivityFeed items={data.recentActivity} />
      </div>
    </div>
  );
}
