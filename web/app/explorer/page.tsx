"use client";

import { useEffect, useState } from "react";
import type { ExplorerQueryResult, SampleQueryGroup } from "@/lib/types";

type SamplesResponse = { workgroup: string; database: string; groups: SampleQueryGroup[] };

function formatBytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export default function ExplorerPage() {
  const [samples, setSamples] = useState<SamplesResponse | null>(null);
  const [samplesError, setSamplesError] = useState<string | null>(null);
  const [sql, setSql] = useState("");
  const [result, setResult] = useState<ExplorerQueryResult | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    async function loadSamples() {
      try {
        const res = await fetch("/api/explorer/samples");
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? "Không tải được truy vấn mẫu.");
        setSamples(body);
        const firstQuery = body.groups[0]?.queries[0];
        if (firstQuery) setSql(firstQuery.sql);
      } catch (err) {
        setSamplesError(err instanceof Error ? err.message : "Không tải được truy vấn mẫu.");
      }
    }
    loadSamples();
  }, []);

  async function runQuery() {
    setRunning(true);
    setRunError(null);
    try {
      const res = await fetch("/api/explorer/query", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sql }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Không chạy được truy vấn.");
      setResult(body);
    } catch (err) {
      setRunError(err instanceof Error ? err.message : "Không chạy được truy vấn.");
      setResult(null);
    } finally {
      setRunning(false);
    }
  }

  if (samplesError) {
    return (
      <div className="p-9">
        <p className="text-error text-sm">{samplesError}</p>
      </div>
    );
  }

  return (
    <div className="p-9 flex flex-col gap-5">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-textPrimary">Data Explorer</h1>
        {samples && (
          <p className="mt-1.5 text-sm text-textSecondary">
            Workgroup <span className="font-mono">{samples.workgroup}</span> · DB{" "}
            <span className="font-mono">{samples.database}</span>
          </p>
        )}
      </div>

      <div className="flex gap-4 flex-grow min-h-0">
        <div className="w-[270px] shrink-0 rounded-lg border border-border bg-surface/75 backdrop-blur-md p-4 flex flex-col gap-4 overflow-auto">
          <div className="flex items-center gap-2">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="text-accent">
              <path d="M6 3h12v18l-6-4-6 4V3Z" />
            </svg>
            <span className="text-xs font-semibold text-textPrimary">Truy vấn mẫu</span>
          </div>
          {samples?.groups.map((group) => (
            <div key={group.label} className="flex flex-col gap-1.5">
              <span className="font-mono text-[10px] uppercase text-textMuted">{group.label}</span>
              {group.queries.map((query) => (
                <button
                  key={query.id}
                  onClick={() => setSql(query.sql)}
                  className={`text-left rounded-lg px-2.5 py-2 text-xs ${
                    sql === query.sql ? "bg-accent/10 border border-accent text-textPrimary" : "text-textSecondary"
                  }`}
                >
                  {query.label}
                </button>
              ))}
            </div>
          ))}
        </div>

        <div className="flex-grow flex flex-col gap-4 min-h-0">
          <div className="rounded-lg border border-border bg-surface/75 backdrop-blur-md px-5 py-4 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-textPrimary">SQL</span>
              <button
                onClick={runQuery}
                disabled={running}
                className="rounded-lg bg-accent px-4 py-2 text-xs font-semibold text-bg disabled:opacity-50 transition-shadow hover:shadow-glowCyan flex items-center gap-2"
              >
                {running ? "Đang chạy…" : (
                  <>
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" stroke="none">
                      <path d="M6 4l14 8-14 8V4Z" />
                    </svg>
                    <span>Chạy</span>
                  </>
                )}
              </button>
            </div>
            <textarea
              value={sql}
              onChange={(e) => setSql(e.target.value)}
              rows={8}
              className="font-mono text-xs bg-bg border border-border rounded-lg p-3 text-accent resize-y"
            />
            {runError && <p className="text-error text-xs">{runError}</p>}
          </div>

          {result && (
            <div className="rounded-lg border border-border bg-surface/75 backdrop-blur-md px-5 py-4 flex flex-col gap-3 flex-grow min-h-0 overflow-auto">
              <div className="flex items-center gap-2">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="text-accent">
                  <rect x="3" y="4" width="18" height="16" rx="1.5" />
                  <path d="M3 10h18M9 4v16" />
                </svg>
                <span className="text-xs font-semibold text-textPrimary">Kết quả</span>
              </div>
              <table className="font-mono w-full border-collapse text-xs">
                <thead>
                  <tr>
                    {result.columns.map((col, i) => (
                      <th key={i} className="text-left text-textSecondary text-[10.5px] uppercase border-b border-border py-2 px-2.5">
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.rows.map((row, i) => (
                    <tr key={i}>
                      {row.map((cell, j) => (
                        <td key={j} className="tabular-nums text-textSecondary border-b border-border py-2 px-2.5">
                          {cell ?? ""}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              <span className="tabular-nums mt-auto text-[11px] text-textMuted">
                Quét {formatBytes(result.scannedBytes)} · {(result.elapsedMs / 1000).toFixed(2)}s · {result.rows.length} dòng
                {result.hasMoreRows ? " (hiển thị 100 dòng đầu)" : ""}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
