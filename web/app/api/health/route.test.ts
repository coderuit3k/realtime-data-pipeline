// web/app/api/health/route.test.ts
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/aws", () => ({
  getAthenaClient: vi.fn(() => ({})),
  requiredEnv: vi.fn((name: string) => {
    if (name === "AWS_REGION") return "us-east-1";
    if (name === "DEPLOY_ENVIRONMENT") return "dev";
    throw new Error(`unexpected env var: ${name}`);
  }),
}));
vi.mock("@/lib/athena", async () => {
  const actual = await vi.importActual<typeof import("@/lib/athena")>("@/lib/athena");
  return { ...actual, runAthenaQuery: vi.fn() };
});

import { runAthenaQuery } from "@/lib/athena";
import { GET } from "./route";

const mockedRun = vi.mocked(runAthenaQuery);

function athenaRows(rows: string[][]) {
  return [{ Data: [] }, ...rows.map((cols) => ({ Data: cols.map((v) => ({ VarCharValue: v })) }))];
}

beforeEach(() => {
  mockedRun.mockReset();
});

describe("GET /api/health", () => {
  it("returns real health counts and real region/environment", async () => {
    mockedRun.mockResolvedValue(
      athenaRows([
        ["hackernews", "10"],
        ["news", "0"],
        ["weather", "5"],
        ["crypto", "3"],
        ["github", "0"],
      ])
    );

    const response = await GET();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      sourcesHealthy: 3,
      sourcesTotal: 5,
      region: "us-east-1",
      environment: "dev",
    });
  });

  it("returns 500 with a safe message when the query fails", async () => {
    mockedRun.mockRejectedValue(new Error("boom"));
    const response = await GET();
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error).toBe("Không tải được trạng thái, thử lại sau.");
  });
});
