import type { WeatherLocation } from "@/lib/types";
import { projectLatLng, WEATHER_BOUNDS } from "@/lib/mapProjection";
import { temperatureBand } from "@/lib/weatherMeta";
import { BAND_COLOR } from "@/lib/weatherGeo";

const VIEW_BOX = { width: 600, height: 600 };
const PADDING = 40;

// Decorative land shape from the mockup, not a real coastline (the project
// has no Vietnam GeoJSON). Only the pin positions are geographically real.
const LAND_PATH =
  "M -20,-20 L 620,-20 L 620,220 C 540,250 490,300 460,360 C 430,420 460,460 420,520 C 380,580 300,610 200,615 L -20,615 Z";

type WeatherMapProps = {
  locations: WeatherLocation[];
  selected: string;
  onSelect: (location: string) => void;
};

/** SVG fallback map (used when there is no Mapbox token or it fails to load); square pin map of the readings; pins are keyboard-focusable and the selected one is drawn on top. */
export function WeatherMap({ locations, selected, onSelect }: WeatherMapProps) {
  // SVG has no z-index: draw the selected pin last so its halo and label sit on top.
  const ordered = [...locations.filter((l) => l.location !== selected), ...locations.filter((l) => l.location === selected)];
  return (
    <div className="mx-auto aspect-square w-full max-w-[560px] overflow-hidden rounded-xl bg-bg">
      <svg viewBox={`0 0 ${VIEW_BOX.width} ${VIEW_BOX.height}`} className="block h-full w-full" role="group" aria-label="Bản đồ nhiệt độ các tỉnh">
        <rect x="0" y="0" width={VIEW_BOX.width} height={VIEW_BOX.height} fill="#0A0E16" />
        <path d={LAND_PATH} fill="#111827" />
        {ordered.map((loc) => {
          const p = projectLatLng(loc, WEATHER_BOUNDS, VIEW_BOX, PADDING);
          const color = BAND_COLOR[temperatureBand(loc.temperatureC)];
          const isSelected = loc.location === selected;
          return (
            <g
              key={loc.location}
              role="button"
              tabIndex={0}
              aria-label={`${loc.location}, ${loc.temperatureC.toFixed(0)} độ C`}
              aria-pressed={isSelected}
              onClick={() => onSelect(loc.location)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelect(loc.location);
                }
              }}
              style={{ cursor: "pointer", outline: "none" }}
              className="focus-visible:[&>circle:last-of-type]:stroke-white"
            >
              {/* Larger invisible hit area so pins are easy to tap. */}
              <circle cx={p.x} cy={p.y} r={18} fill="transparent" />
              {isSelected && <circle cx={p.x} cy={p.y} r={15} fill={color} fillOpacity={0.16} />}
              <circle cx={p.x} cy={p.y} r={isSelected ? 7 : 5} fill={color} stroke="#0A0E16" strokeWidth={1} />
              {isSelected && (
                <text x={p.x} y={p.y - 14} textAnchor="middle" fill="#DFE2EE" fontSize="13">
                  {loc.location} · {loc.temperatureC.toFixed(0)}°C
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
