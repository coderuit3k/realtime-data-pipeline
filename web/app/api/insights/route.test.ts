import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/aws", () => ({ getAthenaClient: vi.fn(() => ({})) }));
vi.mock("@/lib/athena", async () => {
  const actual = await vi.importActual<typeof import("@/lib/athena")>("@/lib/athena");
  return { ...actual, runAthenaQuery: vi.fn() };
});

import { runAthenaQuery } from "@/lib/athena";
import { GET } from "./route";

const mockedRun = vi.mocked(runAthenaQuery);

function makeRequest(url: string): NextRequest {
  return new NextRequest(url);
}

function rows(header: string[], data: string[][]) {
  return [
    { Data: header.map((h) => ({ VarCharValue: h })) },
    ...data.map((row) => ({ Data: row.map((v) => ({ VarCharValue: v })) })),
  ];
}

// Matches the Promise.all order in route.ts: keywords, cryptoMentions,
// githubHnOverlap, weatherSnapshot, githubLanguages, hnSpotlight,
// githubStars, cryptoRanking, hnControversial.
function mockAllEmpty() {
  mockedRun
    .mockResolvedValueOnce(rows(["keyword", "mentions"], []))
    .mockResolvedValueOnce(rows(["coin_id", "price_usd", "change_24h_pct", "mention_count"], []))
    .mockResolvedValueOnce(rows(["keyword", "overlap_count"], []))
    .mockResolvedValueOnce(rows(["location", "temperature_c", "humidity_pct"], []))
    .mockResolvedValueOnce(rows(["language", "repo_count"], []))
    .mockResolvedValueOnce(rows(["title", "score", "num_comments", "author", "link"], []))
    .mockResolvedValueOnce(rows(["full_name", "stars", "forks", "language"], []))
    .mockResolvedValueOnce(rows(["coin_id", "market_cap_usd", "volume_24h_usd"], []))
    .mockResolvedValueOnce(rows(["title", "score", "num_comments", "author", "link"], []));
}

beforeEach(() => {
  mockedRun.mockReset();
});

describe("GET /api/insights", () => {
  it("defaults to range=today and returns all 9 sections", async () => {
    mockedRun
      .mockResolvedValueOnce(rows(["keyword", "mentions"], [["agent", "41"]]))
      .mockResolvedValueOnce(
        rows(["coin_id", "price_usd", "change_24h_pct", "mention_count"], [["bitcoin", "81314.2", "2.4", "18"]])
      )
      .mockResolvedValueOnce(rows(["keyword", "overlap_count"], [["agent", "7"]]))
      .mockResolvedValueOnce(rows(["location", "temperature_c", "humidity_pct"], [["Ho Chi Minh City", "31", "68"]]))
      .mockResolvedValueOnce(rows(["language", "repo_count"], [["Python", "174"]]))
      .mockResolvedValueOnce(
        rows(
          ["title", "score", "num_comments", "author", "link"],
          [["Breaking Up with Google Play", "123", "23", "ezst", "https://example.com/story"]]
        )
      )
      .mockResolvedValueOnce(
        rows(
          ["full_name", "stars", "forks", "language"],
          [["zai-org/ZCode", "6819", "2049", "TypeScript"]]
        )
      )
      .mockResolvedValueOnce(
        rows(["coin_id", "market_cap_usd", "volume_24h_usd"], [["bitcoin", "1686742462959.38", "22084196107.17"]])
      )
      .mockResolvedValueOnce(
        rows(
          ["title", "score", "num_comments", "author", "link"],
          [["Can AI Shopping Agents Be Trusted?", "14", "26", "ddaniel10", "https://example.com/agents"]]
        )
      );

    const response = await GET(makeRequest("http://localhost/api/insights"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.range).toBe("today");
    expect(body.topKeywords).toEqual([{ keyword: "agent", mentions: 41 }]);
    expect(body.cryptoMentions).toEqual([
      { coinId: "bitcoin", priceUsd: 81314.2, change24hPct: 2.4, mentionCount: 18 },
    ]);
    expect(body.githubHnOverlap).toEqual([{ keyword: "agent", overlapCount: 7 }]);
    expect(body.weatherSnapshot).toEqual([{ location: "Ho Chi Minh City", temperatureC: 31, humidityPct: 68 }]);
    expect(body.githubLanguages).toEqual([{ language: "Python", repoCount: 174 }]);
    expect(body.hnSpotlight).toEqual({
      title: "Breaking Up with Google Play",
      score: 123,
      comments: 23,
      author: "ezst",
      url: "https://example.com/story",
    });
    expect(body.githubStars).toEqual([
      { fullName: "zai-org/ZCode", stars: 6819, forks: 2049, language: "TypeScript" },
    ]);
    expect(body.cryptoRanking).toEqual([
      { coinId: "bitcoin", marketCapUsd: 1686742462959.38, volume24hUsd: 22084196107.17 },
    ]);
    expect(body.hnControversial).toEqual({
      title: "Can AI Shopping Agents Be Trusted?",
      score: 14,
      comments: 26,
      author: "ddaniel10",
      url: "https://example.com/agents",
    });
  });

  it("accepts range=7d", async () => {
    mockAllEmpty();

    const response = await GET(makeRequest("http://localhost/api/insights?range=7d"));
    const body = await response.json();
    expect(body.range).toBe("7d");
  });

  it("falls back to today for an invalid range value", async () => {
    mockAllEmpty();

    const response = await GET(makeRequest("http://localhost/api/insights?range=bogus"));
    const body = await response.json();
    expect(body.range).toBe("today");
  });

  it("returns null hnSpotlight and hnControversial when there are no stories in range", async () => {
    mockAllEmpty();

    const response = await GET(makeRequest("http://localhost/api/insights"));
    const body = await response.json();
    expect(body.hnSpotlight).toBeNull();
    expect(body.hnControversial).toBeNull();
  });

  it("returns 500 with a safe message when Athena fails", async () => {
    mockedRun.mockRejectedValueOnce(new Error("Athena query failed: table not found"));
    const response = await GET(makeRequest("http://localhost/api/insights"));
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error).toBe("Không tải được Insights, thử lại sau.");
  });
});
