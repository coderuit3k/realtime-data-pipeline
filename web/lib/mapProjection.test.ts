import { describe, expect, it } from "vitest";
import { projectLatLng, WEATHER_BOUNDS } from "./mapProjection";

const VIEW_BOX = { width: 600, height: 600 };
const PADDING = 40;

describe("projectLatLng", () => {
  it("places the northernmost+easternmost point (Da Lat) near the top-right corner", () => {
    const p = projectLatLng({ latitude: 11.9404, longitude: 108.4583 }, WEATHER_BOUNDS, VIEW_BOX, PADDING);
    expect(p.x).toBeCloseTo(560, 1);
    expect(p.y).toBeCloseTo(40, 1);
  });

  it("places the southernmost point (Ca Mau) near the bottom edge", () => {
    const p = projectLatLng({ latitude: 9.1769, longitude: 105.15 }, WEATHER_BOUNDS, VIEW_BOX, PADDING);
    expect(p.x).toBeCloseTo(50.64, 1);
    expect(p.y).toBeCloseTo(560, 1);
  });

  it("places the westernmost point (Rach Gia) near the left edge", () => {
    const p = projectLatLng({ latitude: 10.0124, longitude: 105.0809 }, WEATHER_BOUNDS, VIEW_BOX, PADDING);
    expect(p.x).toBeCloseTo(40, 1);
    expect(p.y).toBeCloseTo(402.79, 1);
  });

  it("places a midpoint location (Ho Chi Minh City) roughly centered", () => {
    const p = projectLatLng({ latitude: 10.7769, longitude: 106.7009 }, WEATHER_BOUNDS, VIEW_BOX, PADDING);
    expect(p.x).toBeCloseTo(289.45, 1);
    expect(p.y).toBeCloseTo(258.97, 1);
  });
});
