// Verbatim from common/config.py:WEATHER_LOCATIONS (expanded to these 12
// real Southern Vietnam locations during the Insights sub-project). No
// cross-language runtime check -- same convention as opsMeta.ts's
// PIPELINE_LAMBDAS.
export const WEATHER_LOCATION_NAMES: string[] = [
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
];

// weather_ingestion.py requests Open-Meteo with timezone=Asia/Bangkok for
// every one of the 12 real locations (all within Vietnam, UTC+7, no DST).
// Open-Meteo's docs: when timezone= is set, returned timestamps are naive
// local time with NO UTC offset suffix -- observed_at is stored exactly
// as returned, so every value in weather_observations is Vietnam local
// time, not UTC. Single source of truth for this offset -- both
// dateRange.ts (server-side cutoff computation) and page.tsx (client-side
// "N minutes ago" display) must use this exact constant, never their own copy.
export const VIETNAM_UTC_OFFSET_HOURS = 7;

// The only client-influenced value that reaches SQL in this feature --
// MUST be validated with this before ever being interpolated into a
// query string. Same non-negotiable rule as every other user-influenced
// value elsewhere in this app.
export function isKnownWeatherLocation(value: string): boolean {
  return WEATHER_LOCATION_NAMES.includes(value);
}

// The map legend's real breakpoints: <22 cool, 22-30 moderate, >30 hot.
export const TEMP_BAND_THRESHOLDS_C = { cool: 22, hot: 30 };

export function temperatureBand(tempC: number): "cool" | "moderate" | "hot" {
  if (tempC < TEMP_BAND_THRESHOLDS_C.cool) return "cool";
  if (tempC <= TEMP_BAND_THRESHOLDS_C.hot) return "moderate";
  return "hot";
}
