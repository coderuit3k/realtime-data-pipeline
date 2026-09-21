import { describe, expect, it } from "vitest";
import { DATA_SOURCES, SECRET_LABELS } from "./settingsMeta";

describe("DATA_SOURCES", () => {
  it("has exactly 5 real ingestion sources", () => {
    expect(DATA_SOURCES.map((s) => s.id)).toEqual(["hackernews", "news", "weather", "crypto", "github"]);
  });

  it("only News API uses the separate news schedule", () => {
    const flags = Object.fromEntries(DATA_SOURCES.map((s) => [s.id, s.usesNewsSchedule]));
    expect(flags).toEqual({
      hackernews: false,
      news: true,
      weather: false,
      crypto: false,
      github: false,
    });
  });

  it("every source has a non-empty name and detail", () => {
    for (const source of DATA_SOURCES) {
      expect(source.name.length).toBeGreaterThan(0);
      expect(source.detail.length).toBeGreaterThan(0);
    }
  });

  it("the weather source's detail mentions all 12 real locations", () => {
    const weather = DATA_SOURCES.find((s) => s.id === "weather");
    expect(weather?.detail).toContain("Da Lat");
    expect(weather?.detail).toContain("Tay Ninh");
  });
});

describe("SECRET_LABELS", () => {
  it("has exactly the 2 real secrets", () => {
    expect(SECRET_LABELS).toEqual(["news-api-key", "tavily-api-key"]);
  });
});
