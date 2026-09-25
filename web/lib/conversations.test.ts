import { describe, expect, it, vi } from "vitest";
import {
  formatDateTitle,
  nextConversationTitle,
  toConversationJSON,
  getSessionIdHeader,
  MAX_TITLE_LENGTH,
} from "./conversations";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  listConversations,
  createConversation,
  renameConversation,
  deleteConversation,
  conversationBelongsToSession,
  listMessagesForConversation,
  insertMessage,
} from "./conversations";

describe("formatDateTitle", () => {
  it("formats as dd/mm/yy using UTC, zero-padded", () => {
    const date = new Date(Date.UTC(2026, 8, 5)); // month is 0-indexed: 8 = September
    expect(formatDateTitle(date)).toBe("05/09/26");
  });
});

describe("nextConversationTitle", () => {
  it("returns the base title when no conversation has it yet", () => {
    expect(nextConversationTitle("25/09/26", [])).toBe("25/09/26");
  });

  it("returns the base title when existing titles don't match it at all", () => {
    expect(nextConversationTitle("25/09/26", ["24/09/26", "some renamed chat"])).toBe("25/09/26");
  });

  it("suffixes (2) when exactly one conversation already has the base title", () => {
    expect(nextConversationTitle("25/09/26", ["25/09/26"])).toBe("25/09/26 (2)");
  });

  it("suffixes (3) when the base title and one (2)-suffixed title already exist", () => {
    expect(nextConversationTitle("25/09/26", ["25/09/26", "25/09/26 (2)"])).toBe("25/09/26 (3)");
  });

  it("does not treat an unrelated title that merely starts with the base as a match", () => {
    expect(nextConversationTitle("25/09/26", ["25/09/26 something else entirely"])).toBe(
      "25/09/26"
    );
  });
});

describe("toConversationJSON", () => {
  it("maps snake_case row fields to camelCase", () => {
    const row = { id: "abc", title: "25/09/26", updated_at: "2026-09-25T10:00:00Z" };
    expect(toConversationJSON(row)).toEqual({ id: "abc", title: "25/09/26", updatedAt: "2026-09-25T10:00:00Z" });
  });
});

describe("getSessionIdHeader", () => {
  it("returns the trimmed header value when present", () => {
    const headers = new Headers({ "x-session-id": "  abc-123  " });
    expect(getSessionIdHeader(headers)).toBe("abc-123");
  });

  it("returns null when the header is missing", () => {
    const headers = new Headers();
    expect(getSessionIdHeader(headers)).toBeNull();
  });

  it("returns null when the header is present but blank", () => {
    const headers = new Headers({ "x-session-id": "   " });
    expect(getSessionIdHeader(headers)).toBeNull();
  });
});

describe("MAX_TITLE_LENGTH", () => {
  it("is 100", () => {
    expect(MAX_TITLE_LENGTH).toBe(100);
  });
});

function makeQueryBuilder(result: { data: unknown; error: unknown }) {
  const builder: Record<string, unknown> = {};
  const chain = (returnBuilder = true) =>
    vi.fn(() => (returnBuilder ? builder : Promise.resolve(result)));
  builder.select = chain();
  builder.eq = chain();
  builder.order = chain();
  builder.insert = chain();
  builder.update = chain();
  builder.delete = chain();
  builder.single = chain(false);
  builder.maybeSingle = chain(false);
  builder.then = (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve);
  return builder;
}

function makeClient(builder: ReturnType<typeof makeQueryBuilder>): SupabaseClient {
  return { from: vi.fn(() => builder) } as unknown as SupabaseClient;
}

describe("listConversations", () => {
  it("returns the rows from the query", async () => {
    const rows = [{ id: "1", title: "25/09/26", updated_at: "2026-09-25T10:00:00Z" }];
    const client = makeClient(makeQueryBuilder({ data: rows, error: null }));

    const result = await listConversations(client, "session-1");

    expect(result).toEqual(rows);
  });

  it("returns an empty array when data is null", async () => {
    const client = makeClient(makeQueryBuilder({ data: null, error: null }));

    const result = await listConversations(client, "session-1");

    expect(result).toEqual([]);
  });

  it("throws when Supabase returns an error", async () => {
    const client = makeClient(makeQueryBuilder({ data: null, error: new Error("boom") }));

    await expect(listConversations(client, "session-1")).rejects.toThrow("boom");
  });
});

describe("createConversation", () => {
  it("computes the title from existing titles, then inserts and returns the new row", async () => {
    const builder = makeQueryBuilder({ data: null, error: null });
    // First call in createConversation is the title-collision select (ends via
    // the thenable, not .single()); second is the insert (ends via .single()).
    let call = 0;
    builder.then = (resolve: (value: unknown) => unknown) => {
      call += 1;
      return Promise.resolve(
        call === 1 ? { data: [{ title: "25/09/26" }], error: null } : { data: null, error: null }
      ).then(resolve);
    };
    const inserted = { id: "new-id", title: "25/09/26 (2)", updated_at: "2026-09-25T10:00:00Z" };
    (builder.single as ReturnType<typeof vi.fn>).mockReturnValue(Promise.resolve({ data: inserted, error: null }));
    const client = makeClient(builder);

    const result = await createConversation(client, "session-1");

    expect(result).toEqual(inserted);
  });
});

describe("renameConversation", () => {
  it("returns the updated row when the conversation belongs to this session", async () => {
    const updated = { id: "1", title: "new title", updated_at: "2026-09-25T10:05:00Z" };
    const client = makeClient(makeQueryBuilder({ data: updated, error: null }));

    const result = await renameConversation(client, "session-1", "1", "new title");

    expect(result).toEqual(updated);
  });

  it("returns null when no row matches (wrong session or missing id)", async () => {
    const client = makeClient(makeQueryBuilder({ data: null, error: null }));

    const result = await renameConversation(client, "session-1", "not-mine", "new title");

    expect(result).toBeNull();
  });
});

describe("deleteConversation", () => {
  it("returns true when a row was deleted", async () => {
    const client = makeClient(makeQueryBuilder({ data: { id: "1" }, error: null }));

    expect(await deleteConversation(client, "session-1", "1")).toBe(true);
  });

  it("returns false when no row matched", async () => {
    const client = makeClient(makeQueryBuilder({ data: null, error: null }));

    expect(await deleteConversation(client, "session-1", "not-mine")).toBe(false);
  });
});

describe("conversationBelongsToSession", () => {
  it("returns true when the conversation exists for this session", async () => {
    const client = makeClient(makeQueryBuilder({ data: { id: "1" }, error: null }));

    expect(await conversationBelongsToSession(client, "session-1", "1")).toBe(true);
  });

  it("returns false when it doesn't", async () => {
    const client = makeClient(makeQueryBuilder({ data: null, error: null }));

    expect(await conversationBelongsToSession(client, "session-1", "not-mine")).toBe(false);
  });
});

describe("listMessagesForConversation", () => {
  it("returns null when the conversation doesn't belong to this session", async () => {
    const client = makeClient(makeQueryBuilder({ data: null, error: null }));

    const result = await listMessagesForConversation(client, "session-1", "not-mine");

    expect(result).toBeNull();
  });

  it("returns the messages when the conversation belongs to this session", async () => {
    // conversationBelongsToSession's query ends in .maybeSingle() (mocked
    // directly below, bypassing the builder's default `then`); the actual
    // messages query below it has no .single()/.maybeSingle() call, so it
    // resolves through the builder's default `then` -- set that default
    // result to the messages payload directly, no call-counter needed.
    const messages = [
      {
        id: "m1",
        question: "q",
        answer: "a",
        grounded: true,
        tool_calls: [],
        sources: [],
        created_at: "2026-09-25T10:00:00Z",
      },
    ];
    const builder = makeQueryBuilder({ data: messages, error: null });
    (builder.maybeSingle as ReturnType<typeof vi.fn>).mockReturnValue(
      Promise.resolve({ data: { id: "1" }, error: null })
    );
    const client = makeClient(builder);

    const result = await listMessagesForConversation(client, "session-1", "1");

    expect(result).toHaveLength(1);
    expect(result?.[0].question).toBe("q");
  });
});

describe("insertMessage", () => {
  it("inserts without throwing on success", async () => {
    const client = makeClient(makeQueryBuilder({ data: null, error: null }));

    await expect(
      insertMessage(client, "conv-1", {
        question: "q",
        answer: "a",
        grounded: true,
        toolCalls: [],
        sources: [],
      })
    ).resolves.toBeUndefined();
  });

  it("throws when Supabase returns an error", async () => {
    const client = makeClient(makeQueryBuilder({ data: null, error: new Error("boom") }));

    await expect(
      insertMessage(client, "conv-1", { question: "q", answer: "a", grounded: true, toolCalls: [], sources: [] })
    ).rejects.toThrow("boom");
  });
});
