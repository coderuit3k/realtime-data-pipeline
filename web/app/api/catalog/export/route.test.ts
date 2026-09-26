import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/aws", () => ({
  getAthenaClient: vi.fn(() => ({})),
  requiredEnv: vi.fn((name: string) => `fake-${name}`),
}));
vi.mock("@/lib/ratelimit", () => ({
  checkRateLimit: vi.fn(),
  getExportLimiter: vi.fn(() => "export-limiter-marker"),
}));
vi.mock("@/lib/athena", async () => {
  // Keep the real parseAthenaRows (route.ts uses it on runAthenaQueryWithStats's
  // output) while mocking only the network-calling function.
  const actual = await vi.importActual<typeof import("@/lib/athena")>("@/lib/athena");
  return { ...actual, runAthenaQueryWithStats: vi.fn() };
});
vi.mock("@/lib/excelExport", () => ({ buildCatalogWorkbook: vi.fn() }));
vi.mock("@/lib/r2", () => ({ getR2Client: vi.fn(() => ({})), uploadAndPresign: vi.fn() }));

import { checkRateLimit } from "@/lib/ratelimit";
import { runAthenaQueryWithStats, partitionWhere, todayUtcParts } from "@/lib/athena";
import { buildCatalogWorkbook } from "@/lib/excelExport";
import { uploadAndPresign } from "@/lib/r2";
import { POST } from "./route";

const mockedCheckRateLimit = vi.mocked(checkRateLimit);
const mockedRun = vi.mocked(runAthenaQueryWithStats);
const mockedBuild = vi.mocked(buildCatalogWorkbook);
const mockedUpload = vi.mocked(uploadAndPresign);

function makeRequest(body?: unknown): NextRequest {
  return new NextRequest("http://localhost/api/catalog/export", {
    method: "POST",
    headers: { "x-forwarded-for": "9.9.9.9" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function athenaRow(value: string) {
  return { Data: [{ VarCharValue: value }] };
}

beforeEach(() => {
  mockedCheckRateLimit.mockReset();
  mockedRun.mockReset();
  mockedBuild.mockReset();
  mockedUpload.mockReset();
});

describe("POST /api/catalog/export", () => {
  it("returns 429 and never queries Athena when rate limited", async () => {
    mockedCheckRateLimit.mockResolvedValue({ allowed: false, remaining: 0 });

    const response = await POST(makeRequest());

    expect(response.status).toBe(429);
    expect(mockedCheckRateLimit).toHaveBeenCalledWith("9.9.9.9", "export-limiter-marker");
    expect(mockedRun).not.toHaveBeenCalled();
  });

  it("queries all 5 curated tables, builds one workbook, and returns the presigned url", async () => {
    mockedCheckRateLimit.mockResolvedValue({ allowed: true, remaining: 2 });
    mockedRun.mockResolvedValue({
      columns: ["a"],
      rows: [athenaRow("a"), athenaRow("1")],
      stats: { dataScannedInBytes: 0, engineExecutionTimeMs: 0 },
      hasMoreRows: false,
    });
    mockedBuild.mockResolvedValue(Buffer.from("fake-xlsx"));
    mockedUpload.mockResolvedValue("https://example.r2.dev/signed-url");

    const response = await POST(makeRequest());

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.url).toBe("https://example.r2.dev/signed-url");
    expect(mockedRun).toHaveBeenCalledTimes(5);
    const where = partitionWhere(todayUtcParts());
    expect(mockedRun).toHaveBeenCalledWith(
      expect.anything(),
      `SELECT * FROM hackernews_stories ${where} ORDER BY ingested_at DESC LIMIT 999`,
      1000
    );
    expect(mockedBuild).toHaveBeenCalledWith([
      { name: "hackernews_stories", columns: ["a"], rows: [["1"]] },
      { name: "news_articles", columns: ["a"], rows: [["1"]] },
      { name: "github_repos", columns: ["a"], rows: [["1"]] },
      { name: "weather_observations", columns: ["a"], rows: [["1"]] },
      { name: "crypto_prices", columns: ["a"], rows: [["1"]] },
    ]);
    expect(mockedUpload).toHaveBeenCalledWith(
      expect.anything(),
      "fake-R2_EXCEL_BUCKET_NAME",
      expect.stringMatching(/^exports\/catalog-.*\.xlsx$/),
      Buffer.from("fake-xlsx"),
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
  });

  it("exports only the requested table as a single sheet", async () => {
    mockedCheckRateLimit.mockResolvedValue({ allowed: true, remaining: 2 });
    mockedRun.mockResolvedValue({
      columns: ["coin_id"],
      rows: [athenaRow("coin_id"), athenaRow("bitcoin")],
      stats: { dataScannedInBytes: 0, engineExecutionTimeMs: 0 },
      hasMoreRows: false,
    });
    mockedBuild.mockResolvedValue(Buffer.from("fake-xlsx"));
    mockedUpload.mockResolvedValue("https://example.r2.dev/signed-url");

    const response = await POST(makeRequest({ table: "crypto_prices" }));

    expect(response.status).toBe(200);
    expect(mockedRun).toHaveBeenCalledTimes(1);
    const where = partitionWhere(todayUtcParts());
    expect(mockedRun).toHaveBeenCalledWith(
      expect.anything(),
      `SELECT * FROM crypto_prices ${where} ORDER BY ingested_at DESC LIMIT 999`,
      1000
    );
    expect(mockedBuild).toHaveBeenCalledWith([
      { name: "crypto_prices", columns: ["coin_id"], rows: [["bitcoin"]] },
    ]);
    expect(mockedUpload).toHaveBeenCalledWith(
      expect.anything(),
      "fake-R2_EXCEL_BUCKET_NAME",
      expect.stringMatching(/^exports\/catalog-crypto_prices-.*\.xlsx$/),
      Buffer.from("fake-xlsx"),
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
  });

  it("rejects a table name that isn't one of the 5 curated tables, without querying Athena", async () => {
    mockedCheckRateLimit.mockResolvedValue({ allowed: true, remaining: 2 });

    const response = await POST(makeRequest({ table: "gmail_messages" }));

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("Bảng không hợp lệ.");
    expect(mockedCheckRateLimit).not.toHaveBeenCalled();
    expect(mockedRun).not.toHaveBeenCalled();
  });

  it("returns a safe 500 and never uploads when an Athena query fails", async () => {
    mockedCheckRateLimit.mockResolvedValue({ allowed: true, remaining: 2 });
    mockedRun.mockRejectedValue(new Error("Athena query failed: some real AWS internals, ARNs, etc"));

    const response = await POST(makeRequest());

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error).toBe("Không xuất được file Excel, thử lại sau.");
    expect(body.error).not.toContain("ARN");
    expect(mockedUpload).not.toHaveBeenCalled();
  });
});
