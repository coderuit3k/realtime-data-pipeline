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

beforeEach(() => {
  mockedRun.mockReset();
});

describe("GET /api/insights", () => {
  it("defaults to range=today and returns all 4 sections", async () => {
    mockedRun
      .mockResolvedValueOnce(rows(["keyword", "mentions"], [["agent", "41"]]))
      .mockResolvedValueOnce(
        rows(["coin_id", "price_usd", "change_24h_pct", "mention_count"], [["bitcoin", "81314.2", "2.4", "18"]])
      )
      .mockResolvedValueOnce(rows(["keyword", "overlap_count"], [["agent", "7"]]))
      .mockResolvedValueOnce(rows(["location", "temperature_c", "humidity_pct"], [["Ho Chi Minh City", "31", "68"]]));

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
  });

  it("accepts range=7d", async () => {
    mockedRun
      .mockResolvedValueOnce(rows(["keyword", "mentions"], []))
      .mockResolvedValueOnce(rows(["coin_id", "price_usd", "change_24h_pct", "mention_count"], []))
      .mockResolvedValueOnce(rows(["keyword", "overlap_count"], []))
      .mockResolvedValueOnce(rows(["location", "temperature_c", "humidity_pct"], []));

    const response = await GET(makeRequest("http://localhost/api/insights?range=7d"));
    const body = await response.json();
    expect(body.range).toBe("7d");
  });

  it("falls back to today for an invalid range value", async () => {
    mockedRun
      .mockResolvedValueOnce(rows(["keyword", "mentions"], []))
      .mockResolvedValueOnce(rows(["coin_id", "price_usd", "change_24h_pct", "mention_count"], []))
      .mockResolvedValueOnce(rows(["keyword", "overlap_count"], []))
      .mockResolvedValueOnce(rows(["location", "temperature_c", "humidity_pct"], []));

    const response = await GET(makeRequest("http://localhost/api/insights?range=bogus"));
    const body = await response.json();
    expect(body.range).toBe("today");
  });

  it("returns 500 with a safe message when Athena fails", async () => {
    mockedRun.mockRejectedValueOnce(new Error("Athena query failed: table not found"));
    const response = await GET(makeRequest("http://localhost/api/insights"));
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error).toBe("Không tải được Insights, thử lại sau.");
  });
});
