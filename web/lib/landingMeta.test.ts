import { describe, expect, it } from "vitest";
import { DATA_SOURCES } from "./settingsMeta";
import { WEATHER_LOCATION_NAMES } from "./weatherMeta";
import {
  DATA_SOURCE_COUNT,
  LAMBDA_COUNT,
  TEST_COUNT,
  MONTHLY_COST_USD,
  WEATHER_LOCATION_COUNT,
} from "./landingMeta";

describe("landingMeta", () => {
  it("DATA_SOURCE_COUNT is genuinely derived from DATA_SOURCES, not a second hardcoded number", () => {
    expect(DATA_SOURCE_COUNT).toBe(DATA_SOURCES.length);
  });

  it("WEATHER_LOCATION_COUNT is genuinely derived from WEATHER_LOCATION_NAMES, not a second hardcoded number", () => {
    expect(WEATHER_LOCATION_COUNT).toBe(WEATHER_LOCATION_NAMES.length);
  });

  it("LAMBDA_COUNT is a positive real number", () => {
    expect(LAMBDA_COUNT).toBeGreaterThan(0);
  });

  it("TEST_COUNT is a positive real number", () => {
    expect(TEST_COUNT).toBeGreaterThan(0);
  });

  it("MONTHLY_COST_USD is a positive real number", () => {
    expect(MONTHLY_COST_USD).toBeGreaterThan(0);
  });
});
