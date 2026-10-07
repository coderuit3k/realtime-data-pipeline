import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/aws", () => ({
  getS3Client: vi.fn(() => ({})),
  requiredEnv: vi.fn(() => "curated-bucket"),
}));
vi.mock("@/lib/gmailStats", async () => {
  const actual = await vi.importActual<typeof import("@/lib/gmailStats")>("@/lib/gmailStats");
  return { ...actual, fetchGmailStats: vi.fn() };
});

import { fetchGmailStats } from "@/lib/gmailStats";
import { GET } from "./route";

const mocked = vi.mocked(fetchGmailStats);

beforeEach(() => mocked.mockReset());

describe("GET /api/gmail-stats", () => {
  it("returns the stats", async () => {
    const stats = { generatedAt: "t", windowDays: 14 } as never;
    mocked.mockResolvedValueOnce(stats);

    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ stats });
    expect(response.headers.get("Cache-Control")).toContain("s-maxage=300");
  });

  it("returns stats: null before the first file exists", async () => {
    mocked.mockResolvedValueOnce(null);

    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ stats: null });
  });

  it("returns a 500 with a Vietnamese message when S3 fails", async () => {
    mocked.mockRejectedValueOnce(new Error("denied"));

    const response = await GET();

    expect(response.status).toBe(500);
    expect((await response.json()).error).toMatch(/Gmail/);
  });
});
