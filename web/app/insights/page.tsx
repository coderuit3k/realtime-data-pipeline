"use client";

import { useEffect, useRef, useState } from "react";
import type { InsightsResponse } from "@/lib/types";

type Range = "today" | "7d";

function formatUsdCompact(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1e12) return `$${(value / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `$${(value / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `$${(value / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `$${(value / 1e3).toFixed(1)}K`;
  return `$${value.toFixed(2)}`;
}

export default function InsightsPage() {
  const [range, setRange] = useState<Range>("today");
  const [data, setData] = useState<InsightsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const latestRangeRef = useRef<Range>("today");

  async function load(r: Range) {
    latestRangeRef.current = r;
    setError(null);
    try {
      const res = await fetch(`/api/insights?range=${r}`);
      const body = await res.json();
      if (latestRangeRef.current !== r) return; // a newer request superseded this one
      if (!res.ok) throw new Error(body.error ?? "Không tải được Insights.");
      setData(body);
    } catch (err) {
      if (latestRangeRef.current !== r) return;
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
          <div key={i} className="h-64 rounded-lg border border-border bg-surface animate-pulse" />
        ))}
      </div>
    );
  }

  const maxMentions = Math.max(1, ...data.topKeywords.map((k) => k.mentions));
  const maxOverlap = Math.max(1, ...data.githubHnOverlap.map((o) => o.overlapCount));
  const maxLanguages = Math.max(1, ...data.githubLanguages.map((l) => l.repoCount));
  const maxStars = Math.max(1, ...data.githubStars.map((r) => r.stars));

  return (
    <div className="p-9 flex flex-col gap-5">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="font-heading text-2xl font-semibold text-textPrimary">Trending Insights</h1>
        </div>
        <div className="flex gap-1.5">
          <button
            onClick={() => setRange("today")}
            className={`font-mono text-xs px-3 py-1.5 rounded-full border transition-colors ${
              range === "today" ? "bg-accent/10 border-accent text-accent" : "border-transparent text-textMuted"
            }`}
          >
            Hôm nay
          </button>
          <button
            onClick={() => setRange("7d")}
            className={`font-mono text-xs px-3 py-1.5 rounded-full border transition-colors ${
              range === "7d" ? "bg-accent/10 border-accent text-accent" : "border-transparent text-textMuted"
            }`}
          >
            7 ngày
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 items-start">
        <div className="rounded-lg border border-border bg-surface/75 backdrop-blur-md px-5 py-5 flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="text-accent">
              <path d="M3 17 9 11 13 15 21 7M21 7h-6M21 7v6" />
            </svg>
            <span className="text-[13px] font-semibold text-textPrimary">Từ khoá nổi bật (HN + News)</span>
          </div>
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
                <span className="font-mono tabular-nums text-[11px] text-textMuted">{k.mentions}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-lg border border-border bg-surface/75 backdrop-blur-md px-5 py-5 flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="text-accent">
              <circle cx="12" cy="12" r="9" />
              <path d="M14.5 9.5c0-1.1-1.1-2-2.5-2s-2.5.8-2.5 1.9c0 2.6 5 1.4 5 4 0 1.1-1.1 1.9-2.5 1.9s-2.5-.9-2.5-2" />
              <path d="M12 6.5v1M12 16v1" />
            </svg>
            <span className="text-[13px] font-semibold text-textPrimary">Crypto: mentions ↔ biến động giá</span>
          </div>
          <div className="flex flex-col gap-3">
            {data.cryptoMentions.map((c) => (
              <div key={c.coinId} className="flex items-center justify-between">
                <span className="text-xs text-textSecondary">{c.coinId}</span>
                <span className="font-mono tabular-nums text-[11px] text-textMuted">{c.mentionCount} mentions</span>
                <span className={`font-mono tabular-nums text-xs ${c.change24hPct >= 0 ? "text-success" : "text-error"}`}>
                  {c.change24hPct >= 0 ? "+" : ""}
                  {c.change24hPct.toFixed(1)}%
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-lg border border-border bg-surface/75 backdrop-blur-md px-5 py-5 flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="text-accent">
              <circle cx="9" cy="12" r="6" />
              <circle cx="15" cy="12" r="6" />
            </svg>
            <span className="text-[13px] font-semibold text-textPrimary">GitHub Trending ↔ HN overlap</span>
          </div>
          <div className="flex flex-col gap-2.5">
            {data.githubHnOverlap.map((o) => (
              <div key={o.keyword} className="flex items-center gap-2">
                <span className="font-mono tabular-nums w-5 text-[11px] text-textMuted text-right">{o.overlapCount}</span>
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

        <div className="rounded-lg border border-border bg-surface/75 backdrop-blur-md px-5 py-5 flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="text-accent">
              <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" />
            </svg>
            <span className="text-[13px] font-semibold text-textPrimary">
              Thời tiết · {data.weatherSnapshot.length} khu vực
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2.5">
            {data.weatherSnapshot.map((w) => (
              <div key={w.location} className="rounded-lg border border-border bg-bg px-3 py-2.5">
                <span className="text-[11px] text-textSecondary">{w.location}</span>
                <div className="font-mono tabular-nums text-base text-textPrimary">{w.temperatureC.toFixed(0)}°C</div>
                <span className="text-[10.5px] text-textMuted">độ ẩm <span className="tabular-nums">{w.humidityPct.toFixed(0)}%</span></span>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-lg border border-border bg-surface/75 backdrop-blur-md px-5 py-5 flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="text-accent">
              <path d="M16 18 22 12 16 6" />
              <path d="M8 6 2 12 8 18" />
            </svg>
            <span className="text-[13px] font-semibold text-textPrimary">Ngôn ngữ nổi bật trên GitHub</span>
          </div>
          <div className="flex flex-col gap-2.5">
            {data.githubLanguages.map((l, i) => (
              <div key={l.language} className="flex items-center gap-2.5">
                <span className="w-20 text-[11.5px] text-textSecondary">{l.language}</span>
                <div className="flex-grow h-2 rounded bg-border">
                  <div
                    className={`h-full rounded ${i === 0 ? "bg-accent" : "bg-textMuted"}`}
                    style={{ width: `${(l.repoCount / maxLanguages) * 100}%` }}
                  />
                </div>
                <span className="font-mono tabular-nums text-[11px] text-textMuted">{l.repoCount}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-lg border border-border bg-surface/75 backdrop-blur-md px-5 py-5 flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="text-accent">
              <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
            </svg>
            <span className="text-[13px] font-semibold text-textPrimary">Story nổi bật nhất (HN)</span>
          </div>
          {data.hnSpotlight ? (
            <div className="flex flex-col gap-2">
              <a
                href={data.hnSpotlight.url}
                target="_blank"
                rel="noreferrer"
                className="text-[15px] leading-snug font-semibold text-textPrimary transition-colors hover:text-accent"
              >
                {data.hnSpotlight.title}
              </a>
              <span className="font-mono tabular-nums text-[11px] text-textMuted">
                {data.hnSpotlight.score} điểm · {data.hnSpotlight.comments} bình luận · {data.hnSpotlight.author}
              </span>
            </div>
          ) : (
            <span className="text-[11px] text-textMuted">Chưa có story nào.</span>
          )}
        </div>

        <div className="rounded-lg border border-border bg-surface/75 backdrop-blur-md px-5 py-5 flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="text-accent">
              <path d="M12 2 15.09 8.26 22 9.27 17 14.14 18.18 21 12 17.77 5.82 21 7 14.14 2 9.27 8.91 8.26 12 2Z" />
            </svg>
            <span className="text-[13px] font-semibold text-textPrimary">Repo nhiều sao nhất trên GitHub</span>
          </div>
          <div className="flex flex-col gap-2.5">
            {data.githubStars.map((r, i) => (
              <div key={r.fullName} className="flex items-center gap-2.5">
                <span className="w-32 text-[11.5px] text-textSecondary">{r.fullName}</span>
                <div className="flex-grow h-2 rounded bg-border">
                  <div
                    className={`h-full rounded ${i === 0 ? "bg-accent" : "bg-textMuted"}`}
                    style={{ width: `${(r.stars / maxStars) * 100}%` }}
                  />
                </div>
                <span className="font-mono tabular-nums text-[11px] text-textMuted">{r.stars}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-lg border border-border bg-surface/75 backdrop-blur-md px-5 py-5 flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="text-accent">
              <line x1="6" y1="20" x2="6" y2="14" />
              <line x1="12" y1="20" x2="12" y2="4" />
              <line x1="18" y1="20" x2="18" y2="10" />
            </svg>
            <span className="text-[13px] font-semibold text-textPrimary">Crypto: vốn hoá & khối lượng giao dịch</span>
          </div>
          <div className="flex flex-col gap-3">
            {data.cryptoRanking.map((c) => (
              <div key={c.coinId} className="flex items-center justify-between">
                <span className="text-xs text-textSecondary">{c.coinId}</span>
                <span className="font-mono tabular-nums text-[11px] text-textMuted">
                  KL {formatUsdCompact(c.volume24hUsd)}
                </span>
                <span className="font-mono tabular-nums text-xs text-textPrimary">
                  {formatUsdCompact(c.marketCapUsd)}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-lg border border-border bg-surface/75 backdrop-blur-md px-5 py-5 flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="text-accent">
              <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
            </svg>
            <span className="text-[13px] font-semibold text-textPrimary">Story gây tranh cãi nhất (HN)</span>
          </div>
          {data.hnControversial ? (
            <div className="flex flex-col gap-2">
              <a
                href={data.hnControversial.url}
                target="_blank"
                rel="noreferrer"
                className="text-[15px] leading-snug font-semibold text-textPrimary transition-colors hover:text-accent"
              >
                {data.hnControversial.title}
              </a>
              <span className="font-mono tabular-nums text-[11px] text-textMuted">
                {data.hnControversial.comments} bình luận / {data.hnControversial.score} điểm (tỉ lệ{" "}
                {(data.hnControversial.comments / data.hnControversial.score).toFixed(1)}) · {data.hnControversial.author}
              </span>
            </div>
          ) : (
            <span className="text-[11px] text-textMuted">Chưa có story nào.</span>
          )}
        </div>
      </div>
    </div>
  );
}
