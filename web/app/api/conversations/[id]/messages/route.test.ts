import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/supabase", () => ({ getSupabaseClient: vi.fn(() => ({})) }));
vi.mock("@/lib/conversations", async () => {
  const actual = await vi.importActual<typeof import("@/lib/conversations")>("@/lib/conversations");
  return { ...actual, listMessagesForConversation: vi.fn() };
});

import { listMessagesForConversation } from "@/lib/conversations";
import { GET } from "./route";

const mockedList = vi.mocked(listMessagesForConversation);

function makeRequest(sessionId?: string): NextRequest {
  const headers: Record<string, string> = {};
  if (sessionId !== undefined) headers["x-session-id"] = sessionId;
  return new NextRequest("http://localhost/api/conversations/some-id/messages", { headers });
}

function params(id = "some-id") {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  mockedList.mockReset();
});

describe("GET /api/conversations/:id/messages", () => {
  it("returns 400 when X-Session-Id is missing", async () => {
    const response = await GET(makeRequest(), params());
    expect(response.status).toBe(400);
  });

  it("returns 404 when the conversation isn't owned by this session", async () => {
    mockedList.mockResolvedValue(null);

    const response = await GET(makeRequest("session-1"), params());

    expect(response.status).toBe(404);
  });

  it("returns the mapped message history", async () => {
    mockedList.mockResolvedValue([
      {
        id: "m1",
        question: "q",
        answer: "a",
        grounded: true,
        tool_calls: [{ tool: "search_web" }],
        sources: [{ title: "t", url: "u", source: "web" }],
        created_at: "2026-09-25T10:00:00Z",
      },
    ]);

    const response = await GET(makeRequest("session-1"), params());

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.messages).toEqual([
      {
        id: "m1",
        question: "q",
        answer: "a",
        grounded: true,
        toolCalls: [{ tool: "search_web" }],
        sources: [{ title: "t", url: "u", source: "web" }],
        createdAt: "2026-09-25T10:00:00Z",
      },
    ]);
  });
});
