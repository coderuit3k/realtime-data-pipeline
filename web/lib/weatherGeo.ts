import type { WeatherLocation } from "./types";
import { temperatureBand } from "./weatherMeta";

/** Pin colours per temperature band; shared by the Mapbox map, the SVG fallback and the legend. */
export const BAND_COLOR: Record<"cool" | "moderate" | "hot", string> = {
  cool: "#38BDF8",
  moderate: "#FBBF24",
  hot: "#FB7185",
};

export type WeatherFeatureProperties = {
  location: string;
  temperatureC: number;
  band: "cool" | "moderate" | "hot";
  label: string;
};

export type WeatherFeature = {
  type: "Feature";
  geometry: { type: "Point"; coordinates: [number, number] };
  properties: WeatherFeatureProperties;
};

export type WeatherFeatureCollection = { type: "FeatureCollection"; features: WeatherFeature[] };

/** GeoJSON points for the map source. GeoJSON order is [longitude, latitude]. */
export function toFeatureCollection(locations: WeatherLocation[]): WeatherFeatureCollection {
  return {
    type: "FeatureCollection",
    features: locations.map((l) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [l.longitude, l.latitude] },
      properties: {
        location: l.location,
        temperatureC: l.temperatureC,
        band: temperatureBand(l.temperatureC),
        label: `${Math.round(l.temperatureC)}°`,
      },
    })),
  };
}

/** [[minLon, minLat], [maxLon, maxLat]] for fitBounds; null when there is nothing to fit. */
export function boundsOf(locations: WeatherLocation[]): [[number, number], [number, number]] | null {
  if (locations.length === 0) return null;
  const lons = locations.map((l) => l.longitude);
  const lats = locations.map((l) => l.latitude);
  return [
    [Math.min(...lons), Math.min(...lats)],
    [Math.max(...lons), Math.max(...lats)],
  ];
}

/**
 * The public token to hand to Mapbox, or null when it is missing, a
 * placeholder, or not a public `pk.` token. Rejecting `sk.` here means a
 * secret token pasted into NEXT_PUBLIC_* is never sent to the browser's map.
 */
export function resolveMapboxToken(raw: string | undefined): string | null {
  const token = raw?.trim();
  if (!token || !token.startsWith("pk.")) return null;
  return token;
}
