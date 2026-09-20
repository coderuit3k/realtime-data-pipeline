"use client";

import { useEffect, useState } from "react";
import type { InsightsResponse } from "@/lib/types";

type Range = "today" | "7d";

export default function InsightsPage() {
  const [range, setRange] = useState<Range>("today");
  const [data, setData] = useState<InsightsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load(r: Range) {
    setError(null);
    try {
      const res = await fetch(`/api/insights?range=${r}`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Không tải được Insights.");
      setData(body);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không tải được Insights.");
    }
  }

  useEffect(() => {
    load(range);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range]);

  if (error) {
    return (
      <div className="p-9 flex flex-col gap-4">
        <p className="text-error text-sm">{error}</p>
        <button
          onClick={() => load(range)}
          className="w-fit rounded-lg border border-border px-4 py-2 text-sm text-textPrimary"
        >
          Thử lại
        </button>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="p-9 grid grid-cols-2 grid-rows-2 gap-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-64 rounded-2xl border border-border bg-surface animate-pulse" />
        ))}
      </div>
    );
  }

  const maxMentions = Math.max(1, ...data.topKeywords.map((k) => k.mentions));
  const maxOverlap = Math.max(1, ...data.githubHnOverlap.map((o) => o.overlapCount));

  return (
    <div className="p-9 flex flex-col gap-5">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="font-heading text-2xl font-semibold text-textPrimary">Trending Insights</h1>
          <p className="mt-1.5 text-sm text-textSecondary">Tương quan chéo giữa 5 nguồn · cập nhật mỗi 10 phút</p>
        </div>
        <div className="flex gap-1.5">
          <button
            onClick={() => setRange("today")}
            className={`font-mono text-xs px-3 py-1.5 rounded-full border ${
              range === "today" ? "bg-accent/10 border-accent text-accent" : "border-transparent text-textMuted"
            }`}
          >
            Hôm nay
          </button>
          <button
            onClick={() => setRange("7d")}
            className={`font-mono text-xs px-3 py-1.5 rounded-full border ${
              range === "7d" ? "bg-accent/10 border-accent text-accent" : "border-transparent text-textMuted"
            }`}
          >
            7 ngày
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 grid-rows-2 gap-4 flex-grow min-h-0">
        <div className="rounded-2xl border border-border bg-surface px-5 py-5 flex flex-col gap-3 min-h-0">
          <span className="text-[13px] font-semibold text-textPrimary">Từ khoá nổi bật (HN + News)</span>
          <div className="flex flex-col gap-2.5">
            {data.topKeywords.map((k, i) => (
              <div key={k.keyword} className="flex items-center gap-2.5">
                <span className="w-16 text-[11.5px] text-textSecondary">{k.keyword}</span>
                <div className="flex-grow h-2 rounded bg-border">
                  <div
                    className={`h-full rounded ${i === 0 ? "bg-accent" : "bg-textMuted"}`}
                    style={{ width: `${(k.mentions / maxMentions) * 100}%` }}
                  />
                </div>
                <span className="font-mono text-[11px] text-textMuted">{k.mentions}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-surface px-5 py-5 flex flex-col gap-3 min-h-0">
          <span className="text-[13px] font-semibold text-textPrimary">Crypto: mentions ↔ biến động giá</span>
          <div className="flex flex-col gap-3">
            {data.cryptoMentions.map((c) => (
              <div key={c.coinId} className="flex items-center justify-between">
                <span className="text-xs text-textSecondary">{c.coinId}</span>
                <span className="font-mono text-[11px] text-textMuted">{c.mentionCount} mentions</span>
                <span className={`font-mono text-xs ${c.change24hPct >= 0 ? "text-success" : "text-error"}`}>
                  {c.change24hPct >= 0 ? "+" : ""}
                  {c.change24hPct.toFixed(1)}%
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-surface px-5 py-5 flex flex-col gap-3 min-h-0">
          <span className="text-[13px] font-semibold text-textPrimary">GitHub Trending ↔ HN overlap</span>
          <div className="flex flex-col gap-2.5">
            {data.githubHnOverlap.map((o) => (
              <div key={o.keyword} className="flex items-center gap-2">
                <span className="font-mono w-5 text-[11px] text-textMuted text-right">{o.overlapCount}</span>
                <div className="flex-grow h-1.5 rounded bg-border">
                  <div
                    className="h-full rounded bg-accent"
                    style={{ width: `${(o.overlapCount / maxOverlap) * 100}%` }}
                  />
                </div>
                <span className="w-[70px] text-[11px] text-textSecondary">{o.keyword}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-surface px-5 py-5 flex flex-col gap-3 min-h-0 overflow-hidden">
          <span className="text-[13px] font-semibold text-textPrimary">
            Thời tiết · {data.weatherSnapshot.length} khu vực
          </span>
          <div className="grid grid-cols-2 gap-2.5 overflow-auto">
            {data.weatherSnapshot.map((w) => (
              <div key={w.location} className="rounded-lg border border-border bg-bg px-3 py-2.5">
                <span className="text-[11px] text-textSecondary">{w.location}</span>
                <div className="font-mono text-base text-textPrimary">{w.temperatureC.toFixed(0)}°C</div>
                <span className="text-[10.5px] text-textMuted">độ ẩm {w.humidityPct.toFixed(0)}%</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
