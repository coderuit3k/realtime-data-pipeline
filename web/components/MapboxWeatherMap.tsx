"use client";

import { useEffect, useRef } from "react";
import type { Map as MapboxMap, GeoJSONSource, ExpressionSpecification } from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import type { WeatherLocation } from "@/lib/types";
import { BAND_COLOR, boundsOf, toFeatureCollection } from "@/lib/weatherGeo";

const SOURCE_ID = "weather";
const FONT = ["DIN Pro Medium", "Arial Unicode MS Regular"];

type MapboxWeatherMapProps = {
  locations: WeatherLocation[];
  selected: string;
  onSelect: (location: string) => void;
  /** A public `pk.` token (see resolveMapboxToken). */
  token: string;
  /** Called when the map cannot load (bad token, style error) so the page can fall back to the SVG map. */
  onFail: () => void;
};

/**
 * Mapbox GL map of the readings: one circle per location coloured by
 * temperature band, a halo and a name label on the selected one. The map is
 * created once per token; data and selection are pushed in by separate
 * effects so switching province never rebuilds it. mapbox-gl is imported
 * inside the effect because it touches `window` on load (no SSR).
 */
export function MapboxWeatherMap({ locations, selected, onSelect, token, onFail }: MapboxWeatherMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapboxMap | null>(null);
  const readyRef = useRef(false);
  // The map's handlers outlive renders, so they read the latest props through refs.
  const locationsRef = useRef(locations);
  const selectedRef = useRef(selected);
  const onSelectRef = useRef(onSelect);
  const onFailRef = useRef(onFail);
  locationsRef.current = locations;
  selectedRef.current = selected;
  onSelectRef.current = onSelect;
  onFailRef.current = onFail;
  const firstSelectionRef = useRef(true);

  function applySelection(map: MapboxMap) {
    const isSelected: ExpressionSpecification = ["==", ["get", "location"], selectedRef.current];
    map.setFilter("weather-halo", isSelected);
    map.setFilter("weather-selected-label", isSelected);
    map.setFilter("weather-labels", ["!=", ["get", "location"], selectedRef.current]);
  }

  useEffect(() => {
    let cancelled = false;

    async function init() {
      const mapboxgl = (await import("mapbox-gl")).default;
      if (cancelled || !containerRef.current) return;

      const map = new mapboxgl.Map({
        container: containerRef.current,
        accessToken: token,
        style: "mapbox://styles/mapbox/dark-v11",
        // Two-finger pan on touch screens so the map does not trap page scrolling.
        cooperativeGestures: true,
        attributionControl: true,
      });
      mapRef.current = map;
      map.addControl(new mapboxgl.NavigationControl({ visualizePitch: false }), "top-right");

      map.on("load", () => {
        readyRef.current = true;
        map.addSource(SOURCE_ID, { type: "geojson", data: toFeatureCollection(locationsRef.current) });

        map.addLayer({
          id: "weather-halo",
          type: "circle",
          source: SOURCE_ID,
          filter: ["==", ["get", "location"], selectedRef.current],
          paint: {
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 5, 14, 9, 22],
            "circle-color": "rgba(255,255,255,0.12)",
            "circle-stroke-color": "rgba(255,255,255,0.85)",
            "circle-stroke-width": 1.5,
          },
        });
        map.addLayer({
          id: "weather-circles",
          type: "circle",
          source: SOURCE_ID,
          paint: {
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 5, 6, 9, 11],
            "circle-color": [
              "match",
              ["get", "band"],
              "cool",
              BAND_COLOR.cool,
              "hot",
              BAND_COLOR.hot,
              BAND_COLOR.moderate,
            ],
            "circle-stroke-color": "#0A0E16",
            "circle-stroke-width": 1.5,
          },
        });
        const labelPaint = { "text-color": "#DFE2EE", "text-halo-color": "#0A0E16", "text-halo-width": 1.5 };
        map.addLayer({
          id: "weather-labels",
          type: "symbol",
          source: SOURCE_ID,
          filter: ["!=", ["get", "location"], selectedRef.current],
          layout: { "text-field": ["get", "label"], "text-font": FONT, "text-size": 12, "text-offset": [0, -1.5] },
          paint: labelPaint,
        });
        map.addLayer({
          id: "weather-selected-label",
          type: "symbol",
          source: SOURCE_ID,
          filter: ["==", ["get", "location"], selectedRef.current],
          layout: {
            "text-field": ["concat", ["get", "location"], " · ", ["get", "label"]],
            "text-font": FONT,
            "text-size": 13,
            "text-offset": [0, -2.2],
            "text-allow-overlap": true,
          },
          paint: labelPaint,
        });

        const bounds = boundsOf(locationsRef.current);
        // Extra room on the right/top for the zoom controls and the selected pin's name label.
        if (bounds) map.fitBounds(bounds, { padding: { top: 70, bottom: 50, left: 50, right: 110 }, maxZoom: 9, animate: false });

        map.on("click", "weather-circles", (e) => {
          // GeoJSONFeature's `properties` is not visible without @types/geojson; narrow it by hand.
          const feature = e.features?.[0] as { properties?: { location?: unknown } } | undefined;
          const name = feature?.properties?.location;
          if (typeof name === "string") onSelectRef.current(name);
        });
        map.on("mouseenter", "weather-circles", () => {
          map.getCanvas().style.cursor = "pointer";
        });
        map.on("mouseleave", "weather-circles", () => {
          map.getCanvas().style.cursor = "";
        });
      });

      // Errors before the style has loaded mean the token or style is unusable;
      // later errors (a missed tile) are transient and must not drop the map.
      map.on("error", (e) => {
        const err = e.error as { message?: string; status?: number } | undefined;
        console.error("Mapbox error:", err?.message ?? "unknown", err?.status ?? "");
        if (!readyRef.current) onFailRef.current();
      });
    }

    init();
    return () => {
      cancelled = true;
      readyRef.current = false;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, [token]);

  // New readings: replace the source data in place.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    (map.getSource(SOURCE_ID) as GeoJSONSource | undefined)?.setData(toFeatureCollection(locations));
  }, [locations]);

  // Selection changed (pin click or list click): move the halo/labels and ease to it.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    applySelection(map);
    if (firstSelectionRef.current) {
      firstSelectionRef.current = false;
      return;
    }
    const target = locations.find((l) => l.location === selected);
    // flyTo skips the animation for users who prefer reduced motion.
    if (target) map.flyTo({ center: [target.longitude, target.latitude], zoom: Math.max(map.getZoom(), 8), duration: 800 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  return (
    <div
      ref={containerRef}
      role="group"
      aria-label="Bản đồ nhiệt độ Mapbox (chọn tỉnh bằng danh sách bên cạnh nếu dùng bàn phím)"
      className="h-[420px] w-full overflow-hidden rounded-xl bg-bg sm:h-[520px]"
    />
  );
}
