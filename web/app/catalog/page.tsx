"use client";

import { useEffect, useState } from "react";
import type { CatalogTable, CicdResponse, CostBreakdownEntry } from "@/lib/types";
import { ArchitectureFlow } from "@/components/ArchitectureFlow";
import { Chip } from "@/components/Chip";
import { KpiCard } from "@/components/KpiCard";
import { RankRow } from "@/components/RankRow";
import { CardIcon, SectionCard } from "@/components/SectionCard";
import { StageTimeline } from "@/components/StageTimeline";

/**
 * Architecture overview plus the Glue Data Catalog browser. Only the catalog
 * fetch is blocking; the CI/CD and cost cards load independently and keep a
 * loading placeholder if their requests fail.
 */
export default function CatalogPage() {
  const [tables, setTables] = useState<CatalogTable[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [cicd, setCicd] = useState<CicdResponse | null>(null);
  const [costBreakdown, setCostBreakdown] = useState<CostBreakdownEntry[] | null>(null);

  async function load() {
    setError(null);
    try {
      const res = await fetch("/api/catalog");
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Không tải được Data Catalog.");
      setTables(body);
      setSelected((current) => current ?? body[0]?.name ?? null); // keep the selection across retries
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không tải được Data Catalog.");
    }
  }

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    fetch("/api/cicd")
      .then((res) => res.json().then((body) => ({ ok: res.ok, body })))
      .then(({ ok, body }) => {
        if (ok) setCicd(body);
      })
      .catch(() => {
        /* secondary: the card stays on its placeholder */
      });
  }, []);

  useEffect(() => {
    fetch("/api/ops")
      .then((res) => res.json().then((body) => ({ ok: res.ok, body })))
      .then(({ ok, body }) => {
        if (ok && Array.isArray(body?.costBreakdown)) setCostBreakdown(body.costBreakdown);
      })
      .catch(() => {
        /* secondary: the card stays on its placeholder */
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

  if (!tables) {
    return (
      <div className="p-6 lg:p-9 grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-4">
        <div className="h-96 rounded-xl border border-border bg-surface animate-pulse" />
        <div className="h-96 rounded-xl border border-border bg-surface animate-pulse" />
      </div>
    );
  }

  const current = tables.find((t) => t.name === selected) ?? tables[0];
  const totalColumns = tables.reduce((sum, t) => sum + t.columns.length, 0);
  const ragCount = tables.filter((t) => t.ragIndexed).length;
  const maxCost = Math.max(1, ...(costBreakdown ?? []).map((x) => x.monthlyUsd));

  return (
    <div className="p-6 lg:p-9 flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="font-heading text-3xl font-semibold tracking-tight text-textPrimary">Architecture & Lakehouse</h1>
        <p className="text-[13px] text-textMuted tabular-nums">
          Kiến trúc pipeline, trạng thái CI/CD, chi phí hạ tầng, và {tables.length} bảng trong Glue Data Catalog
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <KpiCard label="Bảng trong Glue Catalog" value={String(tables.length)} icon={<CardIcon d={["M4 5a8 3 0 1 0 16 0 8 3 0 1 0-16 0", "M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5", "M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"]} />} />
        <KpiCard label="Tổng số cột" value={String(totalColumns)} icon={<CardIcon d={["M3 4h18v16H3z", "M3 10h18M9 4v16"]} />} />
        <KpiCard
          label="Bảng vào RAG"
          value={`${ragCount} / ${tables.length}`}
          hint="trợ lý có thể trả lời về các bảng này"
          icon={<CardIcon d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />}
        />
      </div>

      <ArchitectureFlow />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
        <SectionCard title="Trạng thái CI/CD" icon={<CardIcon d="M13 2 3 14h8l-1 8 10-12h-8l1-8z" />}>
          {cicd ? <StageTimeline stages={cicd.stages} approveUrl={null} /> : <span className="text-[12px] text-textMuted">Đang tải…</span>}
        </SectionCard>

        <SectionCard title="Chi phí hạ tầng" icon={<CardIcon d={["M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z", "M12 6.5v1M12 16v1"]} />}>
          {costBreakdown ? (
            <div className="flex flex-col gap-3">
              {costBreakdown.map((c) => (
                <RankRow key={c.category} label={c.category} value={c.monthlyUsd} max={maxCost} display={`$${c.monthlyUsd.toFixed(2)}`} labelWidth="w-28" />
              ))}
            </div>
          ) : (
            <span className="text-[12px] text-textMuted">Đang tải…</span>
          )}
        </SectionCard>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-4 items-start">
        <div
          role="tablist"
          aria-label="Bảng dữ liệu"
          className="flex gap-2 overflow-x-auto rounded-xl border border-border bg-surface/75 p-2.5 backdrop-blur-md lg:flex-col lg:overflow-visible"
        >
          {tables.map((table) => {
            const active = table.name === current?.name;
            return (
              <button
                key={table.name}
                role="tab"
                aria-selected={active}
                onClick={() => setSelected(table.name)}
                className={`flex shrink-0 flex-col gap-1 rounded-lg border px-3 py-2.5 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent lg:w-full ${
                  active ? "border-accent/50 bg-accent/10" : "border-transparent hover:bg-white/[0.03]"
                }`}
              >
                <span className="text-[13px] font-semibold text-textPrimary">{table.name}</span>
                <span className="flex items-center gap-2 text-[11.5px] tabular-nums text-textMuted">
                  {table.columns.length} cột
                  <Chip tone={table.ragIndexed ? "success" : "muted"}>{table.ragIndexed ? "RAG indexed" : "không vào RAG"}</Chip>
                </span>
              </button>
            );
          })}
        </div>

        {current && (
          <SectionCard title={current.name} meta={`${current.columns.length} cột`} icon={<CardIcon d={["M3 4h18v16H3z", "M3 10h18M9 4v16"]} />}>
            <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {[
                ["Nguồn API", current.sourceApi],
                ["Lambda ingestion", current.ingestionLambda],
                ["Tần suất", current.cadence],
                ["Vị trí", current.location],
              ].map(([label, value]) => (
                <div key={label} className="min-w-0 rounded-lg bg-bg/70 px-3 py-2.5">
                  <dt className="text-[11.5px] text-textMuted">{label}</dt>
                  <dd className="break-all text-[12.5px] text-textPrimary">{value}</dd>
                </div>
              ))}
            </dl>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-[12.5px]">
                <thead>
                  <tr className="text-left text-[12px] font-medium text-textMuted">
                    <th className="border-b border-border py-2 pr-4 font-medium">Cột</th>
                    <th className="border-b border-border py-2 pr-4 font-medium">Kiểu</th>
                    <th className="border-b border-border py-2 font-medium">Ghi chú</th>
                  </tr>
                </thead>
                <tbody>
                  {current.columns.map((col) => (
                    <tr key={col.name}>
                      <td className="border-b border-border py-2 pr-4 font-semibold text-textPrimary">{col.name}</td>
                      <td className="whitespace-nowrap border-b border-border py-2 pr-4 text-accentBright">{col.type}</td>
                      <td className="border-b border-border py-2 text-textMuted">{col.note ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </SectionCard>
        )}
      </div>
    </div>
  );
}
