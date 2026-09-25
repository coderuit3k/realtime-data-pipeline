# RAG Assistant Conversations (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the RAG Assistant persisted, named, CRUD-able conversations (Zalo/Telegram-style) backed by a real Supabase Postgres database, with a 3-column UI (conversation list | chat | full tool-trace history).

**Architecture:** A new `web/lib/supabase.ts` client factory and `web/lib/conversations.ts` data-access module sit behind five API routes under `web/app/api/conversations/`. `web/app/api/assistant/route.ts` gains an optional `conversationId` and persists each real Q&A turn after the existing Lambda call succeeds. The frontend gets a new `ConversationList` component, an extended `ChatThread`, and a new `ToolTraceHistory` component, composed in a rewritten `web/app/assistant/page.tsx`. Anonymous per-browser identity via a `localStorage`-backed session ID, no login.

**Tech Stack:** Next.js 15 App Router, TypeScript, `@supabase/supabase-js` (new dependency), existing `@upstash/ratelimit`/`@upstash/redis`, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-25-rag-assistant-conversations-phase1-design.md`

## Global Constraints

- No login/auth of any kind. Identity is an anonymous per-browser session ID, generated client-side and stored in `localStorage` under the key `assistant_session_id`, sent as the `X-Session-Id` request header on every conversations/assistant call.
- Deletion is a **hard delete** (`on delete cascade` from `conversations` to `messages` — no soft-delete flag, no recovery).
- No changes to `rag/agent.py` or the deployed Lambda. `/api/assistant`'s call to it is unchanged; only persistence around that call is added. No conversation history is sent to Bedrock in this phase.
- No Redis caching layer in this phase. The only Redis touch is reusing the existing `@upstash/ratelimit` pattern for a new conversation-creation rate limit — same mechanism already protecting `/api/assistant`, `/api/explorer/query`, `/api/cost`.
- New env vars (user-provided via Vercel's env UI, never generated or seen by the implementer): `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.
- New dependency: `@supabase/supabase-js`.
- No component-rendering test infrastructure (standing project convention). Every testable unit takes its external client as a parameter (matching `lib/cloudwatchAlarms.ts`'s `getAlarmStatus(client, prefix)` pattern) so tests construct a minimal fake client object — never a real Supabase/AWS call in a test.
- Conversation title: trimmed, 100 char max, empty-after-trim rejected with `400`.
- Question length: unchanged existing 500 char max in `/api/assistant`.
- `web/lib/conversations.ts` will be imported by both server-only route handlers (which need the Supabase service-role client) and by client components (which only need its exported **types**, never its functions). Every import of it from a `"use client"` file MUST be `import type { ... }` — never a value import — so the service-role key path is never bundled into client-side JavaScript.

## Review Focus

- A `conversationId` in `POST /api/assistant` that belongs to a different session must `404` **before** the Lambda is ever invoked — a malicious/buggy client must never be able to spend a real Bedrock invocation against another session's conversation reference.
- A Supabase insert failure immediately after a successful Lambda response must not hide the real, already-obtained answer from the user — the response must still be `200` with the real answer; only the persistence step is allowed to fail silently (logged server-side).
- Renaming or deleting a conversation belonging to a different session must return `404` — identical to "doesn't exist" — never a `403` or any response that confirms the row exists.
- Any `/api/conversations*` request missing `X-Session-Id` must `400` immediately, never fall through to a query with an empty/undefined session scope.
- An empty-after-trim rename title must `400` and must not overwrite the existing title with blank text.

---

### Task 1: Supabase schema, client factory, session-id helper, and conversations lib's pure functions

**Files:**
- Create: `supabase/schema.sql`
- Create: `web/lib/supabase.ts`
- Create: `web/lib/sessionId.ts`
- Create: `web/lib/sessionId.test.ts`
- Create: `web/lib/conversations.ts`
- Create: `web/lib/conversations.test.ts`
- Modify: `web/package.json` (add `@supabase/supabase-js`)

**Interfaces:**
- Produces: `getSupabaseClient(): SupabaseClient` (from `web/lib/supabase.ts`)
- Produces: `getOrCreateSessionId(storage?, generateId?): string` (from `web/lib/sessionId.ts`)
- Produces (from `web/lib/conversations.ts`): types `ConversationRow`, `ConversationJSON`, `MessageRow`; functions `formatDateTitle(date: Date): string`, `nextConversationTitle(base: string, existingTitles: string[]): string`, `toConversationJSON(row: ConversationRow): ConversationJSON`, `getSessionIdHeader(headers: Headers): string | null`, constant `MAX_TITLE_LENGTH`

- [ ] **Step 1: Add the Supabase schema file**

Create `supabase/schema.sql`:

```sql
-- Run this once in your Supabase project's SQL editor (Dashboard -> SQL
-- Editor -> New query). Not applied automatically by this project's CI --
-- Supabase is a separate service from the AWS/Terraform infrastructure.

create table conversations (
  id uuid primary key default gen_random_uuid(),
  session_id text not null,
  title text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index conversations_session_id_idx on conversations (session_id);

create table messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  question text not null,
  answer text not null,
  grounded boolean not null,
  tool_calls jsonb not null default '[]',
  sources jsonb not null default '[]',
  created_at timestamptz not null default now()
);
create index messages_conversation_id_idx on messages (conversation_id, created_at);
```

- [ ] **Step 2: Install the Supabase client library**

Run: `cd web && npm install @supabase/supabase-js`

- [ ] **Step 3: Write the Supabase client factory (no test — matches `web/lib/aws.ts`'s existing untested client-factory pattern)**

Create `web/lib/supabase.ts`:

```ts
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { requiredEnv } from "@/lib/aws";

let supabaseClient: SupabaseClient | undefined;

export function getSupabaseClient(): SupabaseClient {
  if (!supabaseClient) {
    supabaseClient = createClient(requiredEnv("SUPABASE_URL"), requiredEnv("SUPABASE_SERVICE_ROLE_KEY"));
  }
  return supabaseClient;
}
```

- [ ] **Step 4: Write the failing tests for the session-id helper**

Create `web/lib/sessionId.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { getOrCreateSessionId } from "./sessionId";

function makeStorage(initial: Record<string, string> = {}) {
  const store: Record<string, string> = { ...initial };
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
  };
}

describe("getOrCreateSessionId", () => {
  it("returns the existing id when one is already stored", () => {
    const storage = makeStorage({ assistant_session_id: "existing-id" });
    const result = getOrCreateSessionId(storage, () => "new-id");
    expect(result).toBe("existing-id");
  });

  it("generates and stores a new id when none exists", () => {
    const storage = makeStorage();
    const result = getOrCreateSessionId(storage, () => "new-id");
    expect(result).toBe("new-id");
    expect(storage.getItem("assistant_session_id")).toBe("new-id");
  });

  it("returns an empty string when no storage is available", () => {
    const result = getOrCreateSessionId(undefined, () => "new-id");
    expect(result).toBe("");
  });
});
```

- [ ] **Step 5: Run the tests to verify they fail**

Run: `cd web && npx vitest run lib/sessionId.test.ts`
Expected: FAIL with "Cannot find module './sessionId'" or similar (the file doesn't exist yet).

- [ ] **Step 6: Write the session-id helper**

Create `web/lib/sessionId.ts`:

```ts
export type SessionStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

const STORAGE_KEY = "assistant_session_id";

export function getOrCreateSessionId(
  storage: SessionStorage | undefined = typeof window !== "undefined" ? window.localStorage : undefined,
  generateId: () => string = () => crypto.randomUUID()
): string {
  if (!storage) return "";
  const existing = storage.getItem(STORAGE_KEY);
  if (existing) return existing;
  const created = generateId();
  storage.setItem(STORAGE_KEY, created);
  return created;
}
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `cd web && npx vitest run lib/sessionId.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 8: Write the failing tests for conversations lib's pure functions**

Create `web/lib/conversations.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  formatDateTitle,
  nextConversationTitle,
  toConversationJSON,
  getSessionIdHeader,
  MAX_TITLE_LENGTH,
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
      "25/09/26 (2)"
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
```

Note on the 5th `nextConversationTitle` test: a title like `"25/09/26 something else entirely"` does NOT start with `"25/09/26 ("` (it starts with `"25/09/26 s"`), so it must NOT count as a match -- this pins down that the match check is `t.startsWith(`${base} (`)`, not a looser `t.startsWith(base)`.

- [ ] **Step 9: Run the tests to verify they fail**

Run: `cd web && npx vitest run lib/conversations.test.ts`
Expected: FAIL with "Cannot find module './conversations'" (the file doesn't exist yet).

- [ ] **Step 10: Write the conversations lib's types and pure functions**

Create `web/lib/conversations.ts`:

```ts
export type ConversationRow = { id: string; title: string; updated_at: string };
export type ConversationJSON = { id: string; title: string; updatedAt: string };

export type MessageRow = {
  id: string;
  question: string;
  answer: string;
  grounded: boolean;
  tool_calls: unknown[];
  sources: unknown[];
  created_at: string;
};

export const MAX_TITLE_LENGTH = 100;

export function formatDateTitle(date: Date): string {
  const dd = String(date.getUTCDate()).padStart(2, "0");
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const yy = String(date.getUTCFullYear()).slice(-2);
  return `${dd}/${mm}/${yy}`;
}

export function nextConversationTitle(base: string, existingTitles: string[]): string {
  const matches = existingTitles.filter((t) => t === base || t.startsWith(`${base} (`));
  return matches.length === 0 ? base : `${base} (${matches.length + 1})`;
}

export function toConversationJSON(row: ConversationRow): ConversationJSON {
  return { id: row.id, title: row.title, updatedAt: row.updated_at };
}

export function getSessionIdHeader(headers: Headers): string | null {
  const value = headers.get("x-session-id")?.trim();
  return value ? value : null;
}
```

- [ ] **Step 11: Run the tests to verify they pass**

Run: `cd web && npx vitest run lib/conversations.test.ts`
Expected: PASS (11 tests)

- [ ] **Step 12: Run the full web test suite and type-check to confirm nothing else broke**

Run: `cd web && npx tsc --noEmit && npx vitest run`
Expected: PASS, no new failures.

- [ ] **Step 13: Commit**

```bash
git add supabase/schema.sql web/package.json web/package-lock.json web/lib/supabase.ts web/lib/sessionId.ts web/lib/sessionId.test.ts web/lib/conversations.ts web/lib/conversations.test.ts
git commit -m "feat: add Supabase schema, client factory, session-id helper, conversations lib pure functions"
```

---

### Task 2: conversations lib's Supabase-touching data functions

**Files:**
- Modify: `web/lib/conversations.ts`
- Modify: `web/lib/conversations.test.ts`

**Interfaces:**
- Consumes: `getSupabaseClient(): SupabaseClient` (Task 1), `ConversationRow`, `MessageRow`, `nextConversationTitle`, `formatDateTitle` (Task 1, same file)
- Produces: `listConversations(client, sessionId): Promise<ConversationRow[]>`, `createConversation(client, sessionId): Promise<ConversationRow>`, `renameConversation(client, sessionId, id, title): Promise<ConversationRow | null>`, `deleteConversation(client, sessionId, id): Promise<boolean>`, `conversationBelongsToSession(client, sessionId, id): Promise<boolean>`, `listMessagesForConversation(client, sessionId, conversationId): Promise<MessageRow[] | null>`, `insertMessage(client, conversationId, message): Promise<void>` — all from `web/lib/conversations.ts`, all taking a `SupabaseClient` as their first parameter (dependency injection, same convention as `lib/cloudwatchAlarms.ts`'s `getAlarmStatus(client, prefix)`)

- [ ] **Step 1: Write the failing tests for the Supabase-touching functions**

Append to `web/lib/conversations.test.ts` (add this import at the top alongside the existing ones):

```ts
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
```

Then append these test blocks to the end of the file:

```ts
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
```

Also add `vi` to the top-level vitest import: change
`import { describe, expect, it } from "vitest";` to
`import { describe, expect, it, vi } from "vitest";` at the top of the file.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd web && npx vitest run lib/conversations.test.ts`
Expected: FAIL with "listConversations is not a function" or similar (not implemented yet).

- [ ] **Step 3: Implement the Supabase-touching functions**

Append to `web/lib/conversations.ts` (add this import at the top of the file
alongside nothing else needed — `SupabaseClient` is only used as a type):

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
```

Then append these functions to the end of the file:

```ts
export async function listConversations(client: SupabaseClient, sessionId: string): Promise<ConversationRow[]> {
  const { data, error } = await client
    .from("conversations")
    .select("id, title, updated_at")
    .eq("session_id", sessionId)
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return (data as ConversationRow[] | null) ?? [];
}

export async function createConversation(client: SupabaseClient, sessionId: string): Promise<ConversationRow> {
  const { data: existing, error: selectError } = await client
    .from("conversations")
    .select("title")
    .eq("session_id", sessionId);
  if (selectError) throw selectError;

  const base = formatDateTitle(new Date());
  const existingTitles = ((existing as { title: string }[] | null) ?? []).map((r) => r.title);
  const title = nextConversationTitle(base, existingTitles);

  const { data, error } = await client
    .from("conversations")
    .insert({ session_id: sessionId, title })
    .select("id, title, updated_at")
    .single();
  if (error) throw error;
  return data as ConversationRow;
}

export async function renameConversation(
  client: SupabaseClient,
  sessionId: string,
  id: string,
  title: string
): Promise<ConversationRow | null> {
  const { data, error } = await client
    .from("conversations")
    .update({ title, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("session_id", sessionId)
    .select("id, title, updated_at")
    .maybeSingle();
  if (error) throw error;
  return data as ConversationRow | null;
}

export async function deleteConversation(client: SupabaseClient, sessionId: string, id: string): Promise<boolean> {
  const { data, error } = await client
    .from("conversations")
    .delete()
    .eq("id", id)
    .eq("session_id", sessionId)
    .select("id")
    .maybeSingle();
  if (error) throw error;
  return data !== null;
}

export async function conversationBelongsToSession(
  client: SupabaseClient,
  sessionId: string,
  conversationId: string
): Promise<boolean> {
  const { data, error } = await client
    .from("conversations")
    .select("id")
    .eq("id", conversationId)
    .eq("session_id", sessionId)
    .maybeSingle();
  if (error) throw error;
  return data !== null;
}

export async function listMessagesForConversation(
  client: SupabaseClient,
  sessionId: string,
  conversationId: string
): Promise<MessageRow[] | null> {
  const belongs = await conversationBelongsToSession(client, sessionId, conversationId);
  if (!belongs) return null;

  const { data, error } = await client
    .from("messages")
    .select("id, question, answer, grounded, tool_calls, sources, created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data as MessageRow[] | null) ?? [];
}

export async function insertMessage(
  client: SupabaseClient,
  conversationId: string,
  message: { question: string; answer: string; grounded: boolean; toolCalls: unknown[]; sources: unknown[] }
): Promise<void> {
  const { error } = await client.from("messages").insert({
    conversation_id: conversationId,
    question: message.question,
    answer: message.answer,
    grounded: message.grounded,
    tool_calls: message.toolCalls,
    sources: message.sources,
  });
  if (error) throw error;
}
```

Note: `listMessagesForConversation` now calls `conversationBelongsToSession` internally (one extra real query) rather than duplicating the ownership check inline — this is why its test above stubs `maybeSingle` directly rather than relying on the `then`-based call-counter for that first check.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd web && npx vitest run lib/conversations.test.ts`
Expected: PASS (all tests in the file: 11 from Task 1 + 14 new in this task = 25 total)

- [ ] **Step 5: Run the full web test suite and type-check**

Run: `cd web && npx tsc --noEmit && npx vitest run`
Expected: PASS, no new failures.

- [ ] **Step 6: Commit**

```bash
git add web/lib/conversations.ts web/lib/conversations.test.ts
git commit -m "feat: add Supabase-backed conversation/message data functions"
```

---

### Task 3: `GET`/`POST /api/conversations` route, with a new conversation-creation rate limit

**Files:**
- Modify: `web/lib/ratelimit.ts`
- Create: `web/app/api/conversations/route.ts`
- Create: `web/app/api/conversations/route.test.ts`

**Interfaces:**
- Consumes: `getSupabaseClient` (Task 1), `listConversations`, `createConversation`, `toConversationJSON`, `getSessionIdHeader` (Task 1/2), `checkRateLimit` (existing, `web/lib/ratelimit.ts`)
- Produces: `getConversationLimiter(): Ratelimit` (`web/lib/ratelimit.ts`); the `GET`/`POST` route handlers

- [ ] **Step 1: Add the conversation rate limiter**

In `web/lib/ratelimit.ts`, add this block after the existing `getCostLimiter` function (before `export type RateLimitResult`):

```ts
let conversationLimiter: Ratelimit | undefined;
export function getConversationLimiter(): Ratelimit {
  if (!conversationLimiter) {
    const redis = new Redis({
      url: requiredEnv("UPSTASH_REDIS_REST_URL"),
      token: requiredEnv("UPSTASH_REDIS_REST_TOKEN"),
    });
    conversationLimiter = new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(10, "1 h"),
      prefix: "conversation-ratelimit",
    });
  }
  return conversationLimiter;
}
```

- [ ] **Step 2: Write the failing tests for the route**

Create `web/app/api/conversations/route.test.ts`:

```ts
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
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd web && npx vitest run app/api/conversations/route.test.ts`
Expected: FAIL ("Cannot find module './route'" — the route file doesn't exist yet).

- [ ] **Step 4: Write the route handlers**

Create `web/app/api/conversations/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase";
import { listConversations, createConversation, toConversationJSON, getSessionIdHeader } from "@/lib/conversations";
import { checkRateLimit, getConversationLimiter } from "@/lib/ratelimit";

export async function GET(request: NextRequest) {
  const sessionId = getSessionIdHeader(request.headers);
  if (!sessionId) {
    return NextResponse.json({ error: "Thiếu X-Session-Id." }, { status: 400 });
  }

  try {
    const rows = await listConversations(getSupabaseClient(), sessionId);
    return NextResponse.json({ conversations: rows.map(toConversationJSON) });
  } catch (error) {
    console.error("List conversations failed", error);
    return NextResponse.json({ error: "Không tải được danh sách cuộc trò chuyện." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const sessionId = getSessionIdHeader(request.headers);
  if (!sessionId) {
    return NextResponse.json({ error: "Thiếu X-Session-Id." }, { status: 400 });
  }

  const rateLimit = await checkRateLimit(sessionId, getConversationLimiter());
  if (!rateLimit.allowed) {
    return NextResponse.json({ error: "Đợi một chút rồi tạo cuộc trò chuyện mới." }, { status: 429 });
  }

  try {
    const row = await createConversation(getSupabaseClient(), sessionId);
    return NextResponse.json(toConversationJSON(row));
  } catch (error) {
    console.error("Create conversation failed", error);
    return NextResponse.json({ error: "Không tạo được cuộc trò chuyện." }, { status: 500 });
  }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd web && npx vitest run app/api/conversations/route.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 6: Run the full web test suite and type-check**

Run: `cd web && npx tsc --noEmit && npx vitest run`
Expected: PASS, no new failures.

- [ ] **Step 7: Commit**

```bash
git add web/lib/ratelimit.ts web/app/api/conversations/route.ts web/app/api/conversations/route.test.ts
git commit -m "feat: add GET/POST /api/conversations with a new creation rate limit"
```

---

### Task 4: `PATCH`/`DELETE /api/conversations/:id` route

**Files:**
- Create: `web/app/api/conversations/[id]/route.ts`
- Create: `web/app/api/conversations/[id]/route.test.ts`

**Interfaces:**
- Consumes: `getSupabaseClient` (Task 1), `renameConversation`, `deleteConversation`, `toConversationJSON`, `getSessionIdHeader`, `MAX_TITLE_LENGTH` (Task 1/2)
- Produces: the `PATCH`/`DELETE` route handlers

- [ ] **Step 1: Write the failing tests for the route**

Create `web/app/api/conversations/[id]/route.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd web && npx vitest run app/api/conversations/\[id\]/route.test.ts`
Expected: FAIL ("Cannot find module './route'").

- [ ] **Step 3: Write the route handlers**

Create `web/app/api/conversations/[id]/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase";
import { renameConversation, deleteConversation, toConversationJSON, getSessionIdHeader, MAX_TITLE_LENGTH } from "@/lib/conversations";

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const sessionId = getSessionIdHeader(request.headers);
  if (!sessionId) {
    return NextResponse.json({ error: "Thiếu X-Session-Id." }, { status: 400 });
  }

  const body = await request.json().catch(() => null);
  const title = typeof body?.title === "string" ? body.title.trim() : "";
  if (!title) {
    return NextResponse.json({ error: "Thiếu tên cuộc trò chuyện." }, { status: 400 });
  }
  if (title.length > MAX_TITLE_LENGTH) {
    return NextResponse.json(
      { error: `Tên cuộc trò chuyện quá dài (tối đa ${MAX_TITLE_LENGTH} ký tự).` },
      { status: 400 }
    );
  }

  const { id } = await params;
  try {
    const row = await renameConversation(getSupabaseClient(), sessionId, id, title);
    if (!row) {
      return NextResponse.json({ error: "Không tìm thấy cuộc trò chuyện." }, { status: 404 });
    }
    return NextResponse.json(toConversationJSON(row));
  } catch (error) {
    console.error("Rename conversation failed", error);
    return NextResponse.json({ error: "Không đổi được tên cuộc trò chuyện." }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: RouteContext) {
  const sessionId = getSessionIdHeader(request.headers);
  if (!sessionId) {
    return NextResponse.json({ error: "Thiếu X-Session-Id." }, { status: 400 });
  }

  const { id } = await params;
  try {
    const deleted = await deleteConversation(getSupabaseClient(), sessionId, id);
    if (!deleted) {
      return NextResponse.json({ error: "Không tìm thấy cuộc trò chuyện." }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Delete conversation failed", error);
    return NextResponse.json({ error: "Không xóa được cuộc trò chuyện." }, { status: 500 });
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd web && npx vitest run app/api/conversations/\[id\]/route.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 5: Run the full web test suite and type-check**

Run: `cd web && npx tsc --noEmit && npx vitest run`
Expected: PASS, no new failures.

- [ ] **Step 6: Commit**

```bash
git add "web/app/api/conversations/[id]/route.ts" "web/app/api/conversations/[id]/route.test.ts"
git commit -m "feat: add PATCH/DELETE /api/conversations/:id"
```

---

### Task 5: `GET /api/conversations/:id/messages` route

**Files:**
- Create: `web/app/api/conversations/[id]/messages/route.ts`
- Create: `web/app/api/conversations/[id]/messages/route.test.ts`

**Interfaces:**
- Consumes: `getSupabaseClient` (Task 1), `listMessagesForConversation`, `getSessionIdHeader` (Task 1/2)
- Produces: `web/lib/assistant.ts`'s `ChatMessage` type is NOT defined here (that's Task 7) — this task's JSON response shape (camelCase, matching `MessageRow` mapped by hand in the route) is the contract Task 7/9 build against: `{ messages: [{ id, question, answer, grounded, toolCalls, sources, createdAt }] }`

- [ ] **Step 1: Write the failing tests for the route**

Create `web/app/api/conversations/[id]/messages/route.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd web && npx vitest run app/api/conversations/\[id\]/messages/route.test.ts`
Expected: FAIL ("Cannot find module './route'").

- [ ] **Step 3: Write the route handler**

Create `web/app/api/conversations/[id]/messages/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase";
import { listMessagesForConversation, getSessionIdHeader, type MessageRow } from "@/lib/conversations";

type RouteContext = { params: Promise<{ id: string }> };

function toMessageJSON(row: MessageRow) {
  return {
    id: row.id,
    question: row.question,
    answer: row.answer,
    grounded: row.grounded,
    toolCalls: row.tool_calls,
    sources: row.sources,
    createdAt: row.created_at,
  };
}

export async function GET(request: NextRequest, { params }: RouteContext) {
  const sessionId = getSessionIdHeader(request.headers);
  if (!sessionId) {
    return NextResponse.json({ error: "Thiếu X-Session-Id." }, { status: 400 });
  }

  const { id } = await params;
  try {
    const rows = await listMessagesForConversation(getSupabaseClient(), sessionId, id);
    if (rows === null) {
      return NextResponse.json({ error: "Không tìm thấy cuộc trò chuyện." }, { status: 404 });
    }
    return NextResponse.json({ messages: rows.map(toMessageJSON) });
  } catch (error) {
    console.error("List messages failed", error);
    return NextResponse.json({ error: "Không tải được lịch sử tin nhắn." }, { status: 500 });
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd web && npx vitest run app/api/conversations/\[id\]/messages/route.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Run the full web test suite and type-check**

Run: `cd web && npx tsc --noEmit && npx vitest run`
Expected: PASS, no new failures.

- [ ] **Step 6: Commit**

```bash
git add "web/app/api/conversations/[id]/messages/route.ts" "web/app/api/conversations/[id]/messages/route.test.ts"
git commit -m "feat: add GET /api/conversations/:id/messages"
```

---

### Task 6: `/api/assistant` persists each turn to its conversation

**Files:**
- Modify: `web/app/api/assistant/route.ts`
- Modify: `web/app/api/assistant/route.test.ts`

**Interfaces:**
- Consumes: `getSupabaseClient` (Task 1), `conversationBelongsToSession`, `insertMessage`, `getSessionIdHeader` (Task 1/2)

- [ ] **Step 1: Write the failing tests for the new behavior**

In `web/app/api/assistant/route.test.ts`, add these mocks alongside the
existing `vi.mock` calls at the top of the file:

```ts
vi.mock("@/lib/supabase", () => ({ getSupabaseClient: vi.fn(() => ({})) }));
vi.mock("@/lib/conversations", () => ({
  conversationBelongsToSession: vi.fn(),
  insertMessage: vi.fn(),
}));
```

And add this import alongside the existing ones:

```ts
import { conversationBelongsToSession, insertMessage } from "@/lib/conversations";

const mockedBelongsToSession = vi.mocked(conversationBelongsToSession);
const mockedInsertMessage = vi.mocked(insertMessage);
```

Add `mockedBelongsToSession.mockReset(); mockedInsertMessage.mockReset();`
inside the existing `beforeEach` block.

Then append these test cases to the end of the `describe("POST /api/assistant"` block:

```ts
  it("returns 404 without calling the Lambda when conversationId belongs to a different session", async () => {
    mockedCheckRateLimit.mockResolvedValue({ allowed: true, remaining: 4 });
    mockedBelongsToSession.mockResolvedValue(false);

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
    mockedBelongsToSession.mockResolvedValue(true);
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
    mockedBelongsToSession.mockResolvedValue(true);
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
    expect(mockedBelongsToSession).not.toHaveBeenCalled();
    expect(mockedInsertMessage).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run the tests to verify the new ones fail**

Run: `cd web && npx vitest run app/api/assistant/route.test.ts`
Expected: FAIL on the 4 new tests (conversationId handling doesn't exist yet); the pre-existing tests in this file still PASS.

- [ ] **Step 3: Modify the route to accept and use `conversationId`**

Replace the full contents of `web/app/api/assistant/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { InvokeCommand } from "@aws-sdk/client-lambda";
import { getLambdaClient, requiredEnv } from "@/lib/aws";
import { checkRateLimit } from "@/lib/ratelimit";
import { normalizeAssistantResult } from "@/lib/assistant";
import { clientIp } from "@/lib/clientIp";
import { getSupabaseClient } from "@/lib/supabase";
import { conversationBelongsToSession, insertMessage, getSessionIdHeader } from "@/lib/conversations";

// rag_agent's own Lambda timeout is 90s (see infra/rag.tf); 60 is Vercel's ceiling
// on non-Pro plans, so this may still not be enough headroom on a Hobby plan.
export const maxDuration = 60;

const MAX_QUESTION_LENGTH = 500;

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const question = typeof body?.question === "string" ? body.question.trim() : "";
  const conversationId = typeof body?.conversationId === "string" ? body.conversationId : null;

  if (!question) {
    return NextResponse.json({ error: "Thiếu 'question'." }, { status: 400 });
  }

  if (question.length > MAX_QUESTION_LENGTH) {
    return NextResponse.json(
      { error: `Câu hỏi quá dài (tối đa ${MAX_QUESTION_LENGTH} ký tự).` },
      { status: 400 }
    );
  }

  const rateLimit = await checkRateLimit(clientIp(request));
  if (!rateLimit.allowed) {
    return NextResponse.json({ error: "Đợi một chút rồi hỏi tiếp." }, { status: 429 });
  }

  if (conversationId) {
    const sessionId = getSessionIdHeader(request.headers);
    const belongs = sessionId && (await conversationBelongsToSession(getSupabaseClient(), sessionId, conversationId));
    if (!belongs) {
      return NextResponse.json({ error: "Không tìm thấy cuộc trò chuyện." }, { status: 404 });
    }
  }

  try {
    const functionName = requiredEnv("RAG_AGENT_FUNCTION_NAME");
    const response = await getLambdaClient().send(
      new InvokeCommand({ FunctionName: functionName, Payload: Buffer.from(JSON.stringify({ question })) })
    );
    const payload = JSON.parse(Buffer.from(response.Payload ?? new Uint8Array()).toString("utf-8"));
    if (payload.statusCode !== 200) {
      return NextResponse.json({ error: payload.error ?? "Lambda trả lỗi." }, { status: 502 });
    }
    const result = normalizeAssistantResult(payload);

    if (conversationId) {
      try {
        await insertMessage(getSupabaseClient(), conversationId, {
          question: result.question,
          answer: result.answer,
          grounded: result.grounded,
          toolCalls: result.toolCalls,
          sources: result.sources,
        });
      } catch (persistError) {
        // A persistence hiccup must never hide a real, already-obtained
        // answer -- log it and still return the real result to the user.
        console.error("Persisting assistant turn failed", persistError);
      }
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error("Assistant API failed", error);
    return NextResponse.json({ error: "Không gọi được RAG Lambda, thử lại sau." }, { status: 500 });
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd web && npx vitest run app/api/assistant/route.test.ts`
Expected: PASS (all tests in the file, old and new)

- [ ] **Step 5: Run the full web test suite and type-check**

Run: `cd web && npx tsc --noEmit && npx vitest run`
Expected: PASS, no new failures.

- [ ] **Step 6: Commit**

```bash
git add web/app/api/assistant/route.ts web/app/api/assistant/route.test.ts
git commit -m "feat: persist each real assistant turn to its conversation"
```

---

### Task 7: `ChatMessage` type, extended `ChatThread`, new `ToolTraceHistory`

**Files:**
- Modify: `web/lib/assistant.ts`
- Modify: `web/components/ChatThread.tsx`
- Create: `web/components/ToolTraceHistory.tsx`

(`web/components/ToolTrace.tsx` is fully superseded by `ToolTraceHistory`,
but its last real import is `app/assistant/page.tsx` — it's deleted in
Task 9, at the exact point that import is removed, so no task leaves the
tree in a deliberately-broken `tsc` state.)

**Interfaces:**
- Produces: `ChatMessage` type (`web/lib/assistant.ts`) — `{ id: string; question: string; answer: string; sources: AssistantSource[]; toolCalls: unknown[] }`, matching the JSON shape `GET /api/conversations/:id/messages` (Task 5) already returns
- Produces: `ChatThread({ messages, pendingQuestion, pendingResult, loading })` (replaces the old single-turn `{ question, result, loading }` props)
- Produces: `ToolTraceHistory({ messages })`

No new tests in this task — matches this project's standing convention of no component-rendering tests; verified via `tsc`/`next build` only, same as every prior visual-pass task this project has done.

- [ ] **Step 1: Add the `ChatMessage` type**

In `web/lib/assistant.ts`, add this after the existing `AssistantResult` type:

```ts
export type ChatMessage = {
  id: string;
  question: string;
  answer: string;
  sources: AssistantSource[];
  toolCalls: unknown[];
};
```

- [ ] **Step 2: Extend `ChatThread` to render a message history plus one in-flight turn**

Replace the full contents of `web/components/ChatThread.tsx`:

```tsx
import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import type { AssistantResult, AssistantSource, ChatMessage } from "@/lib/assistant";

// The agent's real answer text often contains markdown (bold, bullet/
// numbered lists, links) -- render it properly instead of showing raw
// "**"/"-" syntax to the user. These overrides just restyle the default
// elements to match this page's existing dark theme; they don't change
// what content renders.
const answerMarkdownComponents: Components = {
  p: ({ children }) => <p className="text-sm leading-relaxed text-textSecondary">{children}</p>,
  strong: ({ children }) => <strong className="font-semibold text-textPrimary">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  ul: ({ children }) => <ul className="list-disc pl-5 flex flex-col gap-1">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal pl-5 flex flex-col gap-1">{children}</ol>,
  li: ({ children }) => <li className="text-sm leading-relaxed text-textSecondary">{children}</li>,
  a: ({ children, href }) => (
    <a href={href} target="_blank" rel="noreferrer" className="text-accent underline decoration-accent/40 hover:text-accentBright">
      {children}
    </a>
  ),
  code: ({ children }) => <code className="font-mono text-[12px] bg-bg rounded px-1 py-0.5 text-accent">{children}</code>,
};

function QuestionBubble({ question }: { question: string }) {
  return (
    <div className="flex items-end gap-2 justify-end">
      <div className="max-w-[70%] rounded-lg rounded-br-sm bg-[#1B2540] px-4 py-3">
        <span className="text-sm text-textPrimary">{question}</span>
      </div>
      <span className="w-7 h-7 rounded-full bg-bg border border-border flex items-center justify-center text-textSecondary flex-shrink-0">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="8" r="4" />
          <path d="M4 20c0-4 4-6 8-6s8 2 8 6" />
        </svg>
      </span>
    </div>
  );
}

function AnswerBubble({ answer, sources }: { answer: string; sources: AssistantSource[] }) {
  return (
    <div className="flex items-end gap-2 justify-start">
      <span className="w-7 h-7 rounded-full bg-bg border border-secondary/40 flex items-center justify-center text-secondaryBright flex-shrink-0">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
        </svg>
      </span>
      <div className="max-w-[80%] rounded-lg rounded-bl-sm border border-border bg-surface/75 backdrop-blur-md px-4 py-3 flex flex-col gap-3">
        <div className="flex flex-col gap-2">
          <ReactMarkdown components={answerMarkdownComponents}>{answer}</ReactMarkdown>
        </div>
        <div className="flex flex-wrap gap-2">
          {sources.map((s, i) => (
            <span key={i} className="font-mono text-[10.5px] text-accent bg-accent/10 rounded px-2 py-1">
              {s.source} · {s.title}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

export function ChatThread({
  messages,
  pendingQuestion,
  pendingResult,
  loading,
}: {
  messages: ChatMessage[];
  pendingQuestion: string | null;
  pendingResult: AssistantResult | null;
  loading: boolean;
}) {
  if (messages.length === 0 && !pendingQuestion) {
    return <p className="text-sm text-textMuted">Đặt câu hỏi về dữ liệu đã ingest để bắt đầu.</p>;
  }
  return (
    <div className="flex flex-col gap-4">
      {messages.map((m) => (
        <div key={m.id} className="flex flex-col gap-4">
          <QuestionBubble question={m.question} />
          <AnswerBubble answer={m.answer} sources={m.sources} />
        </div>
      ))}
      {pendingQuestion && (
        <div className="flex flex-col gap-4">
          <QuestionBubble question={pendingQuestion} />
          {loading && <span className="text-xs text-textMuted">Đang xử lý…</span>}
          {pendingResult && <AnswerBubble answer={pendingResult.answer} sources={pendingResult.sources} />}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Create `ToolTraceHistory`**

Create `web/components/ToolTraceHistory.tsx`:

```tsx
import type { ChatMessage } from "@/lib/assistant";

export function ToolTraceHistory({ messages }: { messages: ChatMessage[] }) {
  if (messages.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-surface/75 backdrop-blur-md p-5 flex items-center justify-center">
        <span className="text-xs text-textMuted text-center">
          Chọn hoặc tạo một cuộc trò chuyện để xem tool trace.
        </span>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-surface/75 backdrop-blur-md p-5 flex flex-col gap-4 overflow-auto">
      <div className="flex items-center gap-2">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#8B5CF6" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
        </svg>
        <span className="text-xs font-semibold text-textPrimary">Tool trace (agent tự quyết định)</span>
      </div>
      {messages.map((m, turnIndex) => (
        <div key={m.id} className="flex flex-col gap-1.5 pb-3 border-b border-border last:border-b-0 last:pb-0">
          <span className="font-mono text-[10px] uppercase tracking-wide text-textMuted">
            Lượt {turnIndex + 1}: {m.question}
          </span>
          {m.toolCalls.length === 0 ? (
            <span className="font-mono text-xs text-textMuted">(không gọi tool nào)</span>
          ) : (
            m.toolCalls.map((call, i) => (
              <span key={i} className="font-mono text-xs text-textSecondary">
                {JSON.stringify(call)}
              </span>
            ))
          )}
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Type-check**

Run: `cd web && npx tsc --noEmit`
Expected: FAILS with exactly one error class: `app/assistant/page.tsx`
still calls `ChatThread` with its old `{ question, result, loading }` props,
which no longer match. This is expected — Task 9 rewrites that page. If you
see any OTHER error (e.g. inside `ChatThread.tsx`, `ToolTraceHistory.tsx`,
or `assistant.ts` themselves), stop and fix it before proceeding; only the
`page.tsx` prop-mismatch error is expected at this point.

- [ ] **Step 5: Commit**

```bash
git add web/lib/assistant.ts web/components/ChatThread.tsx web/components/ToolTraceHistory.tsx
git commit -m "feat: extend ChatThread for message history, add ToolTraceHistory"
```

---

### Task 8: `ConversationList` component

**Files:**
- Create: `web/components/ConversationList.tsx`

**Interfaces:**
- Consumes: `ConversationJSON` type — **as a type-only import** (`import type { ... } from "@/lib/conversations"`), since this is a `"use client"` component and `lib/conversations.ts` also exports server-only, service-role-key-touching functions that must never be bundled client-side (see Global Constraints)
- Produces: `ConversationList({ conversations, selectedId, onSelect, onCreate, onRename, onDelete })`

No new tests — matches this project's standing convention of no
component-rendering tests; verified via `tsc`/`next build` only.

- [ ] **Step 1: Write the component**

Create `web/components/ConversationList.tsx`:

```tsx
"use client";

import { useState } from "react";
import type { ConversationJSON } from "@/lib/conversations";

export function ConversationList({
  conversations,
  selectedId,
  onSelect,
  onCreate,
  onRename,
  onDelete,
}: {
  conversations: ConversationJSON[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);

  function startEditing(conversation: ConversationJSON) {
    setEditingId(conversation.id);
    setEditingTitle(conversation.title);
  }

  function commitEditing() {
    const trimmed = editingTitle.trim();
    if (editingId && trimmed) {
      onRename(editingId, trimmed);
    }
    setEditingId(null);
  }

  return (
    <div className="w-[260px] shrink-0 rounded-lg border border-border bg-surface/75 backdrop-blur-md p-3 flex flex-col gap-2 overflow-auto">
      <button
        onClick={onCreate}
        className="rounded-lg bg-accent px-3 py-2 text-xs font-semibold text-bg transition-shadow hover:shadow-glowCyan"
      >
        + Cuộc trò chuyện mới
      </button>
      <div className="flex flex-col gap-1 mt-1">
        {conversations.map((c) => (
          <div
            key={c.id}
            className={`group flex items-center gap-1.5 rounded-lg px-2.5 py-2 cursor-pointer ${
              c.id === selectedId ? "bg-accent/10 border border-accent" : "border border-transparent hover:bg-bg/40"
            }`}
            onClick={() => onSelect(c.id)}
          >
            {editingId === c.id ? (
              <input
                autoFocus
                value={editingTitle}
                onChange={(e) => setEditingTitle(e.target.value)}
                onBlur={commitEditing}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitEditing();
                  if (e.key === "Escape") setEditingId(null);
                }}
                onClick={(e) => e.stopPropagation()}
                maxLength={100}
                className="flex-grow bg-transparent text-[12.5px] text-textPrimary outline-none border-b border-accent"
              />
            ) : (
              <span className="flex-grow text-[12.5px] text-textPrimary truncate">{c.title}</span>
            )}
            <button
              onClick={(e) => {
                e.stopPropagation();
                startEditing(c);
              }}
              className="opacity-0 group-hover:opacity-100 text-textMuted hover:text-accent flex-shrink-0"
              aria-label="Đổi tên"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 20h9" />
                <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
              </svg>
            </button>
            {confirmingDeleteId === c.id ? (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(c.id);
                  setConfirmingDeleteId(null);
                }}
                className="text-[10px] font-semibold text-error flex-shrink-0"
              >
                Xóa?
              </button>
            ) : (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setConfirmingDeleteId(c.id);
                }}
                className="opacity-0 group-hover:opacity-100 text-textMuted hover:text-error flex-shrink-0"
                aria-label="Xóa"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 6h18" />
                  <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0-1 14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2L4 6" />
                </svg>
              </button>
            )}
          </div>
        ))}
        {conversations.length === 0 && (
          <span className="text-[11px] text-textMuted px-2.5 py-2">Chưa có cuộc trò chuyện nào.</span>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `cd web && npx tsc --noEmit`
Expected: Passes (this component isn't imported anywhere yet, so it can't
introduce a new error by itself; if you see an unrelated pre-existing error
carried over from Task 7's expected state, that's fine — it's fixed in Task 9).

- [ ] **Step 3: Commit**

```bash
git add web/components/ConversationList.tsx
git commit -m "feat: add ConversationList component"
```

---

### Task 9: Wire it all together in `assistant/page.tsx`

**Files:**
- Modify: `web/app/assistant/page.tsx`

**Interfaces:**
- Consumes: everything from Tasks 1-8 — `getOrCreateSessionId`, `ConversationList`, `ChatThread` (new props), `ToolTraceHistory`, `ChatMessage`/`AssistantResult` types, and the five `/api/conversations*` + modified `/api/assistant` endpoints

- [ ] **Step 1: Replace the page**

Replace the full contents of `web/app/assistant/page.tsx`:

```tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import { ChatThread } from "@/components/ChatThread";
import { ToolTraceHistory } from "@/components/ToolTraceHistory";
import { ConversationList } from "@/components/ConversationList";
import { getOrCreateSessionId } from "@/lib/sessionId";
import type { AssistantResult, ChatMessage } from "@/lib/assistant";
import type { ConversationJSON } from "@/lib/conversations";

export default function AssistantPage() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<ConversationJSON[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [pendingQuestion, setPendingQuestion] = useState<string | null>(null);
  const [pendingResult, setPendingResult] = useState<AssistantResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [conversationsError, setConversationsError] = useState<string | null>(null);
  const [messagesError, setMessagesError] = useState<string | null>(null);

  useEffect(() => {
    setSessionId(getOrCreateSessionId());
  }, []);

  const loadConversations = useCallback(async (sid: string) => {
    try {
      const res = await fetch("/api/conversations", { headers: { "X-Session-Id": sid } });
      if (!res.ok) throw new Error("request failed");
      const body = await res.json();
      setConversations(body.conversations);
      setConversationsError(null);
    } catch {
      setConversationsError("Không tải được danh sách cuộc trò chuyện.");
    }
  }, []);

  useEffect(() => {
    if (sessionId) loadConversations(sessionId);
  }, [sessionId, loadConversations]);

  const loadMessages = useCallback(async (sid: string, conversationId: string) => {
    try {
      const res = await fetch(`/api/conversations/${conversationId}/messages`, {
        headers: { "X-Session-Id": sid },
      });
      if (!res.ok) throw new Error("request failed");
      const body = await res.json();
      setMessages(body.messages);
      setMessagesError(null);
    } catch {
      setMessagesError("Không tải được lịch sử tin nhắn.");
    }
  }, []);

  useEffect(() => {
    if (sessionId && selectedId) {
      loadMessages(sessionId, selectedId);
    } else {
      setMessages([]);
    }
  }, [sessionId, selectedId, loadMessages]);

  function handleSelect(id: string) {
    setSelectedId(id);
    setPendingQuestion(null);
    setPendingResult(null);
  }

  async function createConversation(): Promise<ConversationJSON | null> {
    if (!sessionId) return null;
    const res = await fetch("/api/conversations", { method: "POST", headers: { "X-Session-Id": sessionId } });
    if (!res.ok) return null;
    const created = await res.json();
    await loadConversations(sessionId);
    return created;
  }

  async function handleCreate() {
    const created = await createConversation();
    if (created) handleSelect(created.id);
  }

  async function handleRename(id: string, title: string) {
    if (!sessionId) return;
    await fetch(`/api/conversations/${id}`, {
      method: "PATCH",
      headers: { "X-Session-Id": sessionId, "content-type": "application/json" },
      body: JSON.stringify({ title }),
    });
    loadConversations(sessionId);
  }

  async function handleDelete(id: string) {
    if (!sessionId) return;
    await fetch(`/api/conversations/${id}`, { method: "DELETE", headers: { "X-Session-Id": sessionId } });
    if (selectedId === id) setSelectedId(null);
    loadConversations(sessionId);
  }

  async function submit() {
    const trimmed = input.trim();
    if (!trimmed || loading || !sessionId) return;

    let conversationId = selectedId;
    if (!conversationId) {
      const created = await createConversation();
      if (!created) {
        setNotice("Không tạo được cuộc trò chuyện mới, thử lại sau.");
        return;
      }
      conversationId = created.id;
      setSelectedId(conversationId);
    }

    setPendingQuestion(trimmed);
    setPendingResult(null);
    setNotice(null);
    setLoading(true);
    try {
      const res = await fetch("/api/assistant", {
        method: "POST",
        headers: { "content-type": "application/json", "X-Session-Id": sessionId },
        body: JSON.stringify({ question: trimmed, conversationId }),
      });
      const body = await res.json();
      if (res.status === 429) {
        setNotice(body.error ?? "Đợi một chút rồi hỏi tiếp.");
      } else if (!res.ok) {
        setNotice(body.error ?? "Không gọi được RAG Lambda.");
      } else {
        await loadMessages(sessionId, conversationId);
        setPendingQuestion(null);
        setPendingResult(null);
      }
    } catch {
      setNotice("Không gọi được RAG Lambda, thử lại sau.");
    } finally {
      setLoading(false);
      setInput("");
    }
  }

  return (
    <div className="p-9 flex flex-col gap-5 h-screen">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-textPrimary">RAG Assistant</h1>
        <p className="mt-1.5 text-sm text-textSecondary">
          Agentic RAG — agent tự quyết định gọi tool truy xuất dữ liệu đã ingest hoặc tìm trên web.
        </p>
      </div>
      <div className="grid grid-cols-[260px_1.5fr_1fr] gap-5 flex-grow min-h-0">
        <div className="flex flex-col gap-2 min-h-0">
          {conversationsError && (
            <div className="rounded-lg border border-error/40 bg-error/10 px-3 py-2 flex items-center justify-between gap-2">
              <span className="text-[11px] text-error">{conversationsError}</span>
              <button
                onClick={() => sessionId && loadConversations(sessionId)}
                className="text-[11px] text-accent underline flex-shrink-0"
              >
                Thử lại
              </button>
            </div>
          )}
          <ConversationList
            conversations={conversations}
            selectedId={selectedId}
            onSelect={handleSelect}
            onCreate={handleCreate}
            onRename={handleRename}
            onDelete={handleDelete}
          />
        </div>
        <div className="rounded-lg border border-border bg-surface/75 backdrop-blur-md p-6 flex flex-col gap-4 min-h-0 overflow-auto">
          {messagesError && (
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-error">{messagesError}</span>
              <button
                onClick={() => sessionId && selectedId && loadMessages(sessionId, selectedId)}
                className="text-xs text-accent underline flex-shrink-0"
              >
                Thử lại
              </button>
            </div>
          )}
          <ChatThread
            messages={messages}
            pendingQuestion={pendingQuestion}
            pendingResult={pendingResult}
            loading={loading}
          />
          {notice && <p className="text-xs text-warning">{notice}</p>}
          <div className="mt-auto flex gap-2 items-center border border-border rounded-xl px-3 py-2 transition-shadow focus-within:border-accent focus-within:shadow-glowCyan">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
              placeholder="Đặt câu hỏi về dữ liệu đã ingest…"
              className="flex-grow bg-transparent text-sm text-textPrimary outline-none placeholder:text-textMuted"
              disabled={loading}
              maxLength={500}
            />
            <button
              onClick={submit}
              disabled={loading}
              className="rounded-lg bg-accent px-4 py-2 text-xs font-semibold text-bg disabled:opacity-50 transition-shadow hover:shadow-glowCyan"
            >
              Gửi
            </button>
          </div>
        </div>
        <ToolTraceHistory messages={messages} />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Delete the now-fully-superseded `ToolTrace.tsx`**

The page above no longer imports it — this was the last real usage.

Run: `git rm web/components/ToolTrace.tsx`

- [ ] **Step 3: Type-check and build**

Run: `cd web && npx tsc --noEmit && npx next build`
Expected: PASS, no errors (this is where Task 7's deferred `ChatThread`-props
mismatch error, from before this page was rewritten, gets resolved).

- [ ] **Step 4: Run the full web test suite**

Run: `cd web && npx vitest run`
Expected: PASS, no new failures. Note the new real test count and update
`web/lib/landingMeta.ts`'s `TEST_COUNT` from a fresh run of both suites
(Python `pytest` count unchanged by this plan; web `vitest` count grows by
every test added in Tasks 1-6), per this project's standing rule of
recomputing this constant fresh after any test-count change rather than
estimating it.

- [ ] **Step 5: Manual smoke check (documented, not automated — this project has no
  component-rendering or e2e test infrastructure)**

Run `cd web && npm run dev`, open `/assistant`, and confirm by hand:
- No conversation selected: chat shows the empty-state prompt, tool trace
  panel shows its own empty-state prompt, conversation list is empty (or
  shows previously-created ones if testing against a real Supabase project).
- Click "+ Cuộc trò chuyện mới": a new `dd/mm/yy`-titled conversation appears
  and is selected.
- Ask a real question: it appears in the chat, the answer streams in, and
  after it completes, both the chat and the tool trace panel show it as
  part of the conversation's persisted history (reload the page to confirm
  it survived — this is the real point of this whole plan).
- Rename the conversation inline; delete it (with the confirm step) and
  confirm both the chat and tool-trace panels clear/update accordingly.
- Ask a question with NO conversation selected: confirm it auto-creates one
  (per Task 9 Step 1's `submit()` logic) rather than silently failing.
- Temporarily rename the `SUPABASE_URL` env var (or stop the local Supabase
  project) and reload: confirm the conversation list shows its error message
  and a working "Thử lại" button instead of silently staying empty forever.

- [ ] **Step 6: Commit**

```bash
git add web/app/assistant/page.tsx web/lib/landingMeta.ts
git commit -m "feat: wire 3-column conversation UI into the RAG Assistant page"
```

---

## After all tasks

Dispatch the final whole-branch review (most capable model available), covering all 9 tasks' combined diff. Focus areas specific to this plan, beyond the standing Review Focus above:
- End-to-end trace a single "ask a question" request through every layer: `assistant/page.tsx``submit()` → `POST /api/assistant` → Lambda → `insertMessage` → `loadMessages` → `ChatThread`/`ToolTraceHistory` re-render — confirm the shapes match at every boundary (this is the single most likely place for a silent camelCase/snake_case or field-name mismatch to hide).
- Confirm `web/lib/conversations.ts` is never imported as a value (only `import type`) from any `"use client"` file, per the Global Constraints service-role-key isolation rule — grep for `from "@/lib/conversations"` across `web/components/` and `web/app/**/page.tsx` and check every match is `import type`.
- Confirm `TEST_COUNT` was recomputed from an actual fresh run, not estimated.

Then follow this project's established convention: push directly to `main`
(no worktree, no PR), watch CI, and — since this plan's only real-infra
touch is a brand-new Supabase project the user provisions themselves, not
Terraform/AWS — there should be no `apply` gate for this push. Live-verify
by exercising Step 4's manual smoke check against the real deployed site
once the env vars are set in Vercel.
