import { NextResponse, type NextRequest } from "next/server";
import { getAthenaClient } from "@/lib/aws";
import { runAthenaQuery, parseAthenaRows, todayUtcParts } from "@/lib/athena";
import { lastNDaysUtcParts } from "@/lib/dateRange";
import {
  buildTopKeywordsQuery,
  buildCryptoMentionsQuery,
  buildGithubHnOverlapQuery,
  buildWeatherSnapshotQuery,
} from "@/lib/insightsQueries";
import type { InsightsResponse } from "@/lib/types";

export const maxDuration = 60;

export async function GET(request: NextRequest) {
  try {
    const rangeParam = request.nextUrl.searchParams.get("range");
    const range = rangeParam === "7d" ? "7d" : "today";
    const partsList = lastNDaysUtcParts(range === "7d" ? 7 : 1);
    const athena = getAthenaClient();

    const [keywordRows, cryptoRows, overlapRows, weatherRows] = await Promise.all([
      runAthenaQuery(athena, buildTopKeywordsQuery(partsList)),
      runAthenaQuery(athena, buildCryptoMentionsQuery(partsList)),
      runAthenaQuery(athena, buildGithubHnOverlapQuery(partsList)),
      runAthenaQuery(athena, buildWeatherSnapshotQuery(todayUtcParts())),
    ]);

    const response: InsightsResponse = {
      range,
      topKeywords: parseAthenaRows(keywordRows, (cols) => ({
        keyword: cols[0] ?? "",
        mentions: Number(cols[1] ?? 0),
      })),
      cryptoMentions: parseAthenaRows(cryptoRows, (cols) => ({
        coinId: cols[0] ?? "",
        priceUsd: Number(cols[1] ?? 0),
        change24hPct: Number(cols[2] ?? 0),
        mentionCount: Number(cols[3] ?? 0),
      })),
      githubHnOverlap: parseAthenaRows(overlapRows, (cols) => ({
        keyword: cols[0] ?? "",
        overlapCount: Number(cols[1] ?? 0),
      })),
      weatherSnapshot: parseAthenaRows(weatherRows, (cols) => ({
        location: cols[0] ?? "",
        temperatureC: Number(cols[1] ?? 0),
        humidityPct: Number(cols[2] ?? 0),
      })),
    };

    return NextResponse.json(response, {
      headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120" },
    });
  } catch (error) {
    console.error("Insights API failed", error);
    return NextResponse.json({ error: "Không tải được Insights, thử lại sau." }, { status: 500 });
  }
}
