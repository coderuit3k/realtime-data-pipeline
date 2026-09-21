import { describe, expect, it } from "vitest";
import { WEATHER_LOCATION_NAMES, isKnownWeatherLocation, temperatureBand } from "./weatherMeta";

describe("WEATHER_LOCATION_NAMES", () => {
  it("has exactly the 12 real locations from common/config.py", () => {
    expect(WEATHER_LOCATION_NAMES).toEqual([
      "Tay Ninh",
      "Ho Chi Minh City",
      "Thu Dau Mot (Binh Duong)",
      "Long Xuyen (An Giang)",
      "Bien Hoa (Dong Nai)",
      "Can Tho",
      "My Tho (Tien Giang)",
      "Soc Trang",
      "Vung Tau",
      "Rach Gia (Kien Giang)",
      "Ca Mau",
      "Da Lat",
    ]);
  });
});

describe("isKnownWeatherLocation", () => {
  it("returns true for every real location name", () => {
    for (const name of WEATHER_LOCATION_NAMES) {
      expect(isKnownWeatherLocation(name)).toBe(true);
    }
  });

  it("returns false for an unrelated string", () => {
    expect(isKnownWeatherLocation("Hanoi")).toBe(false);
  });

  it("returns false for an empty string", () => {
    expect(isKnownWeatherLocation("")).toBe(false);
  });

  it("returns false for a SQL-injection attempt", () => {
    expect(isKnownWeatherLocation("Da Lat' OR '1'='1")).toBe(false);
  });
});

describe("temperatureBand", () => {
  it("bands below 22 as cool", () => {
    expect(temperatureBand(19)).toBe("cool");
    expect(temperatureBand(21.9)).toBe("cool");
  });

  it("bands 22-30 inclusive as moderate", () => {
    expect(temperatureBand(22)).toBe("moderate");
    expect(temperatureBand(30)).toBe("moderate");
  });

  it("bands above 30 as hot", () => {
    expect(temperatureBand(30.1)).toBe("hot");
    expect(temperatureBand(35)).toBe("hot");
  });
});
