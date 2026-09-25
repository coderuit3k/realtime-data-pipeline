import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/supabase", () => ({ getSupabaseClient: vi.fn(() => ({})) }));
vi.mock("@/lib/conversations", async () => {
  const actual = await vi.importActual<typeof import("@/lib/conversations")>("@/lib/conversations");
  return { ...actual, listConversations: vi.fn(), createConversation: vi.fn() };
});
vi.mock("@/lib/ratelimit", () => ({
  checkRateLimit: vi.fn(),
  getConversationLimiter: vi.fn(() => "the-limiter"),
}));

import { listConversations, createConversation } from "@/lib/conversations";
import { checkRateLimit } from "@/lib/ratelimit";
import { GET, POST } from "./route";

const mockedList = vi.mocked(listConversations);
const mockedCreate = vi.mocked(createConversation);
const mockedCheckRateLimit = vi.mocked(checkRateLimit);

function makeRequest(method: string, sessionId?: string): NextRequest {
  const headers: Record<string, string> = {};
  if (sessionId !== undefined) headers["x-session-id"] = sessionId;
  return new NextRequest("http://localhost/api/conversations", { method, headers });
}

beforeEach(() => {
  mockedList.mockReset();
  mockedCreate.mockReset();
  mockedCheckRateLimit.mockReset();
});

describe("GET /api/conversations", () => {
  it("returns 400 when X-Session-Id is missing", async () => {
    const response = await GET(makeRequest("GET"));
    expect(response.status).toBe(400);
  });

  it("returns the mapped conversation list", async () => {
    mockedList.mockResolvedValue([{ id: "1", title: "25/09/26", updated_at: "2026-09-25T10:00:00Z" }]);

    const response = await GET(makeRequest("GET", "session-1"));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.conversations).toEqual([{ id: "1", title: "25/09/26", updatedAt: "2026-09-25T10:00:00Z" }]);
  });

  it("returns 500 when the data layer throws", async () => {
    mockedList.mockRejectedValue(new Error("db down"));

    const response = await GET(makeRequest("GET", "session-1"));

    expect(response.status).toBe(500);
  });
});

describe("POST /api/conversations", () => {
  it("returns 400 when X-Session-Id is missing", async () => {
    const response = await POST(makeRequest("POST"));
    expect(response.status).toBe(400);
    expect(mockedCheckRateLimit).not.toHaveBeenCalled();
  });

  it("returns 429 when rate limited, without creating a conversation", async () => {
    mockedCheckRateLimit.mockResolvedValue({ allowed: false, remaining: 0 });

    const response = await POST(makeRequest("POST", "session-1"));

    expect(response.status).toBe(429);
    expect(mockedCreate).not.toHaveBeenCalled();
  });

  it("creates and returns the new conversation", async () => {
    mockedCheckRateLimit.mockResolvedValue({ allowed: true, remaining: 9 });
    mockedCreate.mockResolvedValue({ id: "new-id", title: "25/09/26", updated_at: "2026-09-25T10:00:00Z" });

    const response = await POST(makeRequest("POST", "session-1"));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ id: "new-id", title: "25/09/26", updatedAt: "2026-09-25T10:00:00Z" });
  });
});
