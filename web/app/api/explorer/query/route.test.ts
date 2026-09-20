import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/aws", () => ({ getAthenaClient: vi.fn(() => ({})) }));
vi.mock("@/lib/ratelimit", () => ({ checkRateLimit: vi.fn(), getExplorerLimiter: vi.fn(() => "explorer-limiter-marker") }));
vi.mock("@/lib/athena", async () => {
  // Keep the real parseAthenaRows (route.ts uses it on runAthenaQueryWithStats's
  // output) while mocking only the network-calling function.
  const actual = await vi.importActual<typeof import("@/lib/athena")>("@/lib/athena");
  return { ...actual, runAthenaQueryWithStats: vi.fn() };
});

import { checkRateLimit } from "@/lib/ratelimit";
import { runAthenaQueryWithStats } from "@/lib/athena";
import { POST } from "./route";

const mockedCheckRateLimit = vi.mocked(checkRateLimit);
const mockedRun = vi.mocked(runAthenaQueryWithStats);

function makeRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/explorer/query", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json", "x-forwarded-for": "9.9.9.9" },
  });
}

beforeEach(() => {
  mockedCheckRateLimit.mockReset();
  mockedRun.mockReset();
});

describe("POST /api/explorer/query", () => {
  it("returns 400 and never calls Athena or the rate limiter for a rejected statement", async () => {
    const response = await POST(makeRequest({ sql: "DROP TABLE crypto_prices" }));
    expect(response.status).toBe(400);
    expect(mockedCheckRateLimit).not.toHaveBeenCalled();
    expect(mockedRun).not.toHaveBeenCalled();
  });

  it("returns 429 when rate limited, using the explorer limiter", async () => {
    mockedCheckRateLimit.mockResolvedValue({ allowed: false, remaining: 0 });
    const response = await POST(makeRequest({ sql: "SELECT 1" }));
    expect(response.status).toBe(429);
    expect(mockedCheckRateLimit).toHaveBeenCalledWith("9.9.9.9", "explorer-limiter-marker");
    expect(mockedRun).not.toHaveBeenCalled();
  });

  it("returns the query result on success", async () => {
    mockedCheckRateLimit.mockResolvedValue({ allowed: true, remaining: 2 });
    mockedRun.mockResolvedValue({
      columns: ["coin_id", "price_usd"],
      rows: [
        { Data: [{ VarCharValue: "coin_id" }, { VarCharValue: "price_usd" }] },
        { Data: [{ VarCharValue: "bitcoin" }, { VarCharValue: "81314.2" }] },
      ],
      stats: { dataScannedInBytes: 4200000, engineExecutionTimeMs: 310 },
      hasMoreRows: false,
    });

    const response = await POST(makeRequest({ sql: "SELECT coin_id, price_usd FROM crypto_prices" }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.columns).toEqual(["coin_id", "price_usd"]);
    expect(body.rows).toEqual([["bitcoin", "81314.2"]]);
    expect(body.scannedBytes).toBe(4200000);
    expect(body.elapsedMs).toBe(310);
    expect(body.hasMoreRows).toBe(false);
  });

  it("returns 400 with the real Athena error message when the query fails", async () => {
    mockedCheckRateLimit.mockResolvedValue({ allowed: true, remaining: 2 });
    mockedRun.mockRejectedValue(new Error("Athena query failed: SYNTAX_ERROR: line 1:8: no such column"));

    const response = await POST(makeRequest({ sql: "SELECT nope FROM crypto_prices" }));
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("Athena query failed: SYNTAX_ERROR: line 1:8: no such column");
  });
});
