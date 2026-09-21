"use client";

import { useEffect, useRef, useState } from "react";
import type { WeatherLocation, WeatherResponse, WeatherHistoryResponse } from "@/lib/types";
import { projectLatLng, WEATHER_BOUNDS } from "@/lib/mapProjection";
import { temperatureBand } from "@/lib/weatherMeta";

const VIEW_BOX = { width: 600, height: 600 };
const PADDING = 40;
const DEFAULT_LOCATION = "Da Lat";

const BAND_COLOR: Record<"cool" | "moderate" | "hot", string> = {
  cool: "#38BDF8",
  moderate: "#FBBF24",
  hot: "#FB7185",
};

// Decorative land-shape background, reused verbatim from the mockup --
// not a geographically accurate coastline (no real Vietnam GeoJSON in
// this project). Only pin positions (via projectLatLng) are real.
const LAND_PATH =
  "M -20,-20 L 620,-20 L 620,220 C 540,250 490,300 460,360 C 430,420 460,460 420,520 C 380,580 300,610 200,615 L -20,615 Z";

function formatMinutesAgo(observedAt: string): string {
  // observedAt is naive Vietnam local time (UTC+7, no offset suffix) --
  // parsing it with a "Z" suffix gives an instant 7h ahead of its real
  // UTC instant, so shift that back out before diffing against the real
  // current time. Same convention as dateRange.ts's hoursAgoAsObservedAtLocal.
  const observedUtcMs = new Date(`${observedAt}Z`).getTime() - 7 * 60 * 60 * 1000;
  const minutes = Math.max(0, Math.round((Date.now() - observedUtcMs) / 60000));
  return `Cập nhật ${minutes} phút trước`;
}

export default function WeatherPage() {
  const [data, setData] = useState<WeatherResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string>(DEFAULT_LOCATION);
  const [history, setHistory] = useState<WeatherHistoryResponse | null>(null);
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
        if (!ok) return; // history is secondary -- don't blow up the whole page over it
        setHistory(body);
      })
      .catch(() => {
        /* history is secondary -- silently keep the last-good sparkline */
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
      <div className="p-9 flex flex-col gap-4">
        <div className="h-[600px] rounded-2xl border border-border bg-surface animate-pulse" />
      </div>
    );
  }

  const selectedReading = data.locations.find((l) => l.location === selected) ?? data.locations[0];
  const ranked = [...data.locations].sort((a, b) => b.temperatureC - a.temperatureC);
  const mostRecentObservedAt = data.locations.reduce(
    (latest, l) => (l.observedAt > latest ? l.observedAt : latest),
    data.locations[0]?.observedAt ?? ""
  );

  const sparkPoints = history?.points ?? [];
  const temps = sparkPoints.map((p) => p.avgTemperatureC);
  const minTemp = temps.length ? Math.min(...temps) : 0;
  const maxTemp = temps.length ? Math.max(...temps) : 1;
  const tempRange = maxTemp - minTemp || 1;
  const sparkPolyline = sparkPoints
    .map((p, i) => {
      const x = sparkPoints.length > 1 ? (i / (sparkPoints.length - 1)) * 216 + 4 : 110;
      const y = 42 - ((p.avgTemperatureC - minTemp) / tempRange) * 36 + 2;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <div className="p-9 flex flex-col gap-4">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="font-heading text-2xl font-semibold text-textPrimary">Thời tiết miền Nam</h1>
          <p className="mt-1.5 text-sm text-textSecondary">
            12 tỉnh/thành · Open-Meteo, không cần API key · làm mới mỗi 10 phút
          </p>
        </div>
        {mostRecentObservedAt && (
          <span className="font-mono text-[11px] px-3 py-1.5 rounded-full bg-accent/10 text-accent">
            {formatMinutesAgo(mostRecentObservedAt)}
          </span>
        )}
      </div>

      <div className="flex gap-4 flex-grow min-h-0">
        <div className="flex-[1.55] rounded-2xl border border-border bg-surface p-5 flex flex-col gap-3 min-h-0">
          <div className="relative flex-grow rounded-xl bg-bg overflow-hidden">
            <svg viewBox={`0 0 ${VIEW_BOX.width} ${VIEW_BOX.height}`} className="w-full h-full block">
              <rect x="0" y="0" width={VIEW_BOX.width} height={VIEW_BOX.height} fill="#0A1730" />
              <path d={LAND_PATH} fill="#152238" />
              {ranked.map((loc) => {
                const p = projectLatLng(loc, WEATHER_BOUNDS, VIEW_BOX, PADDING);
                const band = temperatureBand(loc.temperatureC);
                const isSelected = loc.location === selected;
                return (
                  <g key={loc.location} onClick={() => setSelected(loc.location)} style={{ cursor: "pointer" }}>
                    {isSelected && <circle cx={p.x} cy={p.y} r={15} fill={BAND_COLOR[band]} fillOpacity={0.14} />}
                    <circle cx={p.x} cy={p.y} r={isSelected ? 7 : 5} fill={BAND_COLOR[band]} stroke="#0A1730" strokeWidth={1} />
                    {isSelected && (
                      <text x={p.x} y={p.y - 14} textAnchor="middle" fill="#F2F5FB" fontSize="12.5">
                        {loc.location} · {loc.temperatureC.toFixed(0)}°C
                      </text>
                    )}
                  </g>
                );
              })}
            </svg>
            {/* Decorative chrome only, matching the mockup -- no pan/zoom logic (see plan's Global Constraints) */}
            <div className="absolute top-3.5 right-3.5 w-[30px] h-[30px] rounded-lg bg-surface border border-border flex items-center justify-center">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#93A0C2" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 19V5M5 12l7-7 7 7" />
              </svg>
            </div>
            <div className="absolute bottom-3.5 right-3.5 flex flex-col rounded-lg overflow-hidden border border-border">
              <span className="w-[30px] h-[28px] bg-surface text-textSecondary flex items-center justify-center text-base border-b border-border">+</span>
              <span className="w-[30px] h-[28px] bg-surface text-textSecondary flex items-center justify-center text-base">−</span>
            </div>
            <div className="absolute left-4 bottom-3.5 flex items-center gap-2">
              <div className="w-[34px] h-[2px] bg-textMuted" />
              <span className="font-mono text-[10px] text-textMuted">~80 km</span>
            </div>
          </div>
          <div className="flex items-center gap-4 px-0.5">
            <span className="flex items-center gap-1.5 text-[11.5px] text-textSecondary">
              <span className="w-2 h-2 rounded-full inline-block" style={{ background: BAND_COLOR.cool }} />
              Mát (&lt;22°C)
            </span>
            <span className="flex items-center gap-1.5 text-[11.5px] text-textSecondary">
              <span className="w-2 h-2 rounded-full inline-block" style={{ background: BAND_COLOR.moderate }} />
              Vừa (22–30°C)
            </span>
            <span className="flex items-center gap-1.5 text-[11.5px] text-textSecondary">
              <span className="w-2 h-2 rounded-full inline-block" style={{ background: BAND_COLOR.hot }} />
              Nóng (&gt;30°C)
            </span>
          </div>
        </div>

        <div className="flex-1 flex flex-col gap-4 min-h-0">
          {selectedReading && (
            <div className="rounded-2xl border border-border bg-surface px-5 py-5 flex flex-col gap-3.5">
              <div className="flex justify-between items-baseline">
                <span className="text-sm font-semibold text-textPrimary">{selectedReading.location}</span>
                <span className="font-mono text-2xl text-accent">{selectedReading.temperatureC.toFixed(0)}°C</span>
              </div>
              <div className="grid grid-cols-3 gap-2.5">
                <div className="flex flex-col gap-0.5">
                  <span className="text-[10.5px] text-textMuted">Độ ẩm</span>
                  <span className="font-mono text-[13px] text-textSecondary">{selectedReading.humidityPct.toFixed(0)}%</span>
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="text-[10.5px] text-textMuted">Mưa</span>
                  <span className="font-mono text-[13px] text-textSecondary">{selectedReading.precipitationMm.toFixed(1)} mm</span>
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="text-[10.5px] text-textMuted">Gió</span>
                  <span className="font-mono text-[13px] text-textSecondary">{selectedReading.windSpeedKmh.toFixed(0)} km/h</span>
                </div>
              </div>
              <div>
                <span className="text-[10.5px] text-textMuted">24 giờ qua</span>
                {sparkPoints.length >= 2 ? (
                  <svg viewBox="0 0 220 46" className="w-full h-[46px] block mt-1">
                    <polyline points={sparkPolyline} fill="none" stroke="#38BDF8" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                ) : (
                  <p className="text-[11px] text-textMuted mt-1">Chưa đủ dữ liệu</p>
                )}
              </div>
            </div>
          )}

          <div className="rounded-2xl border border-border bg-surface px-5 py-4 flex flex-col gap-1 flex-grow min-h-0 overflow-auto">
            <span className="text-xs font-semibold text-textPrimary mb-1.5">12 tỉnh/thành · xếp theo nhiệt độ</span>
            {ranked.map((loc) => {
              const isSelected = loc.location === selected;
              return (
                <button
                  key={loc.location}
                  onClick={() => setSelected(loc.location)}
                  className={`flex items-center gap-2.5 px-1.5 py-1.5 rounded-lg text-left ${
                    isSelected ? "bg-accent/10 border border-accent/40" : ""
                  }`}
                >
                  <span
                    className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                    style={{ background: BAND_COLOR[temperatureBand(loc.temperatureC)] }}
                  />
                  <span className={`flex-grow text-xs ${isSelected ? "text-textPrimary font-semibold" : "text-textSecondary"}`}>
                    {loc.location}
                  </span>
                  <span className={`font-mono text-xs ${isSelected ? "text-accent" : "text-textPrimary"}`}>
                    {loc.temperatureC.toFixed(0)}°C
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
