// web/app/api/weather/history/route.test.ts
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

function athenaRows(rows: string[][]) {
  return [{ Data: [] }, ...rows.map((cols) => ({ Data: cols.map((v) => ({ VarCharValue: v })) }))];
}

function requestFor(location: string | null) {
  const url = location === null ? "http://localhost/api/weather/history" : `http://localhost/api/weather/history?location=${encodeURIComponent(location)}`;
  return new NextRequest(url);
}

beforeEach(() => {
  mockedRun.mockReset();
});

describe("GET /api/weather/history", () => {
  it("returns the hourly-bucketed history for a known location", async () => {
    mockedRun.mockResolvedValue(
      athenaRows([
        ["2026-09-20 10:00:00.000", "18.5"],
        ["2026-09-20 11:00:00.000", "19.2"],
      ])
    );

    const response = await GET(requestFor("Da Lat"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      location: "Da Lat",
      points: [
        { hourBucket: "2026-09-20 10:00:00.000", avgTemperatureC: 18.5 },
        { hourBucket: "2026-09-20 11:00:00.000", avgTemperatureC: 19.2 },
      ],
    });
  });

  it("returns 400 without querying Athena for an unknown location", async () => {
    const response = await GET(requestFor("Hanoi"));
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("Không tìm thấy địa điểm.");
    expect(mockedRun).not.toHaveBeenCalled();
  });

  it("returns 400 without querying Athena when location is missing", async () => {
    const response = await GET(requestFor(null));
    expect(response.status).toBe(400);
    expect(mockedRun).not.toHaveBeenCalled();
  });

  it("returns 500 with a safe message when the query fails for a known location", async () => {
    mockedRun.mockRejectedValue(new Error("Athena query failed: boom"));
    const response = await GET(requestFor("Da Lat"));
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error).toBe("Không tải được thời tiết, thử lại sau.");
  });
});
