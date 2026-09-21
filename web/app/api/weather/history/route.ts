import { NextResponse, type NextRequest } from "next/server";
import { getAthenaClient } from "@/lib/aws";
import { runAthenaQuery, parseAthenaRows } from "@/lib/athena";
import { lastNDaysUtcParts, hoursAgoAsObservedAtLocal } from "@/lib/dateRange";
import { buildHistoryQuery } from "@/lib/weatherQueries";
import { isKnownWeatherLocation } from "@/lib/weatherMeta";
import type { WeatherHistoryResponse } from "@/lib/types";

export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const location = request.nextUrl.searchParams.get("location");
  if (!location || !isKnownWeatherLocation(location)) {
    return NextResponse.json({ error: "Không tìm thấy địa điểm." }, { status: 400 });
  }

  try {
    const partsList = lastNDaysUtcParts(2);
    const cutoffLocalIso = hoursAgoAsObservedAtLocal(24);
    const rows = await runAthenaQuery(
      getAthenaClient(),
      buildHistoryQuery(location, partsList, cutoffLocalIso)
    );

    const response: WeatherHistoryResponse = {
      location,
      points: parseAthenaRows(rows, (cols) => ({
        hourBucket: cols[0] ?? "",
        avgTemperatureC: Number(cols[1] ?? 0),
      })),
    };

    return NextResponse.json(response, {
      headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120" },
    });
  } catch (error) {
    console.error("Weather history API failed", error);
    return NextResponse.json({ error: "Không tải được thời tiết, thử lại sau." }, { status: 500 });
  }
}
