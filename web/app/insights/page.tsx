"use client";

import { useEffect, useRef, useState } from "react";
import type { InsightsResponse } from "@/lib/types";
import { weatherIconGroup, WEATHER_ICON_PATHS } from "@/lib/weatherIcons";
import { cryptoTicker } from "@/lib/cryptoIcons";
import { KpiCard } from "@/components/KpiCard";
import { CardIcon, SectionCard } from "@/components/SectionCard";
import { SpotlightCard } from "@/components/SpotlightCard";
import { StackedBar } from "@/components/StackedBar";

/** Maps a WMO weather code to one of a few icon groups. */
function WeatherIcon({ code }: { code: number }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="text-accent shrink-0"
    >
      <path d={WEATHER_ICON_PATHS[weatherIconGroup(code)]} />
    </svg>
  );
}

function CryptoTickerBadge({ coinId }: { coinId: string }) {
  const { symbol, colorClass } = cryptoTicker(coinId);
  return (
    <span className={`flex h-7 w-7 items-center justify-center rounded-full bg-white/[0.05] text-[10px] font-semibold ${colorClass}`}>
      {symbol}
    </span>
  );
}

type Range = "today" | "7d";

/** Compact USD ($1.2B, $3.40T) for market caps and volumes that span many magnitudes. */
function formatUsdCompact(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1e12) return `$${(value / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `$${(value / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `$${(value / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `$${(value / 1e3).toFixed(1)}K`;
  return `$${value.toFixed(2)}`;
}

/** Compact count (1.2K, 3.4M) for star totals. */
function formatCountCompact(value: number): string {
  if (value >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
  if (value >= 1e3) return `${(value / 1e3).toFixed(1)}K`;
  return String(value);
}

/** Categorical slots from the dataviz palette (dark mode), in fixed order; extra languages fold into "Khác". */
const LANGUAGE_COLORS = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#9085e9"];
const OTHER_COLOR = "#5b6572";

/** Horizontal rank row: label, proportional bar (top row highlighted) and value. */
function RankRow({
  label,
  value,
  max,
  display,
  lead,
  labelWidth = "w-24",
}: {
  label: string;
  value: number;
  max: number;
  display?: string;
  lead?: React.ReactNode;
  labelWidth?: string;
}) {
  const isTop = value === max;
  return (
    <div className="flex items-center gap-3">
      {lead}
      <span className={`${labelWidth} shrink-0 truncate text-[12px] text-textSecondary`} title={label}>
        {label}
      </span>
      <div className="h-2 flex-grow rounded-full bg-white/[0.04]">
        <div
          className={`bar-grow h-full rounded-full ${
            isTop ? "bg-gradient-to-r from-accent to-accentBright shadow-glowCyan" : "bg-accent/40"
          }`}
          style={{ width: `${Math.max(2, (value / max) * 100)}%` }}
        />
      </div>
      <span className="w-12 shrink-0 text-right text-[12px] font-semibold tabular-nums text-textPrimary">
        {display ?? value}
      </span>
    </div>
  );
}

/** Cross-source trend dashboard (HN, News, GitHub, crypto, weather) for today or the last 7 days. */
export default function InsightsPage() {
  const [range, setRange] = useState<Range>("today");
  const [data, setData] = useState<InsightsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Guards against out-of-order responses when the range is toggled quickly.
  const latestRangeRef = useRef<Range>("today");

  async function load(r: Range) {
    latestRangeRef.current = r;
    setError(null);
    try {
      const res = await fetch(`/api/insights?range=${r}`);
      const body = await res.json();
      if (latestRangeRef.current !== r) return; // superseded by a newer range
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
      <div className="p-6 lg:p-9 flex flex-col gap-4">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-28 rounded-xl border border-border bg-surface animate-pulse" />
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-56 rounded-xl border border-border bg-surface animate-pulse" />
          ))}
        </div>
        <div className="h-72 rounded-xl border border-border bg-surface animate-pulse" />
      </div>
    );
  }

  const maxMentions = Math.max(1, ...data.topKeywords.map((k) => k.mentions));
  const maxOverlap = Math.max(1, ...data.githubHnOverlap.map((o) => o.overlapCount));
  const maxStars = Math.max(1, ...data.githubStars.map((r) => r.stars));

  // Crypto: one row per coin, joining the mentions/price feed with the market-cap ranking.
  const coinIds = Array.from(
    new Set([...data.cryptoMentions.map((c) => c.coinId), ...data.cryptoRanking.map((c) => c.coinId)]),
  );
  const coins = coinIds
    .map((coinId) => ({
      coinId,
      mention: data.cryptoMentions.find((c) => c.coinId === coinId),
      ranking: data.cryptoRanking.find((c) => c.coinId === coinId),
    }))
    .sort((a, b) => (b.ranking?.marketCapUsd ?? 0) - (a.ranking?.marketCapUsd ?? 0));
  const maxMarketCap = Math.max(1, ...coins.map((c) => c.ranking?.marketCapUsd ?? 0));
  const topMover = [...data.cryptoMentions].sort((a, b) => Math.abs(b.change24hPct) - Math.abs(a.change24hPct))[0];

  // Languages: top slots get a palette colour, the long tail folds into one muted segment.
  const topLanguages = data.githubLanguages.slice(0, LANGUAGE_COLORS.length);
  const restCount = data.githubLanguages.slice(LANGUAGE_COLORS.length).reduce((s, l) => s + l.repoCount, 0);
  const languageSegments = [
    ...topLanguages.map((l, i) => ({ label: l.language, value: l.repoCount, color: LANGUAGE_COLORS[i] })),
    ...(restCount > 0 ? [{ label: "Khác", value: restCount, color: OTHER_COLOR }] : []),
  ];
  const languageTotal = languageSegments.reduce((s, l) => s + l.value, 0);

  const topKeyword = data.topKeywords[0];

  return (
    <div className="p-6 lg:p-9 flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="font-heading text-3xl font-semibold tracking-tight text-textPrimary">Trending Insights</h1>
          <p className="text-[13px] text-textMuted">
            Công nghệ, tin tức và thị trường đang nói gì {range === "today" ? "hôm nay" : "trong 7 ngày qua"}.
          </p>
        </div>
        <div className="flex gap-1 rounded-full border border-border bg-surface/60 p-1" role="group" aria-label="Khoảng thời gian">
          {(["today", "7d"] as const).map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              aria-pressed={range === r}
              className={`rounded-full px-4 py-1.5 text-xs font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent ${
                range === r ? "bg-accent/15 text-accentBright" : "text-textMuted hover:text-textSecondary"
              }`}
            >
              {r === "today" ? "Hôm nay" : "7 ngày"}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          label="Từ khoá số 1"
          value={topKeyword?.keyword ?? "—"}
          hint={topKeyword ? `${topKeyword.mentions} lượt nhắc trên HN + News` : "Chưa có dữ liệu"}
          icon={<CardIcon d="M3 17 9 11 13 15 21 7M21 7h-6M21 7v6" />}
        />
        <KpiCard
          label="Coin biến động mạnh nhất"
          value={topMover ? cryptoTicker(topMover.coinId).symbol : "—"}
          hint={topMover ? `${topMover.change24hPct >= 0 ? "+" : ""}${topMover.change24hPct.toFixed(1)}% trong 24h` : "Chưa có dữ liệu"}
          hintColor={topMover && topMover.change24hPct >= 0 ? "success" : "muted"}
          icon={<CardIcon d="M22 12h-4l-3 9L9 3l-3 9H2" />}
        />
        <KpiCard
          label="Ngôn ngữ dẫn đầu GitHub"
          value={data.githubLanguages[0]?.language ?? "—"}
          hint={data.githubLanguages[0] ? `${data.githubLanguages[0].repoCount} repo · ${data.githubLanguages.length} ngôn ngữ` : "Chưa có dữ liệu"}
          icon={<CardIcon d={["M16 18 22 12 16 6", "M8 6 2 12 8 18"]} />}
        />
        <KpiCard
          label="Story HN cao điểm nhất"
          value={data.hnSpotlight ? `${data.hnSpotlight.score} điểm` : "—"}
          hint={data.hnSpotlight ? `${data.hnSpotlight.comments} bình luận` : "Chưa có dữ liệu"}
          icon={<CardIcon d="M12 2 15.09 8.26 22 9.27 17 14.14 18.18 21 12 17.77 5.82 21 7 14.14 2 9.27 8.91 8.26 12 2Z" />}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <SpotlightCard
          tone="orange"
          label="Nổi nhất trên Hacker News"
          title={data.hnSpotlight?.title}
          url={data.hnSpotlight?.url}
          emptyText="Chưa có story nào."
          stats={data.hnSpotlight ? [
            { label: "điểm", value: String(data.hnSpotlight.score) },
            { label: "bình luận", value: String(data.hnSpotlight.comments) },
          ] : undefined}
          footer={data.hnSpotlight && `Đăng bởi ${data.hnSpotlight.author}`}
        />
        <SpotlightCard
          tone="indigo"
          label="Tranh cãi nhất trên Hacker News"
          title={data.hnControversial?.title}
          url={data.hnControversial?.url}
          emptyText="Chưa có story nào."
          stats={data.hnControversial ? [
            { label: "bình luận", value: String(data.hnControversial.comments) },
            { label: "điểm", value: String(data.hnControversial.score) },
            { label: "tỉ lệ", value: (data.hnControversial.comments / Math.max(1, data.hnControversial.score)).toFixed(1) },
          ] : undefined}
          footer={data.hnControversial && `Đăng bởi ${data.hnControversial.author}`}
        />
        <SpotlightCard
          tone="cyan"
          label="Tin nổi bật"
          title={data.newsSpotlight?.title}
          url={data.newsSpotlight?.url}
          imageUrl={data.newsSpotlight?.imageUrl}
          emptyText="Chưa có tin nào."
          footer={data.newsSpotlight?.provider}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
        <SectionCard
          className="lg:col-span-2"
          title="Từ khoá nổi bật (HN + News)"
          meta={`${data.topKeywords.length} từ khoá`}
          icon={<CardIcon d="M3 17 9 11 13 15 21 7M21 7h-6M21 7v6" />}
        >
          <div className="flex flex-col gap-3">
            {data.topKeywords.map((k) => (
              <RankRow key={k.keyword} label={k.keyword} value={k.mentions} max={maxMentions} />
            ))}
          </div>
        </SectionCard>

        <SectionCard
          title="Crypto: giá và mức độ nhắc tới"
          icon={<CardIcon d={["M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z", "M12 6.5v1M12 16v1"]} />}
        >
          <div className="flex flex-col gap-4">
            {coins.map(({ coinId, mention, ranking }) => (
              <div key={coinId} className="flex flex-col gap-1.5">
                <div className="flex items-center gap-3">
                  <CryptoTickerBadge coinId={coinId} />
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate text-[13px] font-semibold capitalize text-textPrimary">{coinId}</span>
                    <span className="text-[11px] tabular-nums text-textMuted">
                      {mention ? `${mention.mentionCount} lượt nhắc` : "—"}
                      {ranking ? ` · KL ${formatUsdCompact(ranking.volume24hUsd)}` : ""}
                    </span>
                  </div>
                  <div className="ml-auto flex flex-col items-end">
                    <span className="text-[13px] font-semibold tabular-nums text-textPrimary">
                      {ranking ? formatUsdCompact(ranking.marketCapUsd) : "—"}
                    </span>
                    {mention && (
                      <span
                        className={`text-[11.5px] font-medium tabular-nums ${mention.change24hPct >= 0 ? "text-success" : "text-error"}`}
                      >
                        {mention.change24hPct >= 0 ? "▲" : "▼"} {Math.abs(mention.change24hPct).toFixed(1)}%
                      </span>
                    )}
                  </div>
                </div>
                <div className="h-1 rounded-full bg-white/[0.04]">
                  <div
                    className="bar-grow h-full rounded-full bg-secondary/70"
                    style={{ width: `${Math.max(2, ((ranking?.marketCapUsd ?? 0) / maxMarketCap) * 100)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </SectionCard>

        <SectionCard
          className="lg:col-span-2"
          title="Repo nhiều sao nhất trên GitHub"
          icon={<CardIcon d="M12 2 15.09 8.26 22 9.27 17 14.14 18.18 21 12 17.77 5.82 21 7 14.14 2 9.27 8.91 8.26 12 2Z" />}
        >
          <div className="flex flex-col gap-3">
            {data.githubStars.map((r) => (
              <RankRow
                key={r.fullName}
                label={r.fullName}
                value={r.stars}
                max={maxStars}
                display={formatCountCompact(r.stars)}
                labelWidth="w-44"
                lead={
                  r.avatarUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={r.avatarUrl}
                      alt=""
                      width={20}
                      height={20}
                      loading="lazy"
                      className="h-5 w-5 shrink-0 rounded-full"
                      onError={(e) => {
                        e.currentTarget.style.display = "none";
                      }}
                    />
                  ) : null
                }
              />
            ))}
          </div>
        </SectionCard>

        <SectionCard
          title="Ngôn ngữ nổi bật trên GitHub"
          icon={<CardIcon d={["M16 18 22 12 16 6", "M8 6 2 12 8 18"]} />}
        >
          <StackedBar segments={languageSegments} height={14} />
          <ul className="grid grid-cols-2 gap-x-4 gap-y-2">
            {languageSegments.map((l) => (
              <li key={l.label} className="flex items-center gap-2 text-[12px]">
                <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: l.color }} />
                <span className="truncate text-textSecondary">{l.label}</span>
                <span className="ml-auto tabular-nums text-textMuted">
                  {Math.round((l.value / Math.max(1, languageTotal)) * 100)}%
                </span>
              </li>
            ))}
          </ul>
        </SectionCard>

        <SectionCard
          title="GitHub Trending ↔ HN overlap"
          icon={<CardIcon d={["M3 12a6 6 0 1 0 12 0 6 6 0 0 0-12 0z", "M9 12a6 6 0 1 0 12 0 6 6 0 0 0-12 0z"]} />}
        >
          <div className="flex flex-col gap-3">
            {data.githubHnOverlap.map((o) => (
              <RankRow key={o.keyword} label={o.keyword} value={o.overlapCount} max={maxOverlap} />
            ))}
          </div>
        </SectionCard>

        <SectionCard
          className="lg:col-span-2"
          title="Thời tiết"
          meta={`${data.weatherSnapshot.length} khu vực`}
          icon={<CardIcon d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" />}
        >
          <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}>
            {data.weatherSnapshot.map((w) => (
              <div key={w.location} className="rounded-lg border border-border bg-bg/70 px-3.5 py-3">
                <div className="flex items-center justify-between">
                  <span className="truncate text-[12px] text-textSecondary">{w.location}</span>
                  <WeatherIcon code={w.weatherCode} />
                </div>
                <div className="mt-1 text-2xl font-semibold tabular-nums text-textPrimary">{w.temperatureC.toFixed(0)}°C</div>
                <span className="text-[11px] text-textMuted">
                  độ ẩm <span className="tabular-nums">{w.humidityPct.toFixed(0)}%</span>
                </span>
              </div>
            ))}
          </div>
        </SectionCard>
      </div>
    </div>
  );
}
