import { describe, expect, it } from "vitest";
import type { WeatherLocation } from "./types";
import { boundsOf, resolveMapboxToken, toFeatureCollection } from "./weatherGeo";

function loc(location: string, latitude: number, longitude: number, temperatureC: number): WeatherLocation {
  return { location, latitude, longitude, temperatureC, humidityPct: 70, precipitationMm: 0, windSpeedKmh: 5, observedAt: "2026-10-05T14:00" };
}

describe("toFeatureCollection", () => {
  it("emits one point per location with [lon, lat] coordinates", () => {
    const fc = toFeatureCollection([loc("Da Lat", 11.94, 108.45, 19)]);
    expect(fc.type).toBe("FeatureCollection");
    expect(fc.features).toHaveLength(1);
    expect(fc.features[0].geometry).toEqual({ type: "Point", coordinates: [108.45, 11.94] });
    expect(fc.features[0].properties).toMatchObject({ location: "Da Lat", temperatureC: 19, band: "cool", label: "19°" });
  });

  it("uses the same band edges as temperatureBand (22 and 30 are moderate)", () => {
    const bands = [21.9, 22, 30, 30.1].map((t) => toFeatureCollection([loc("x", 10, 106, t)]).features[0].properties.band);
    expect(bands).toEqual(["cool", "moderate", "moderate", "hot"]);
  });

  it("rounds the label to whole degrees", () => {
    expect(toFeatureCollection([loc("x", 10, 106, 28.6)]).features[0].properties.label).toBe("29°");
  });
});

describe("boundsOf", () => {
  it("returns [[minLon, minLat], [maxLon, maxLat]]", () => {
    expect(boundsOf([loc("a", 10, 106, 30), loc("b", 11, 105, 30), loc("c", 9, 108, 30)])).toEqual([
      [105, 9],
      [108, 11],
    ]);
  });

  it("returns null for no locations", () => {
    expect(boundsOf([])).toBeNull();
  });
});

describe("resolveMapboxToken", () => {
  it("accepts a public pk. token", () => {
    expect(resolveMapboxToken("pk.abc.def")).toBe("pk.abc.def");
  });

  it("rejects missing, blank and placeholder values", () => {
    expect(resolveMapboxToken(undefined)).toBeNull();
    expect(resolveMapboxToken("")).toBeNull();
    expect(resolveMapboxToken("   ")).toBeNull();
    expect(resolveMapboxToken("YOUR_MAPBOX_ACCESS_TOKEN")).toBeNull();
  });

  it("never accepts a secret sk. token in client code", () => {
    expect(resolveMapboxToken("sk.abc.def")).toBeNull();
  });
});
