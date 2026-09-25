import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/supabase", () => ({ getSupabaseClient: vi.fn(() => ({})) }));
vi.mock("@/lib/conversations", async () => {
  const actual = await vi.importActual<typeof import("@/lib/conversations")>("@/lib/conversations");
  return { ...actual, renameConversation: vi.fn(), deleteConversation: vi.fn() };
});

import { renameConversation, deleteConversation } from "@/lib/conversations";
import { PATCH, DELETE } from "./route";

const mockedRename = vi.mocked(renameConversation);
const mockedDelete = vi.mocked(deleteConversation);

function makeRequest(method: string, body?: unknown, sessionId = "session-1"): NextRequest {
  return new NextRequest("http://localhost/api/conversations/some-id", {
    method,
    headers: { "x-session-id": sessionId, "content-type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

function params(id = "some-id") {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  mockedRename.mockReset();
  mockedDelete.mockReset();
});

describe("PATCH /api/conversations/:id", () => {
  it("returns 400 when X-Session-Id is missing", async () => {
    const response = await PATCH(makeRequest("PATCH", { title: "x" }, ""), params());
    expect(response.status).toBe(400);
  });

  it("returns 400 for an empty-after-trim title", async () => {
    const response = await PATCH(makeRequest("PATCH", { title: "   " }), params());
    expect(response.status).toBe(400);
    expect(mockedRename).not.toHaveBeenCalled();
  });

  it("returns 400 for a title over the max length", async () => {
    const response = await PATCH(makeRequest("PATCH", { title: "x".repeat(101) }), params());
    expect(response.status).toBe(400);
    expect(mockedRename).not.toHaveBeenCalled();
  });

  it("returns 404 when the conversation isn't owned by this session", async () => {
    mockedRename.mockResolvedValue(null);

    const response = await PATCH(makeRequest("PATCH", { title: "new name" }), params());

    expect(response.status).toBe(404);
  });

  it("returns the renamed conversation on success", async () => {
    mockedRename.mockResolvedValue({ id: "some-id", title: "new name", updated_at: "2026-09-25T10:00:00Z" });

    const response = await PATCH(makeRequest("PATCH", { title: "new name" }), params());

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.title).toBe("new name");
  });
});

describe("DELETE /api/conversations/:id", () => {
  it("returns 400 when X-Session-Id is missing", async () => {
    const response = await DELETE(makeRequest("DELETE", undefined, ""), params());
    expect(response.status).toBe(400);
  });

  it("returns 404 when the conversation isn't owned by this session", async () => {
    mockedDelete.mockResolvedValue(false);

    const response = await DELETE(makeRequest("DELETE"), params());

    expect(response.status).toBe(404);
  });

  it("returns 200 on successful delete", async () => {
    mockedDelete.mockResolvedValue(true);

    const response = await DELETE(makeRequest("DELETE"), params());

    expect(response.status).toBe(200);
  });
});
