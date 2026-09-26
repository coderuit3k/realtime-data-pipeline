import { NextResponse, type NextRequest } from "next/server";
import { getAthenaClient } from "@/lib/aws";
import { runAthenaQuery, parseAthenaRows, todayUtcParts } from "@/lib/athena";
import { lastNDaysUtcParts } from "@/lib/dateRange";
import {
  buildTopKeywordsQuery,
  buildCryptoMentionsQuery,
  buildGithubHnOverlapQuery,
  buildGithubLanguagesQuery,
  buildHnSpotlightQuery,
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

    const [keywordRows, cryptoRows, overlapRows, weatherRows, languageRows, spotlightRows] = await Promise.all([
      runAthenaQuery(athena, buildTopKeywordsQuery(partsList)),
      runAthenaQuery(athena, buildCryptoMentionsQuery(partsList)),
      runAthenaQuery(athena, buildGithubHnOverlapQuery(partsList)),
      runAthenaQuery(athena, buildWeatherSnapshotQuery(todayUtcParts())),
      runAthenaQuery(athena, buildGithubLanguagesQuery(partsList)),
      runAthenaQuery(athena, buildHnSpotlightQuery(partsList)),
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
      githubLanguages: parseAthenaRows(languageRows, (cols) => ({
        language: cols[0] ?? "",
        repoCount: Number(cols[1] ?? 0),
      })),
      hnSpotlight:
        parseAthenaRows(spotlightRows, (cols) => ({
          title: cols[0] ?? "",
          score: Number(cols[1] ?? 0),
          comments: Number(cols[2] ?? 0),
          author: cols[3] ?? "",
          url: cols[4] ?? "",
        }))[0] ?? null,
    };

    return NextResponse.json(response, {
      headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120" },
    });
  } catch (error) {
    console.error("Insights API failed", error);
    return NextResponse.json({ error: "Không tải được Insights, thử lại sau." }, { status: 500 });
  }
}
