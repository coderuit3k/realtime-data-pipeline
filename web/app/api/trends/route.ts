import { NextResponse } from "next/server";
import { getAthenaClient } from "@/lib/aws";
import { runAthenaQuery, parseAthenaRows } from "@/lib/athena";
import { lastNDaysUtcParts } from "@/lib/dateRange";
import { buildTrendEventsQuery } from "@/lib/trendsQueries";
import type { TrendsResponse } from "@/lib/types";

export const maxDuration = 60;

/** Trend events from the last 90 days of partitions, newest first. */
export async function GET() {
  try {
    const partsList = lastNDaysUtcParts(90);
    const athena = getAthenaClient();

    const rows = await runAthenaQuery(athena, buildTrendEventsQuery(partsList));

    const response: TrendsResponse = {
      events: parseAthenaRows(rows, (cols) => ({
        eventId: cols[0] ?? "",
        keyword: cols[1] ?? "",
        eventDate: cols[2] ?? "",
        githubCount: Number(cols[3] ?? 0),
        hnCount: Number(cols[4] ?? 0),
        newsCount: Number(cols[5] ?? 0),
      })),
    };

    return NextResponse.json(response, {
      headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120" },
    });
  } catch (error) {
    console.error("Trends API failed", error);
    return NextResponse.json({ error: "Không tải được Trends, thử lại sau." }, { status: 500 });
  }
}
