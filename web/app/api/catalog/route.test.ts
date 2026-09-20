import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/aws", () => ({
  getGlueClient: vi.fn(() => ({})),
  requiredEnv: vi.fn((name: string) => {
    if (name === "ATHENA_DATABASE") return "curated_db";
    throw new Error(`unexpected requiredEnv(${name})`);
  }),
}));

vi.mock("@/lib/glue", () => ({
  listCuratedTables: vi.fn(),
}));

import { listCuratedTables } from "@/lib/glue";
import { GET } from "./route";

const mockedList = vi.mocked(listCuratedTables);

beforeEach(() => {
  mockedList.mockReset();
});

describe("GET /api/catalog", () => {
  it("merges live schema with static catalog metadata", async () => {
    mockedList.mockResolvedValueOnce([
      {
        name: "crypto_prices",
        location: "s3://real-bucket/curated/source=crypto/",
        columns: [{ name: "price_usd", type: "double" }],
      },
    ]);

    const response = await GET();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual([
      {
        name: "crypto_prices",
        location: "s3://real-bucket/curated/source=crypto/",
        columns: [{ name: "price_usd", type: "double", note: "ép float khi ingest (tránh HIVE_BAD_DATA vì CoinGecko trả số nguyên)" }],
        ragIndexed: false,
        sourceApi: "CoinGecko /simple/price",
        ingestionLambda: "crypto-ingestion",
        cadence: "mỗi 10 phút",
      },
    ]);
  });

  it("defaults metadata for a table not present in CATALOG_META, without throwing", async () => {
    mockedList.mockResolvedValueOnce([
      { name: "future_table", location: "s3://real-bucket/curated/source=future/", columns: [] },
    ]);

    const response = await GET();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body[0].ragIndexed).toBe(false);
    expect(body[0].cadence).toBe("");
  });

  it("returns 500 with a safe message when Glue fails", async () => {
    mockedList.mockRejectedValueOnce(new Error("AccessDenied"));

    const response = await GET();
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error).toBe("Không tải được Data Catalog, thử lại sau.");
  });
});
