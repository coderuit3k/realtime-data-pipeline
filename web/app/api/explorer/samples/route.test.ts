import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/aws", () => ({
  requiredEnv: vi.fn((name: string) => {
    if (name === "ATHENA_WORKGROUP") return "realtime-data-pipeline-dev-analytics";
    if (name === "ATHENA_DATABASE") return "realtime_data_pipeline_dev_curated";
    throw new Error(`unexpected requiredEnv(${name})`);
  }),
}));

import { GET } from "./route";

describe("GET /api/explorer/samples", () => {
  it("returns the workgroup, database, and 3 sample query groups", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.workgroup).toBe("realtime-data-pipeline-dev-analytics");
    expect(body.database).toBe("realtime_data_pipeline_dev_curated");
    expect(body.groups).toHaveLength(3);
    expect(body.groups.flatMap((g: { queries: unknown[] }) => g.queries)).toHaveLength(7);
  });

  it("returns 500 with a safe message when a required env var is missing", async () => {
    const { requiredEnv } = await import("@/lib/aws");
    vi.mocked(requiredEnv).mockImplementationOnce(() => {
      throw new Error("Missing required environment variable: ATHENA_WORKGROUP");
    });

    const response = await GET();
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error).toBe("Không tải được danh sách truy vấn mẫu, thử lại sau.");
  });
});
