import { describe, expect, it } from "vitest";
import { weatherIconGroup, WEATHER_ICON_PATHS } from "./weatherIcons";

describe("weatherIconGroup", () => {
  it("maps code 0 to clear", () => {
    expect(weatherIconGroup(0)).toBe("clear");
  });

  it("maps codes 1-3 to cloudy", () => {
    expect(weatherIconGroup(1)).toBe("cloudy");
    expect(weatherIconGroup(2)).toBe("cloudy");
    expect(weatherIconGroup(3)).toBe("cloudy");
  });

  it("maps fog codes to fog", () => {
    expect(weatherIconGroup(45)).toBe("fog");
    expect(weatherIconGroup(48)).toBe("fog");
  });

  it("maps drizzle codes to drizzle", () => {
    expect(weatherIconGroup(51)).toBe("drizzle");
    expect(weatherIconGroup(57)).toBe("drizzle");
  });

  it("maps rain and rain shower codes to rain", () => {
    expect(weatherIconGroup(61)).toBe("rain");
    expect(weatherIconGroup(67)).toBe("rain");
    expect(weatherIconGroup(80)).toBe("rain");
    expect(weatherIconGroup(82)).toBe("rain");
  });

  it("maps snow codes to snow", () => {
    expect(weatherIconGroup(71)).toBe("snow");
    expect(weatherIconGroup(77)).toBe("snow");
    expect(weatherIconGroup(85)).toBe("snow");
    expect(weatherIconGroup(86)).toBe("snow");
  });

  it("maps thunderstorm codes to thunderstorm", () => {
    expect(weatherIconGroup(95)).toBe("thunderstorm");
    expect(weatherIconGroup(96)).toBe("thunderstorm");
    expect(weatherIconGroup(99)).toBe("thunderstorm");
  });

  it("falls back to cloudy for an unrecognized code", () => {
    expect(weatherIconGroup(9999)).toBe("cloudy");
  });
});

describe("WEATHER_ICON_PATHS", () => {
  it("has a non-empty SVG path for every icon group", () => {
    const groups = Object.keys(WEATHER_ICON_PATHS) as (keyof typeof WEATHER_ICON_PATHS)[];
    expect(groups.length).toBeGreaterThan(0);
    for (const group of groups) {
      expect(WEATHER_ICON_PATHS[group].length).toBeGreaterThan(0);
    }
  });
});
