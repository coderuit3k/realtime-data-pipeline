// Open-Meteo's WMO weather-code table (https://open-meteo.com/en/docs),
// grouped into the handful of icon states this UI actually distinguishes.
export type WeatherIconGroup =
  | "clear"
  | "cloudy"
  | "fog"
  | "drizzle"
  | "rain"
  | "snow"
  | "thunderstorm";

const CODE_GROUPS: Record<number, WeatherIconGroup> = {
  0: "clear",
  1: "cloudy",
  2: "cloudy",
  3: "cloudy",
  45: "fog",
  48: "fog",
  51: "drizzle",
  53: "drizzle",
  55: "drizzle",
  56: "drizzle",
  57: "drizzle",
  61: "rain",
  63: "rain",
  65: "rain",
  66: "rain",
  67: "rain",
  80: "rain",
  81: "rain",
  82: "rain",
  71: "snow",
  73: "snow",
  75: "snow",
  77: "snow",
  85: "snow",
  86: "snow",
  95: "thunderstorm",
  96: "thunderstorm",
  99: "thunderstorm",
};

/** Maps a WMO code to its icon group; unknown codes fall back to "cloudy". */
export function weatherIconGroup(code: number): WeatherIconGroup {
  return CODE_GROUPS[code] ?? "cloudy";
}

// SVG path data for a 24x24 viewBox, drawn stroke-only (no fill) to match the
// card-header icons.
export const WEATHER_ICON_PATHS: Record<WeatherIconGroup, string> = {
  clear: "M12 4.5V2M12 22v-2.5M19.5 12H22M2 12h2.5M17.5 6.5 19 5M5 19l1.5-1.5M17.5 17.5 19 19M5 5l1.5 1.5M12 7.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9Z",
  cloudy: "M17 18H7a4 4 0 0 1-.5-7.97A5.5 5.5 0 0 1 17.4 9.1 4 4 0 0 1 17 18Z",
  fog: "M4 15h16M6 11h12M8 19h10M4 7h12",
  drizzle: "M17 15H7a4 4 0 0 1-.5-7.97A5.5 5.5 0 0 1 16.9 6.6 4 4 0 0 1 17 15ZM8 19v1M12 19v1M16 19v1",
  rain: "M17 13H7a4 4 0 0 1-.5-7.97A5.5 5.5 0 0 1 16.9 4.6 4 4 0 0 1 17 13ZM8 17l-1 3M12 17l-1 3M16 17l-1 3",
  snow: "M17 13H7a4 4 0 0 1-.5-7.97A5.5 5.5 0 0 1 16.9 4.6 4 4 0 0 1 17 13ZM8 18v2M8 19h0M12 18v2M12 19h0M16 18v2M16 19h0",
  thunderstorm:
    "M17 12H7a4 4 0 0 1-.5-7.97A5.5 5.5 0 0 1 16.9 3.6 4 4 0 0 1 17 12ZM13 12l-3 5h3l-2 4",
};
