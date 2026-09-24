"use client";

import { useEffect, useState } from "react";
import type { CatalogTable } from "@/lib/types";

function badgeLabel(table: CatalogTable): string {
  return table.ragIndexed ? "RAG indexed" : "không vào RAG";
}

export default function CatalogPage() {
  const [tables, setTables] = useState<CatalogTable[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  async function load() {
    setError(null);
    try {
      const res = await fetch("/api/catalog");
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Không tải được Data Catalog.");
      setTables(body);
      setSelected((current) => current ?? body[0]?.name ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không tải được Data Catalog.");
    }
  }

  useEffect(() => {
    load();
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
      <div className="p-9 grid grid-cols-[270px_1fr] gap-4">
        <div className="h-96 rounded-lg border border-border bg-surface animate-pulse" />
        <div className="h-96 rounded-lg border border-border bg-surface animate-pulse" />
      </div>
    );
  }

  const current = tables.find((t) => t.name === selected) ?? tables[0];

  return (
    <div className="p-9 flex flex-col gap-5">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-textPrimary">Data Catalog</h1>
        <p className="mt-1.5 text-sm text-textSecondary tabular-nums">
          {tables.length} bảng trong Glue Data Catalog
        </p>
      </div>
      <div className="flex gap-4 flex-grow min-h-0">
        <div className="w-[270px] shrink-0 rounded-lg border border-border bg-surface/75 backdrop-blur-md p-3.5 flex flex-col gap-1.5 overflow-auto">
          {tables.map((table) => (
            <button
              key={table.name}
              onClick={() => setSelected(table.name)}
              className={`text-left flex flex-col rounded-lg px-3 py-2.5 ${
                table.name === current?.name
                  ? "bg-accent/10 border border-accent"
                  : "border border-transparent"
              }`}
            >
              <div className="flex items-center gap-2">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="text-accent flex-shrink-0">
                  <ellipse cx="12" cy="5" rx="8" ry="3" />
                  <path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5" />
                  <path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" />
                </svg>
                <span className="text-[12.5px] font-semibold text-textPrimary">{table.name}</span>
              </div>
              <span className="text-[10.5px] text-textMuted tabular-nums">
                {table.columns.length} cột · {badgeLabel(table)}
              </span>
            </button>
          ))}
        </div>

        {current && (
          <div className="flex-grow flex flex-col gap-4 min-h-0">
            <div className="rounded-lg border border-border bg-surface/75 backdrop-blur-md px-5 py-5 border-t-2 border-t-accent flex flex-col gap-2.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="text-accent flex-shrink-0">
                    <ellipse cx="12" cy="5" rx="8" ry="3" />
                    <path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5" />
                    <path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" />
                  </svg>
                  <span className="font-heading text-[15px] font-semibold text-textPrimary">
                    {current.name}
                  </span>
                </div>
                <span className="font-mono text-[10px] rounded-md bg-bg px-2.5 py-1 text-textSecondary flex items-center gap-1.5">
                  {current.ragIndexed && (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="text-success flex-shrink-0">
                      <path d="M20 6 9 17l-5-5" />
                    </svg>
                  )}
                  {badgeLabel(current)}
                </span>
              </div>
              {current.cadence && (
                <span className="text-xs text-textMuted">
                  Ghi bởi <span className="font-mono">{current.ingestionLambda}</span> {current.cadence} · nguồn{" "}
                  <span className="font-mono">{current.sourceApi}</span>
                </span>
              )}
            </div>

            <div className="rounded-lg border border-border bg-surface/75 backdrop-blur-md px-5 py-5 flex flex-col gap-2.5 flex-grow min-h-0 overflow-auto">
              <div className="flex items-center gap-2">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="text-accent flex-shrink-0">
                  <rect x="3" y="4" width="18" height="16" rx="1.5" />
                  <path d="M3 10h18M9 4v16" />
                </svg>
                <span className="text-[12.5px] font-semibold text-textPrimary">Schema</span>
              </div>
              <table className="font-mono w-full border-collapse text-xs">
                <thead>
                  <tr>
                    <th className="text-left text-textSecondary text-[10.5px] uppercase tracking-wide border-b border-border py-2 px-2.5">
                      Cột
                    </th>
                    <th className="text-left text-textSecondary text-[10.5px] uppercase tracking-wide border-b border-border py-2 px-2.5">
                      Kiểu
                    </th>
                    <th className="text-left text-textSecondary text-[10.5px] uppercase tracking-wide border-b border-border py-2 px-2.5">
                      Ghi chú
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {current.columns.map((col) => (
                    <tr key={col.name}>
                      <td className="text-textSecondary border-b border-border py-2 px-2.5">{col.name}</td>
                      <td className="text-textSecondary border-b border-border py-2 px-2.5">{col.type}</td>
                      <td className="text-textMuted border-b border-border py-2 px-2.5">{col.note ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <span className="mt-auto text-[11px] text-textMuted">
                Vị trí lưu trữ: <span className="font-mono">{current.location}</span>
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
