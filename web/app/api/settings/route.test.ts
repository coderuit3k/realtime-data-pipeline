// web/app/api/settings/route.test.ts
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/aws", () => ({
  getEventBridgeClient: vi.fn(() => ({})),
  getSecretsManagerClient: vi.fn(() => ({})),
  requiredEnv: vi.fn((name: string) => {
    if (name === "ALARM_NAME_PREFIX") return "test-prefix";
    if (name === "NEWS_SECRET_NAME") return "test-prefix/news-api";
    if (name === "TAVILY_SECRET_NAME") return "test-prefix/tavily-api";
    if (name === "QDRANT_SECRET_NAME") return "test-prefix/qdrant";
    if (name === "JINA_SECRET_NAME") return "test-prefix/jina-api";
    throw new Error(`unexpected env var: ${name}`);
  }),
}));
vi.mock("@/lib/eventbridge", () => ({ getScheduleStatus: vi.fn() }));
vi.mock("@/lib/secretsManager", () => ({ getSecretStatus: vi.fn() }));

import { getScheduleStatus } from "@/lib/eventbridge";
import { getSecretStatus } from "@/lib/secretsManager";
import { GET } from "./route";

const mockedSchedule = vi.mocked(getScheduleStatus);
const mockedSecret = vi.mocked(getSecretStatus);

beforeEach(() => {
  mockedSchedule.mockReset();
  mockedSecret.mockReset();
});

describe("GET /api/settings", () => {
  it("returns real schedule and secret status for both rules and all four secrets", async () => {
    mockedSchedule.mockImplementation((_client, ruleName: string) =>
      Promise.resolve(
        ruleName === "test-prefix-ingestion-schedule"
          ? { scheduleExpression: "rate(10 minutes)", enabled: true }
          : { scheduleExpression: "rate(20 minutes)", enabled: true }
      )
    );
    mockedSecret.mockResolvedValue({ configured: true });

    const response = await GET();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.sharedSchedule).toEqual({ scheduleExpression: "rate(10 minutes)", enabled: true });
    expect(body.newsSchedule).toEqual({ scheduleExpression: "rate(20 minutes)", enabled: true });
    expect(body.secrets).toEqual([
      { name: "news-api-key", configured: true },
      { name: "tavily-api-key", configured: true },
      { name: "qdrant-cloud", configured: true },
      { name: "jina-api-key", configured: true },
    ]);
    expect(mockedSchedule).toHaveBeenCalledWith(expect.anything(), "test-prefix-ingestion-schedule");
    expect(mockedSchedule).toHaveBeenCalledWith(expect.anything(), "test-prefix-news-ingestion-schedule");
    expect(mockedSecret).toHaveBeenCalledWith(expect.anything(), "test-prefix/news-api");
    expect(mockedSecret).toHaveBeenCalledWith(expect.anything(), "test-prefix/tavily-api");
    expect(mockedSecret).toHaveBeenCalledWith(expect.anything(), "test-prefix/qdrant");
    expect(mockedSecret).toHaveBeenCalledWith(expect.anything(), "test-prefix/jina-api");
  });

  it("reports configured: null for a secret that cannot be checked, without failing the page", async () => {
    mockedSchedule.mockResolvedValue({ scheduleExpression: "rate(10 minutes)", enabled: true });
    mockedSecret.mockImplementation((_client, secretId: string) =>
      secretId === "test-prefix/jina-api" ? Promise.reject(new Error("AccessDenied")) : Promise.resolve({ configured: false })
    );
    const response = await GET();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.secrets).toEqual([
      { name: "news-api-key", configured: false },
      { name: "tavily-api-key", configured: false },
      { name: "qdrant-cloud", configured: false },
      { name: "jina-api-key", configured: null },
    ]);
  });

  it("returns 500 with a safe message when a call fails", async () => {
    mockedSchedule.mockRejectedValue(new Error("boom"));
    mockedSecret.mockResolvedValue({ configured: true });
    const response = await GET();
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error).toBe("Không tải được Settings, thử lại sau.");
  });
});
