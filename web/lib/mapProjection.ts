export type LatLng = { latitude: number; longitude: number };
export type LatLngBounds = { latMin: number; latMax: number; lonMin: number; lonMax: number };
export type ViewBox = { width: number; height: number };
export type Point = { x: number; y: number };

// Bounding box of the 12 locations in common/config.py:WEATHER_LOCATIONS:
// south = Ca Mau, west = Rach Gia, north and east = Da Lat. Update it if
// locations are added, or new points will project off the map.
export const WEATHER_BOUNDS: LatLngBounds = {
  latMin: 9.1769,
  latMax: 11.9404,
  lonMin: 105.0809,
  lonMax: 108.4583,
};

/**
 * Equirectangular projection into an SVG viewBox; distortion is negligible
 * over a few hundred km. y is flipped because SVG y grows downward.
 */
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
