"use client";

import { useEffect, useState } from "react";
import type { TrendEvent, TrendsResponse } from "@/lib/types";
import { KpiCard } from "@/components/KpiCard";
import { CardIcon } from "@/components/SectionCard";
import { StackedBar } from "@/components/StackedBar";

/** Source colours: dataviz categorical slots 1-3 (dark mode), validated for colour-blind separation. */
const SOURCES = [
  { key: "githubCount", label: "GitHub", singular: "repo", plural: "repos", color: "#3987e5" },
  { key: "hnCount", label: "HN", singular: "story", plural: "stories", color: "#d95926" },
  { key: "newsCount", label: "News", singular: "article", plural: "articles", color: "#199e70" },
] as const;

/** Picks the English noun form; the counts here are labelled in English. */
function pluralize(count: number, singular: string, plural: string): string {
  return count === 1 ? singular : plural;
}

function totalOf(event: TrendEvent): number {
  return event.githubCount + event.hnCount + event.newsCount;
}

/** True when the daily scan found the keyword in all three sources. */
function isCrossSource(event: TrendEvent): boolean {
  return event.githubCount > 0 && event.hnCount > 0 && event.newsCount > 0;
}

/** "2026-10-05" -> "05/10/2026"; falls back to the raw string for unexpected formats. */
function formatDate(date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(date);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : date;
}

/** Keywords the daily trend scan found in GitHub, HN and News on the same day. */
export default function TrendsPage() {
  const [data, setData] = useState<TrendsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setError(null);
    try {
      const res = await fetch("/api/trends");
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Không tải được Trends.");
      setData(body);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không tải được Trends.");
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
          onClick={() => load()}
          className="w-fit rounded-lg border border-border px-4 py-2 text-sm text-textPrimary"
        >
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
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-24 rounded-xl border border-border bg-surface animate-pulse" />
        ))}
      </div>
    );
  }

  const events = [...data.events].sort((a, b) => b.eventDate.localeCompare(a.eventDate));
  const maxTotal = Math.max(1, ...events.map(totalOf));
  const hottest = events.reduce<TrendEvent | null>((best, e) => (!best || totalOf(e) > totalOf(best) ? e : best), null);
  const crossCount = events.filter(isCrossSource).length;

  const days: { date: string; items: TrendEvent[] }[] = [];
  for (const event of events) {
    const last = days[days.length - 1];
    if (last && last.date === event.eventDate) last.items.push(event);
    else days.push({ date: event.eventDate, items: [event] });
  }

  return (
    <div className="p-6 lg:p-9 flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="font-heading text-3xl font-semibold tracking-tight text-textPrimary">Trend Events</h1>
        <p className="text-[13px] text-textMuted">
          Từ khoá xuất hiện đồng thời trên GitHub, Hacker News và tin tức trong lần quét hằng ngày.
        </p>
      </div>

      {events.length === 0 ? (
        <div className="rounded-xl border border-border bg-surface/75 backdrop-blur-md px-5 py-10 text-center">
          <span className="text-[13px] text-textMuted">
            Chưa có sự kiện xu hướng nào -- sẽ xuất hiện sau lần quét hằng ngày đầu tiên.
          </span>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <KpiCard
              label="Sự kiện đã ghi nhận"
              value={String(events.length)}
              hint={`trong ${days.length} ngày quét`}
              icon={<CardIcon d="M13 2 3 14h9l-1 8 10-12h-9l1-8z" />}
            />
            <KpiCard
              label="Từ khoá sôi động nhất"
              value={hottest?.keyword ?? "—"}
              hint={hottest ? `${totalOf(hottest)} mục · ${formatDate(hottest.eventDate)}` : undefined}
              icon={<CardIcon d="M3 17 9 11 13 15 21 7M21 7h-6M21 7v6" />}
            />
            <KpiCard
              label="Xuất hiện ở cả 3 nguồn"
              value={String(crossCount)}
              hint={`${Math.round((crossCount / events.length) * 100)}% số sự kiện`}
              hintColor={crossCount > 0 ? "success" : "muted"}
              icon={<CardIcon d={["M3 12a6 6 0 1 0 12 0 6 6 0 0 0-12 0z", "M9 12a6 6 0 1 0 12 0 6 6 0 0 0-12 0z"]} />}
            />
          </div>

          <ul className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-[12px] text-textSecondary" aria-label="Chú giải nguồn">
            {SOURCES.map((s) => (
              <li key={s.key} className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: s.color }} />
                {s.label}
              </li>
            ))}
          </ul>

          <div className="flex flex-col">
            {days.map((day) => (
              <div key={day.date} className="grid grid-cols-[auto_1fr] gap-x-4 sm:gap-x-6">
                <div className="flex flex-col items-center">
                  <span className="mt-1.5 h-3 w-3 rounded-full bg-accent shadow-glowCyan" />
                  <span className="w-px flex-grow bg-border" />
                </div>
                <div className="flex flex-col gap-3 pb-8">
                  <h2 className="text-sm font-semibold tabular-nums text-textPrimary">{formatDate(day.date)}</h2>
                  {day.items.map((event) => (
                    <article
                      key={event.eventId}
                      className="rounded-xl border border-border bg-surface/75 backdrop-blur-md px-5 py-4 flex flex-col gap-3 transition-colors hover:border-accent/30"
                    >
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <span className="text-base font-semibold text-textPrimary">{event.keyword}</span>
                        {isCrossSource(event) && (
                          <span className="rounded-full bg-success/15 px-2.5 py-0.5 text-[11px] font-semibold text-success">
                            Cả 3 nguồn
                          </span>
                        )}
                        <span className="ml-auto text-[12px] font-semibold tabular-nums text-textSecondary">
                          {totalOf(event)} mục
                        </span>
                      </div>
                      <StackedBar
                        widthPct={(totalOf(event) / maxTotal) * 100}
                        segments={SOURCES.map((s) => ({ label: s.label, value: event[s.key], color: s.color }))}
                      />
                      <ul className="flex flex-wrap gap-x-5 gap-y-1 text-[12px] tabular-nums text-textMuted">
                        {SOURCES.map((s) => (
                          <li key={s.key} className="flex items-center gap-1.5">
                            <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: s.color }} />
                            {s.label}: {event[s.key]} {pluralize(event[s.key], s.singular, s.plural)}
                          </li>
                        ))}
                      </ul>
                    </article>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
