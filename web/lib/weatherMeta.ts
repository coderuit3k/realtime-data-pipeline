// Must match the names in common/config.py:WEATHER_LOCATIONS exactly; there is
// no runtime cross-check. Also serves as the allow-list for the history API.
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

// observed_at is naive Vietnam local time, not UTC: weather_ingestion.py asks
// Open-Meteo for timezone=Asia/Bangkok (UTC+7, no DST), which returns local
// timestamps without an offset, and they are stored as-is. Use this constant
// everywhere observed_at is compared with a real clock; don't redefine it.
export const VIETNAM_UTC_OFFSET_HOURS = 7;

/**
 * Security: the location query param is interpolated into Athena SQL, so it
 * MUST pass this allow-list check first to prevent SQL injection.
 */
export function isKnownWeatherLocation(value: string): boolean {
  return WEATHER_LOCATION_NAMES.includes(value);
}

// Map legend breakpoints: <22 cool, 22-30 moderate, >30 hot.
export const TEMP_BAND_THRESHOLDS_C = { cool: 22, hot: 30 };

/** Colour band for a temperature; both edges (22 and 30) count as moderate. */
export function temperatureBand(tempC: number): "cool" | "moderate" | "hot" {
  if (tempC < TEMP_BAND_THRESHOLDS_C.cool) return "cool";
  if (tempC <= TEMP_BAND_THRESHOLDS_C.hot) return "moderate";
  return "hot";
}
