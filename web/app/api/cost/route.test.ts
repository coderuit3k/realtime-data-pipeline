import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/aws", () => ({
  getCostExplorerClient: vi.fn(() => ({})),
}));
vi.mock("@/lib/costExplorer", () => ({ getMonthToDateCostUsd: vi.fn() }));

import { getMonthToDateCostUsd } from "@/lib/costExplorer";
import { GET } from "./route";

const mockedCost = vi.mocked(getMonthToDateCostUsd);

beforeEach(() => {
  mockedCost.mockReset();
});

describe("GET /api/cost", () => {
  it("returns the real month-to-date cost with a 24h Cache-Control", async () => {
    mockedCost.mockResolvedValue(4.56);

    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe(
      "public, s-maxage=86400, stale-while-revalidate=172800"
    );
    const body = await response.json();
    expect(body).toEqual({ monthToDateCostUsd: 4.56 });
  });

  it("returns 500 with a safe message when Cost Explorer fails", async () => {
    mockedCost.mockRejectedValue(new Error("boom"));
    const response = await GET();
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error).toBe("Không tải được chi phí, thử lại sau.");
  });
});
