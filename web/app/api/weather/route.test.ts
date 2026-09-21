// web/app/api/weather/route.test.ts
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/aws", () => ({ getAthenaClient: vi.fn(() => ({})) }));
vi.mock("@/lib/athena", async () => {
  const actual = await vi.importActual<typeof import("@/lib/athena")>("@/lib/athena");
  return { ...actual, runAthenaQuery: vi.fn() };
});

import { runAthenaQuery } from "@/lib/athena";
import { GET } from "./route";

const mockedRun = vi.mocked(runAthenaQuery);

function athenaRows(rows: string[][]) {
  return [
    { Data: [] }, // header row, skipped by parseAthenaRows
    ...rows.map((cols) => ({ Data: cols.map((v) => ({ VarCharValue: v })) })),
  ];
}

beforeEach(() => {
  mockedRun.mockReset();
});

describe("GET /api/weather", () => {
  it("returns the mapped, sorted list of current readings", async () => {
    mockedRun.mockResolvedValue(
      athenaRows([
        ["Tay Ninh", "11.31", "106.0989", "32", "60", "0", "10", "2026-09-20T18:00:00"],
        ["Da Lat", "11.9404", "108.4583", "19", "85", "1.2", "8", "2026-09-20T18:00:00"],
      ])
    );

    const response = await GET();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.locations).toEqual([
      {
        location: "Tay Ninh",
        latitude: 11.31,
        longitude: 106.0989,
        temperatureC: 32,
        humidityPct: 60,
        precipitationMm: 0,
        windSpeedKmh: 10,
        observedAt: "2026-09-20T18:00:00",
      },
      {
        location: "Da Lat",
        latitude: 11.9404,
        longitude: 108.4583,
        temperatureC: 19,
        humidityPct: 85,
        precipitationMm: 1.2,
        windSpeedKmh: 8,
        observedAt: "2026-09-20T18:00:00",
      },
    ]);
  });

  it("returns 500 with a safe message when the query fails", async () => {
    mockedRun.mockRejectedValue(new Error("Athena query failed: boom"));
    const response = await GET();
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error).toBe("Không tải được thời tiết, thử lại sau.");
  });
});
