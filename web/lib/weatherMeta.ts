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
