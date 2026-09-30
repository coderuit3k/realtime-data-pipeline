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
vi.mock("@/lib/supabase", () => ({ getSupabaseClient: vi.fn(() => ({})) }));
vi.mock("@/lib/conversations", async () => {
  const actual = await vi.importActual<typeof import("@/lib/conversations")>("@/lib/conversations");
  return {
    ...actual,
    listMessagesForConversation: vi.fn(),
    insertMessage: vi.fn(),
  };
});

import { getLambdaClient } from "@/lib/aws";
import { checkRateLimit } from "@/lib/ratelimit";
import { listMessagesForConversation, insertMessage } from "@/lib/conversations";
import { POST } from "./route";

const mockedGetLambdaClient = vi.mocked(getLambdaClient);
const mockedCheckRateLimit = vi.mocked(checkRateLimit);
const mockedListMessages = vi.mocked(listMessagesForConversation);
const mockedInsertMessage = vi.mocked(insertMessage);

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
  mockedListMessages.mockReset();
  mockedInsertMessage.mockReset();
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

  it("returns 404 without calling the Lambda when conversationId belongs to a different session", async () => {
    mockedCheckRateLimit.mockResolvedValue({ allowed: true, remaining: 4 });
    mockedListMessages.mockResolvedValue(null);

    const request = new NextRequest("http://localhost/api/assistant", {
      method: "POST",
      body: JSON.stringify({ question: "hi", conversationId: "not-mine" }),
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": "9.9.9.9",
        "x-session-id": "session-1",
      },
    });

    const response = await POST(request);

    expect(response.status).toBe(404);
    expect(mockedGetLambdaClient).not.toHaveBeenCalled();
  });

  it("persists the turn to the conversation on success", async () => {
    mockedCheckRateLimit.mockResolvedValue({ allowed: true, remaining: 4 });
    mockedListMessages.mockResolvedValue([]);
    mockedInsertMessage.mockResolvedValue(undefined);
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
      body: JSON.stringify({ question: "hi", conversationId: "conv-1" }),
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": "9.9.9.9",
        "x-session-id": "session-1",
      },
    });

    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(mockedInsertMessage).toHaveBeenCalledWith(
      expect.anything(),
      "conv-1",
      expect.objectContaining({ question: "hi", answer: "answer text", grounded: true })
    );
  });

  it("still returns the real answer when persisting the turn fails", async () => {
    mockedCheckRateLimit.mockResolvedValue({ allowed: true, remaining: 4 });
    mockedListMessages.mockResolvedValue([]);
    mockedInsertMessage.mockRejectedValue(new Error("db down"));
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
      body: JSON.stringify({ question: "hi", conversationId: "conv-1" }),
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": "9.9.9.9",
        "x-session-id": "session-1",
      },
    });

    const response = await POST(request);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.answer).toBe("answer text");
  });

  it("skips persistence entirely when no conversationId is given (unchanged behavior)", async () => {
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

    const response = await POST(makeRequest({ question: "hi" }));

    expect(response.status).toBe(200);
    expect(mockedListMessages).not.toHaveBeenCalled();
    expect(mockedInsertMessage).not.toHaveBeenCalled();
  });

  it("sends prior conversation turns as context to the Lambda, but keeps the original question in the response", async () => {
    mockedCheckRateLimit.mockResolvedValue({ allowed: true, remaining: 4 });
    mockedListMessages.mockResolvedValue([
      {
        id: "m1",
        question: "Ngày nào GitHub có nhiều repo mới nhất?",
        answer: "Ngày 23/09 và 24/09, mỗi ngày 2,880 repo.",
        grounded: true,
        tool_calls: [],
        sources: [],
        created_at: "2026-09-29T00:00:00Z",
      },
    ]);
    mockedInsertMessage.mockResolvedValue(undefined);
    const payload = {
      statusCode: 200,
      // The Lambda echoes back whatever it was sent -- simulate it echoing
      // the context-augmented question, to prove the route overrides it.
      question: "Các câu hỏi/trả lời trước đó...\n\nCâu hỏi hiện tại, trả lời đúng câu này: Vậy tại sao?",
      answer: "Vì đợt đó có nhiều repo mới được tạo hàng loạt.",
      grounded: true,
      tool_calls: [],
      sources: [],
    };
    const send = vi.fn().mockResolvedValue({ Payload: Buffer.from(JSON.stringify(payload)) });
    mockedGetLambdaClient.mockReturnValue({ send } as never);

    const request = new NextRequest("http://localhost/api/assistant", {
      method: "POST",
      body: JSON.stringify({ question: "Vậy tại sao?", conversationId: "conv-1" }),
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": "9.9.9.9",
        "x-session-id": "session-1",
      },
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.question).toBe("Vậy tại sao?");

    const invokeArg = send.mock.calls[0][0];
    const sentPayload = JSON.parse(Buffer.from(invokeArg.input.Payload).toString("utf-8"));
    expect(sentPayload.question).toContain("Ngày nào GitHub có nhiều repo mới nhất?");
    expect(sentPayload.question).toContain("Vậy tại sao?");

    expect(mockedInsertMessage).toHaveBeenCalledWith(
      expect.anything(),
      "conv-1",
      expect.objectContaining({ question: "Vậy tại sao?" })
    );
  });
});
