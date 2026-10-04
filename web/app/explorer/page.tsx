"use client";

import { useEffect, useState } from "react";
import type { ExplorerQueryResult, SampleQueryGroup } from "@/lib/types";
import { Chip } from "@/components/Chip";
import { CardIcon, SectionCard } from "@/components/SectionCard";

type SamplesResponse = { workgroup: string; database: string; groups: SampleQueryGroup[] };

function formatBytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

// Explorer runs arbitrary SQL, so image columns can appear anywhere in the
// result; they are recognised by column name at render time.
const IMAGE_CELL_CLASS: Record<string, string> = {
  avatar_url: "w-6 h-6 rounded-full object-cover",
  image_url: "w-16 h-10 rounded object-cover",
};

/** Renders known image columns as thumbnails and everything else as text; NULL shows as blank. */
function ExplorerCell({ column, value }: { column: string; value: string | null }) {
  const imageClass = IMAGE_CELL_CLASS[column.toLowerCase()];
  if (imageClass && value) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={value}
        alt=""
        className={imageClass}
        loading="lazy"
        onError={(e) => {
          e.currentTarget.style.display = "none";
        }}
      />
    );
  }
  return <>{value ?? ""}</>;
}

/**
 * Ad-hoc Athena SQL against the lakehouse, pre-filled with the first sample
 * query. Read-only enforcement happens server-side in /api/explorer/query.
 */
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
    <div className="p-6 lg:p-9 flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="font-heading text-3xl font-semibold tracking-tight text-textPrimary">Data Explorer</h1>
        <p className="text-[13px] text-textMuted">
          Chạy SQL chỉ-đọc trên lakehouse bằng Athena{samples ? ` · ${samples.database}` : ""}.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[290px_1fr] gap-4 items-start">
        <SectionCard title="Truy vấn mẫu" icon={<CardIcon d="M6 3h12v18l-6-4-6 4V3Z" />}>
          {!samples && <span className="text-[12px] text-textMuted">Đang tải…</span>}
          {samples?.groups.map((group) => (
            <div key={group.label} className="flex flex-col gap-2">
              <span className="text-[12px] font-medium text-textMuted">{group.label}</span>
              <div className="flex flex-wrap gap-2 lg:flex-col">
                {group.queries.map((query) => {
                  const active = sql === query.sql;
                  return (
                    <button
                      key={query.id}
                      onClick={() => setSql(query.sql)}
                      aria-pressed={active}
                      className={`rounded-lg border px-3 py-2 text-left text-[12.5px] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent ${
                        active
                          ? "border-accent/50 bg-accent/10 text-textPrimary"
                          : "border-border bg-bg/60 text-textSecondary hover:border-accent/30"
                      }`}
                    >
                      {query.label}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </SectionCard>

        <div className="flex min-w-0 flex-col gap-4">
          <SectionCard title="SQL" icon={<CardIcon d={["M7 8l-4 4 4 4", "M17 8l4 4-4 4", "M14 4l-4 16"]} />}>
            <textarea
              value={sql}
              onChange={(e) => setSql(e.target.value)}
              onKeyDown={(e) => {
                if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && !running && sql.trim()) {
                  e.preventDefault();
                  runQuery();
                }
              }}
              rows={8}
              spellCheck={false}
              aria-label="Câu lệnh SQL"
              className="resize-y rounded-lg border border-border bg-bg p-3.5 font-mono text-[13px] leading-relaxed text-accentBright outline-none transition-colors focus:border-accent/60"
            />
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-[12px] text-textMuted">Nhấn Ctrl+Enter để chạy</span>
              <button
                onClick={runQuery}
                disabled={running || !sql.trim()}
                className="flex items-center gap-2 rounded-lg bg-accent px-5 py-2.5 text-[13px] font-semibold text-bg transition-shadow hover:shadow-glowCyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-accentBright disabled:opacity-50"
              >
                {running ? (
                  "Đang chạy…"
                ) : (
                  <>
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" stroke="none" aria-hidden="true">
                      <path d="M6 4l14 8-14 8V4Z" />
                    </svg>
                    Chạy
                  </>
                )}
              </button>
            </div>
            {runError && (
              <p role="alert" className="rounded-lg border border-error/30 bg-error/10 px-3.5 py-2.5 text-[12.5px] text-error">
                {runError}
              </p>
            )}
          </SectionCard>

          {result ? (
            <SectionCard title="Kết quả" icon={<CardIcon d={["M3 4h18v16H3z", "M3 10h18M9 4v16"]} />}>
              <div className="flex flex-wrap gap-2">
                <Chip tone="accent">Quét {formatBytes(result.scannedBytes)}</Chip>
                <Chip tone="muted">{(result.elapsedMs / 1000).toFixed(2)}s</Chip>
                <Chip tone="muted">
                  {result.rows.length} dòng{result.hasMoreRows ? " (hiển thị 100 dòng đầu)" : ""}
                </Chip>
              </div>
              <div className="max-h-[60vh] overflow-auto rounded-lg border border-border">
                <table className="w-full border-collapse text-[12.5px]">
                  <thead>
                    <tr>
                      {result.columns.map((col, i) => (
                        <th key={i} className="sticky top-0 whitespace-nowrap border-b border-border bg-surfaceHigh px-3 py-2 text-left font-semibold text-textPrimary">
                          {col}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {result.rows.map((row, i) => (
                      <tr key={i} className="odd:bg-white/[0.02]">
                        {row.map((cell, j) => (
                          <td key={j} className="border-b border-border px-3 py-2 tabular-nums text-textSecondary">
                            <ExplorerCell column={result.columns[j] ?? ""} value={cell} />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </SectionCard>
          ) : (
            !runError && (
              <div className="rounded-xl border border-dashed border-border px-5 py-10 text-center text-[13px] text-textMuted">
                Chọn một truy vấn mẫu hoặc viết SQL, rồi bấm Chạy để xem kết quả.
              </div>
            )
          )}
        </div>
      </div>
    </div>
  );
}
