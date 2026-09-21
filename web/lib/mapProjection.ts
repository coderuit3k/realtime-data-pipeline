export type LatLng = { latitude: number; longitude: number };
export type LatLngBounds = { latMin: number; latMax: number; lonMin: number; lonMax: number };
export type ViewBox = { width: number; height: number };
export type Point = { x: number; y: number };

// Real min/max lat/lon across the 12 locations in
// common/config.py:WEATHER_LOCATIONS. latMin/lonMin: Ca Mau (9.1769) /
// Rach Gia (105.0809). latMax/lonMax: Da Lat (11.9404 / 108.4583) -- Da
// Lat happens to be both the northernmost and easternmost of the 12.
export const WEATHER_BOUNDS: LatLngBounds = {
  latMin: 9.1769,
  latMax: 11.9404,
  lonMin: 105.0809,
  lonMax: 108.4583,
};

// Linear (equirectangular) projection -- fine at this scale (a few
// hundred km across Southern Vietnam). y is inverted (latMax - lat)
// since SVG y grows downward while latitude grows northward.
export function projectLatLng(
  point: LatLng,
  bounds: LatLngBounds,
  viewBox: ViewBox,
  padding: number
): Point {
  const usableWidth = viewBox.width - padding * 2;
  const usableHeight = viewBox.height - padding * 2;
  const lonSpan = bounds.lonMax - bounds.lonMin;
  const latSpan = bounds.latMax - bounds.latMin;
  return {
    x: padding + ((point.longitude - bounds.lonMin) / lonSpan) * usableWidth,
    y: padding + ((bounds.latMax - point.latitude) / latSpan) * usableHeight,
  };
}
