import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/aws", () => ({
  getLambdaClient: vi.fn(),
  requiredEnv: vi.fn((name: string) => {
    if (name === "RAG_AGENT_FUNCTION_NAME") return "realtime-data-pipeline-dev-rag-agent";
    throw new Error(`unexpected requiredEnv(${name})`);
  }),
}));
vi.mock("@/lib/ratelimit", () => ({ checkRateLimit: vi.fn() }));

import { getLambdaClient } from "@/lib/aws";
import { checkRateLimit } from "@/lib/ratelimit";
import { POST } from "./route";

const mockedGetLambdaClient = vi.mocked(getLambdaClient);
const mockedCheckRateLimit = vi.mocked(checkRateLimit);

function makeRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/assistant", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json", "x-forwarded-for": "9.9.9.9" },
  });
}

beforeEach(() => {
  mockedCheckRateLimit.mockReset();
  mockedGetLambdaClient.mockReset();
});

describe("POST /api/assistant", () => {
  it("returns 400 for a missing question", async () => {
    const response = await POST(makeRequest({}));
    expect(response.status).toBe(400);
  });

  it("returns 429 when rate limited", async () => {
    mockedCheckRateLimit.mockResolvedValue({ allowed: false, remaining: 0 });
    const response = await POST(makeRequest({ question: "hi" }));
    expect(response.status).toBe(429);
    expect(mockedGetLambdaClient).not.toHaveBeenCalled();
  });

  it("returns the normalized result on success", async () => {
    mockedCheckRateLimit.mockResolvedValue({ allowed: true, remaining: 4 });
    const payload = {
      statusCode: 200,
      question: "hi",
      answer: "answer text",
      grounded: true,
      tool_calls: [{ tool: "search_knowledge_base", input: { query: "hi" }, result_count: 3 }],
      sources: [],
    };
    mockedGetLambdaClient.mockReturnValue({
      send: vi.fn().mockResolvedValue({ Payload: Buffer.from(JSON.stringify(payload)) }),
    } as never);

    const response = await POST(makeRequest({ question: "hi" }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.answer).toBe("answer text");
    expect(body.toolCalls).toEqual([{ tool: "search_knowledge_base", input: { query: "hi" }, result_count: 3 }]);
  });

  it("returns 502 when the Lambda itself reports an error", async () => {
    mockedCheckRateLimit.mockResolvedValue({ allowed: true, remaining: 4 });
    mockedGetLambdaClient.mockReturnValue({
      send: vi.fn().mockResolvedValue({
        Payload: Buffer.from(JSON.stringify({ statusCode: 400, error: "Missing 'question' in event" })),
      }),
    } as never);

    const response = await POST(makeRequest({ question: "hi" }));
    expect(response.status).toBe(502);
  });

  it("returns 400 when the question exceeds the max length", async () => {
    const response = await POST(makeRequest({ question: "x".repeat(501) }));
    expect(response.status).toBe(400);
    expect(mockedCheckRateLimit).not.toHaveBeenCalled();
  });

  it("uses the rightmost X-Forwarded-For hop as the rate limit identifier", async () => {
    mockedCheckRateLimit.mockResolvedValue({ allowed: true, remaining: 4 });
    const payload = {
      statusCode: 200,
      question: "hi",
      answer: "answer text",
      grounded: true,
      tool_calls: [],
      sources: [],
    };
    mockedGetLambdaClient.mockReturnValue({
      send: vi.fn().mockResolvedValue({ Payload: Buffer.from(JSON.stringify(payload)) }),
    } as never);

    const request = new NextRequest("http://localhost/api/assistant", {
      method: "POST",
      body: JSON.stringify({ question: "hi" }),
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": "1.2.3.4, 5.6.7.8",
      },
    });

    const response = await POST(request);
    expect(response.status).toBe(200);
    expect(mockedCheckRateLimit).toHaveBeenCalledWith("5.6.7.8");
  });

  it("returns 500 when a required environment variable is missing", async () => {
    mockedCheckRateLimit.mockResolvedValue({ allowed: true, remaining: 4 });
    const { requiredEnv } = await import("@/lib/aws");
    vi.mocked(requiredEnv).mockImplementationOnce(() => {
      throw new Error("Environment variable RAG_AGENT_FUNCTION_NAME is required but was not set");
    });

    const response = await POST(makeRequest({ question: "hi" }));
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error).toBe("Không gọi được RAG Lambda, thử lại sau.");
  });
});
