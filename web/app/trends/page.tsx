"use client";

import { useEffect, useState } from "react";
import type { TrendsResponse } from "@/lib/types";

/** Picks the English noun form; the counts here are labelled in English. */
function pluralize(count: number, singular: string, plural: string): string {
  return count === 1 ? singular : plural;
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
      <div className="p-9 flex flex-col gap-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-20 rounded-lg border border-border bg-surface animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div className="p-9 flex flex-col gap-5">
      <h1 className="font-heading text-2xl font-semibold text-textPrimary">Trend Events</h1>

      {data.events.length === 0 ? (
        <div className="rounded-lg border border-border bg-surface/75 backdrop-blur-md px-5 py-8 text-center">
          <span className="text-[13px] text-textMuted">
            Chưa có sự kiện xu hướng nào -- sẽ xuất hiện sau lần quét hằng ngày đầu tiên.
          </span>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {data.events.map((event) => (
            <div
              key={event.eventId}
              className="rounded-lg border border-border bg-surface/75 backdrop-blur-md px-5 py-4 flex items-center justify-between gap-4"
            >
              <div className="flex flex-col gap-1">
                <span className="font-mono text-[11px] text-textMuted">{event.eventDate}</span>
                <span className="text-[15px] font-semibold text-textPrimary">{event.keyword}</span>
              </div>
              <span className="font-mono tabular-nums text-[11px] text-textMuted text-right">
                GitHub: {event.githubCount} {pluralize(event.githubCount, "repo", "repos")} · HN:{" "}
                {event.hnCount} {pluralize(event.hnCount, "story", "stories")} · News:{" "}
                {event.newsCount} {pluralize(event.newsCount, "article", "articles")}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
