import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/aws", () => ({ getAthenaClient: vi.fn(() => ({})) }));
vi.mock("@/lib/athena", async () => {
  const actual = await vi.importActual<typeof import("@/lib/athena")>("@/lib/athena");
  return { ...actual, runAthenaQuery: vi.fn() };
});

import { runAthenaQuery } from "@/lib/athena";
import { GET } from "./route";

const mockedRun = vi.mocked(runAthenaQuery);

function rows(header: string[], data: string[][]) {
  return [
    { Data: header.map((h) => ({ VarCharValue: h })) },
    ...data.map((row) => ({ Data: row.map((v) => ({ VarCharValue: v })) })),
  ];
}

const COLUMNS = ["event_id", "keyword", "event_date", "github_count", "hn_count", "news_count"];

beforeEach(() => {
  mockedRun.mockReset();
});

describe("GET /api/trends", () => {
  it("returns parsed trend events", async () => {
    mockedRun.mockResolvedValueOnce(
      rows(COLUMNS, [["deepseek-2026-09-27", "deepseek", "2026-09-27", "2", "5", "3"]])
    );

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.events).toEqual([
      {
        eventId: "deepseek-2026-09-27",
        keyword: "deepseek",
        eventDate: "2026-09-27",
        githubCount: 2,
        hnCount: 5,
        newsCount: 3,
      },
    ]);
  });

  it("returns an empty list when there are no trend events yet", async () => {
    mockedRun.mockResolvedValueOnce(rows(COLUMNS, []));

    const response = await GET();
    const body = await response.json();

    expect(body.events).toEqual([]);
  });

  it("returns 500 with a safe message when Athena fails", async () => {
    mockedRun.mockRejectedValueOnce(new Error("Athena query failed: table not found"));

    const response = await GET();

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error).toBe("Không tải được Trends, thử lại sau.");
  });
});
