import { NextResponse } from "next/server";
import { getAthenaClient } from "@/lib/aws";
import { runAthenaQuery, parseAthenaRows } from "@/lib/athena";
import { lastNDaysUtcParts } from "@/lib/dateRange";
import { buildCurrentReadingsQuery } from "@/lib/weatherQueries";
import type { WeatherResponse } from "@/lib/types";

export const maxDuration = 60;

export async function GET() {
  try {
    const partsList = lastNDaysUtcParts(2);
    const rows = await runAthenaQuery(getAthenaClient(), buildCurrentReadingsQuery(partsList));

    const response: WeatherResponse = {
      locations: parseAthenaRows(rows, (cols) => ({
        location: cols[0] ?? "",
        latitude: Number(cols[1] ?? 0),
        longitude: Number(cols[2] ?? 0),
        temperatureC: Number(cols[3] ?? 0),
        humidityPct: Number(cols[4] ?? 0),
        precipitationMm: Number(cols[5] ?? 0),
        windSpeedKmh: Number(cols[6] ?? 0),
        observedAt: cols[7] ?? "",
      })),
    };

    return NextResponse.json(response, {
      headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120" },
    });
  } catch (error) {
    console.error("Weather API failed", error);
    return NextResponse.json({ error: "Không tải được thời tiết, thử lại sau." }, { status: 500 });
  }
}
