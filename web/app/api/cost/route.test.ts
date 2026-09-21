import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/aws", () => ({
  getCostExplorerClient: vi.fn(() => ({})),
}));
vi.mock("@/lib/costExplorer", () => ({ getMonthToDateCostUsd: vi.fn() }));
vi.mock("@/lib/ratelimit", () => ({ checkRateLimit: vi.fn(), getCostLimiter: vi.fn(() => "cost-limiter-marker") }));

import { getMonthToDateCostUsd } from "@/lib/costExplorer";
import { checkRateLimit } from "@/lib/ratelimit";
import { GET } from "./route";

const mockedCost = vi.mocked(getMonthToDateCostUsd);
const mockedCheckRateLimit = vi.mocked(checkRateLimit);

function makeRequest(): NextRequest {
  return new NextRequest("http://localhost/api/cost", {
    headers: { "x-forwarded-for": "9.9.9.9" },
  });
}

beforeEach(() => {
  mockedCost.mockReset();
  mockedCheckRateLimit.mockReset();
  mockedCheckRateLimit.mockResolvedValue({ allowed: true, remaining: 4 });
});

describe("GET /api/cost", () => {
  it("returns the real month-to-date cost with a 24h Cache-Control", async () => {
    mockedCost.mockResolvedValue(4.56);

    const response = await GET(makeRequest());
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe(
      "public, s-maxage=86400, stale-while-revalidate=172800"
    );
    const body = await response.json();
    expect(body).toEqual({ monthToDateCostUsd: 4.56 });
  });

  it("returns 500 with a safe message when Cost Explorer fails", async () => {
    mockedCost.mockRejectedValue(new Error("boom"));
    const response = await GET(makeRequest());
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error).toBe("Không tải được chi phí, thử lại sau.");
  });

  it("returns 429 when rate limited, using the cost limiter, and never calls Cost Explorer", async () => {
    mockedCheckRateLimit.mockResolvedValue({ allowed: false, remaining: 0 });
    const response = await GET(makeRequest());
    expect(response.status).toBe(429);
    expect(mockedCheckRateLimit).toHaveBeenCalledWith("9.9.9.9", "cost-limiter-marker");
    expect(mockedCost).not.toHaveBeenCalled();
    const body = await response.json();
    expect(body.error).toBe("Đợi một chút rồi thử lại.");
  });
});
