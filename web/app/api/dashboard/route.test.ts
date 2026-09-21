// web/app/api/dashboard/route.test.ts
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/aws", () => ({
  getAthenaClient: vi.fn(() => ({})),
  getCloudWatchClient: vi.fn(() => ({
    send: vi.fn().mockResolvedValue({
      MetricAlarms: [
        { StateValue: "OK" },
        { StateValue: "OK" },
        { StateValue: "ALARM" },
      ],
    }),
  })),
  requiredEnv: vi.fn((name: string) => {
    if (name === "ALARM_NAME_PREFIX") return "realtime-data-pipeline-dev";
    throw new Error(`unexpected requiredEnv(${name})`);
  }),
}));

vi.mock("@/lib/athena", async () => {
  const actual = await vi.importActual<typeof import("@/lib/athena")>("@/lib/athena");
  return {
    ...actual,
    runAthenaQuery: vi.fn(),
  };
});

import { runAthenaQuery } from "@/lib/athena";
import { GET } from "./route";

const mockedRun = vi.mocked(runAthenaQuery);

beforeEach(() => {
  mockedRun.mockReset();
});

describe("GET /api/dashboard", () => {
  it("returns aggregated dashboard data", async () => {
    mockedRun
      .mockResolvedValueOnce([
        { Data: [{ VarCharValue: "source" }, { VarCharValue: "records" }] },
        { Data: [{ VarCharValue: "hackernews" }, { VarCharValue: "612" }] },
        { Data: [{ VarCharValue: "news" }, { VarCharValue: "0" }] },
      ])
      .mockResolvedValueOnce([
        { Data: [{ VarCharValue: "source" }, { VarCharValue: "label" }, { VarCharValue: "ingested_at" }] },
        { Data: [{ VarCharValue: "hackernews" }, { VarCharValue: "Some title" }, { VarCharValue: "2026-09-19T10:00:00Z" }] },
      ]);

    const response = await GET();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.recordsToday).toBe(612);
    expect(body.sourcesHealthy).toBe(1);
    expect(body.sourcesTotal).toBe(5);
    expect(body.alarmsBreaching).toBe(1);
    expect(body.alarmsTotal).toBe(3);
    expect(body.recentActivity).toHaveLength(1);
  });

  it("returns 500 with a safe message when Athena fails", async () => {
    mockedRun.mockRejectedValueOnce(new Error("Athena query failed: table not found"));

    const response = await GET();
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error).toBe("Không tải được dữ liệu dashboard, thử lại sau.");
  });
});
