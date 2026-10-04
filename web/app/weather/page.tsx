"use client";

import { useEffect, useRef, useState } from "react";
import type { WeatherResponse, WeatherHistoryResponse } from "@/lib/types";
import { temperatureBand, VIETNAM_UTC_OFFSET_HOURS } from "@/lib/weatherMeta";
import { KpiCard } from "@/components/KpiCard";
import { CardIcon, SectionCard } from "@/components/SectionCard";
import { BAND_COLOR, WeatherMap } from "@/components/WeatherMap";

const DEFAULT_LOCATION = "Da Lat";

const BAND_LEGEND = [
  { band: "cool", label: "Mát (<22°C)" },
  { band: "moderate", label: "Vừa (22–30°C)" },
  { band: "hot", label: "Nóng (>30°C)" },
] as const;

/**
 * `observedAt` is naive Vietnam local time (UTC+7, no offset). Parsing it as
 * UTC lands 7h late, so the offset is subtracted before comparing with now
 * (same convention as hoursAgoAsObservedAtLocal in lib/dateRange.ts).
 */
function formatMinutesAgo(observedAt: string): string {
  const observedUtcMs = new Date(`${observedAt}Z`).getTime() - VIETNAM_UTC_OFFSET_HOURS * 60 * 60 * 1000;
  const diffMs = Date.now() - observedUtcMs;
  if (Number.isNaN(diffMs)) return "Không rõ thời gian cập nhật";
  const minutes = Math.max(0, Math.round(diffMs / 60000));
  return `Cập nhật ${minutes} phút trước`;
}

/** "HH:mm" out of a bucket string such as "2026-10-05 14:00:00"; empty when the format is unexpected. */
function hourLabel(bucket: string | undefined): string {
  const m = bucket ? /(\d{2}):\d{2}/.exec(bucket) : null;
  return m ? `${m[1]}h` : "";
}

/** 24h average-temperature area chart with min/max labels; needs at least two points. */
function Sparkline({ points }: { points: { hourBucket: string; avgTemperatureC: number }[] }) {
  if (points.length < 2) return <p className="text-[12px] text-textMuted">Chưa đủ dữ liệu</p>;
  const temps = points.map((p) => p.avgTemperatureC);
  const min = Math.min(...temps);
  const max = Math.max(...temps);
  const range = max - min || 1; // a flat series must not divide by zero
  const W = 300;
  const H = 80;
  const coords = points.map((p, i) => {
    const x = (i / (points.length - 1)) * W;
    const y = H - 6 - ((p.avgTemperatureC - min) / range) * (H - 14);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const line = `M ${coords.join(" L ")}`;
  return (
    <div className="flex flex-col gap-1.5">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="block h-20 w-full" role="img" aria-label={`Nhiệt độ 24 giờ qua, từ ${min.toFixed(0)} đến ${max.toFixed(0)} độ C`}>
        <defs>
          <linearGradient id="sparkFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#38BDF8" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#38BDF8" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={`${line} L ${W},${H} L 0,${H} Z`} fill="url(#sparkFill)" />
        <path d={line} fill="none" stroke="#38BDF8" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="flex justify-between text-[11px] tabular-nums text-textMuted">
        <span>{hourLabel(points[0].hourBucket)}</span>
        <span>
          thấp nhất {min.toFixed(0)}° · cao nhất {max.toFixed(0)}°
        </span>
        <span>{hourLabel(points[points.length - 1].hourBucket)}</span>
      </div>
    </div>
  );
}

/**
 * Map of current readings plus a 24h chart for the selected location.
 * Not linked from the sidebar, but still reachable by URL.
 */
export default function WeatherPage() {
  const [data, setData] = useState<WeatherResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string>(DEFAULT_LOCATION);
  const [history, setHistory] = useState<WeatherHistoryResponse | null>(null);
  // Guards against out-of-order history responses when clicking pins quickly.
  const latestSelectedRef = useRef<string>(DEFAULT_LOCATION);

  useEffect(() => {
    fetch("/api/weather")
      .then((res) => res.json().then((body) => ({ ok: res.ok, body })))
      .then(({ ok, body }) => {
        if (!ok) throw new Error(body.error ?? "Không tải được thời tiết.");
        setData(body);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Không tải được thời tiết."));
  }, []);

  useEffect(() => {
    latestSelectedRef.current = selected;
    fetch(`/api/weather/history?location=${encodeURIComponent(selected)}`)
      .then((res) => res.json().then((body) => ({ ok: res.ok, body })))
      .then(({ ok, body }) => {
        if (latestSelectedRef.current !== selected) return; // superseded by a newer selection
        if (!ok) return; // secondary: keep the last good chart
        setHistory(body);
      })
      .catch(() => {
        /* secondary: keep the last good chart */
      });
  }, [selected]);

  if (error) {
    return (
      <div className="p-9 flex flex-col gap-4">
        <p className="text-error text-sm">{error}</p>
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
        <div className="h-[420px] rounded-xl border border-border bg-surface animate-pulse" />
      </div>
    );
  }

  const selectedReading = data.locations.find((l) => l.location === selected) ?? data.locations[0];
  const ranked = [...data.locations].sort((a, b) => b.temperatureC - a.temperatureC);
  const hottest = ranked[0];
  const coolest = ranked[ranked.length - 1];
  const avgTemp = ranked.length ? ranked.reduce((s, l) => s + l.temperatureC, 0) / ranked.length : null;
  const totalRain = ranked.reduce((s, l) => s + l.precipitationMm, 0);
  const rainyCount = ranked.filter((l) => l.precipitationMm > 0).length;
  const maxT = hottest?.temperatureC ?? 0;
  const minT = coolest?.temperatureC ?? 0;
  const mostRecentObservedAt = data.locations.reduce(
    (latest, l) => (l.observedAt > latest ? l.observedAt : latest),
    data.locations[0]?.observedAt ?? "",
  );

  return (
    <div className="p-6 lg:p-9 flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="font-heading text-3xl font-semibold tracking-tight text-textPrimary">Thời tiết miền Nam</h1>
          <p className="text-[13px] text-textMuted">
            {data.locations.length} tỉnh/thành · Open-Meteo, không cần API key · làm mới mỗi 30 phút
          </p>
        </div>
        {mostRecentObservedAt && (
          <span className="rounded-full bg-accent/10 px-3 py-1.5 text-[12px] text-accentBright">
            {formatMinutesAgo(mostRecentObservedAt)}
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          label="Nóng nhất"
          value={hottest ? `${hottest.temperatureC.toFixed(0)}°C` : "—"}
          hint={hottest?.location}
          icon={<CardIcon d="M14 14.76V3.5a2.5 2.5 0 0 0-5 0v11.26a4.5 4.5 0 1 0 5 0z" />}
        />
        <KpiCard
          label="Mát nhất"
          value={coolest ? `${coolest.temperatureC.toFixed(0)}°C` : "—"}
          hint={coolest?.location}
          icon={<CardIcon d="M14 14.76V3.5a2.5 2.5 0 0 0-5 0v11.26a4.5 4.5 0 1 0 5 0z" />}
        />
        <KpiCard
          label="Nhiệt độ trung bình"
          value={avgTemp === null ? "—" : `${avgTemp.toFixed(1)}°C`}
          hint={`${data.locations.length} tỉnh/thành`}
          icon={<CardIcon d="M3 17 9 11 13 15 21 7" />}
        />
        <KpiCard
          label="Tổng lượng mưa"
          value={`${totalRain.toFixed(1)} mm`}
          hint={`${rainyCount} tỉnh đang có mưa`}
          icon={<CardIcon d={["M16 13v8", "M8 13v8", "M12 15v8", "M20 16.58A5 5 0 0 0 18 7h-1.26A8 8 0 1 0 4 15.25"]} />}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1.5fr_1fr] gap-4 items-start">
        <SectionCard title="Bản đồ nhiệt độ" icon={<CardIcon d={["M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z", "M12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z"]} />}>
          <WeatherMap locations={data.locations} selected={selectedReading?.location ?? selected} onSelect={setSelected} />
          <ul className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-[12px] text-textSecondary" aria-label="Chú giải nhiệt độ">
            {BAND_LEGEND.map((b) => (
              <li key={b.band} className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: BAND_COLOR[b.band] }} />
                {b.label}
              </li>
            ))}
          </ul>
        </SectionCard>

        <div className="flex flex-col gap-4">
          {selectedReading && (
            <SectionCard title={selectedReading.location} meta="đang chọn" icon={<CardIcon d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" />}>
              <div className="flex items-baseline gap-2">
                <span className="text-4xl font-semibold tabular-nums text-textPrimary">{selectedReading.temperatureC.toFixed(0)}°C</span>
                <span className="text-[12px] text-textMuted">hiện tại</span>
              </div>
              <dl className="grid grid-cols-3 gap-2">
                {[
                  ["Độ ẩm", `${selectedReading.humidityPct.toFixed(0)}%`],
                  ["Mưa", `${selectedReading.precipitationMm.toFixed(1)} mm`],
                  ["Gió", `${selectedReading.windSpeedKmh.toFixed(0)} km/h`],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-lg bg-bg/70 px-3 py-2.5">
                    <dd className="text-[15px] font-semibold tabular-nums text-textPrimary">{value}</dd>
                    <dt className="text-[11px] text-textMuted">{label}</dt>
                  </div>
                ))}
              </dl>
              <div className="flex flex-col gap-2">
                <span className="text-[12px] text-textSecondary">24 giờ qua</span>
                <Sparkline points={history?.points ?? []} />
              </div>
            </SectionCard>
          )}

          <SectionCard title="Xếp theo nhiệt độ" meta={`${ranked.length} tỉnh/thành`} icon={<CardIcon d="M3 6h18M3 12h12M3 18h6" />}>
            <div className="flex flex-col gap-1">
              {ranked.map((loc) => {
                const isSelected = loc.location === selectedReading?.location;
                const color = BAND_COLOR[temperatureBand(loc.temperatureC)];
                const pct = maxT === minT ? 100 : 12 + ((loc.temperatureC - minT) / (maxT - minT)) * 88;
                return (
                  <button
                    key={loc.location}
                    onClick={() => setSelected(loc.location)}
                    aria-pressed={isSelected}
                    className={`flex items-center gap-3 rounded-lg border px-2.5 py-2 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent ${
                      isSelected ? "border-accent/40 bg-accent/10" : "border-transparent hover:bg-white/[0.03]"
                    }`}
                  >
                    <span className={`w-36 shrink-0 truncate text-[12px] ${isSelected ? "font-semibold text-textPrimary" : "text-textSecondary"}`} title={loc.location}>
                      {loc.location}
                    </span>
                    <span className="h-1.5 flex-grow rounded-full bg-white/[0.05]">
                      <span className="bar-grow block h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
                    </span>
                    <span className="w-10 shrink-0 text-right text-[12px] font-semibold tabular-nums text-textPrimary">
                      {loc.temperatureC.toFixed(0)}°C
                    </span>
                  </button>
                );
              })}
            </div>
          </SectionCard>
        </div>
      </div>
    </div>
  );
}
