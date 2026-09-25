# Design: RAG Assistant conversations, Phase 1 (persistence + CRUD + 3-column UI)

## Context

`/assistant` (RAG Assistant) is currently fully stateless: one question in, one
answer out, nothing persisted anywhere. There is no way to see past questions,
no grouping of related questions into a conversation, and the "Tool trace"
panel only ever shows the single most recent turn.

The user asked for a Zalo/Telegram-style chat experience: a list of named
conversations (rename, delete, create new — default name `dd/mm/yy`), and a
tool-trace panel that shows the full trace history of whichever conversation
is open. They also asked for a two-tier memory design (Supabase = long-term,
Redis = short-term), and confirmed the agent should eventually be able to use
prior turns in the same conversation as context for follow-up questions
("what about Ethereum?" after "what's the Bitcoin price?").

Given the size of the full request, it was decomposed into three phases (user
confirmed 2026-09-25):

- **Phase 1** (this spec): conversation persistence, CRUD, and the 3-column
  UI. Each question is still answered independently — Supabase's job here is
  durable storage and history display, not agent context.
- **Phase 2** (future, own spec): the agent actually uses prior turns in the
  same conversation as Bedrock Converse context, so follow-up questions work.
- **Phase 3** (future, own spec): a Redis cache layer in front of Supabase for
  the active conversation, to cut read latency/quota on hot conversations.

This spec covers **Phase 1 only**. Phases 2 and 3 are out of scope here and
must not be implemented as part of this spec's plan.

## Goals

- A visitor can create, rename, and delete conversations, and see a list of
  their own conversations (Zalo/Telegram-style left column).
- Every question asked and every real answer (including its real tool trace
  and sources) is durably persisted, survives a page reload, and is scoped to
  the browser that created it — no login required.
- The existing `/assistant` chat experience (ask a question, see the answer,
  see its tool trace) keeps working exactly as it does today from the user's
  perspective, just now inside a named, persisted conversation instead of a
  single ephemeral exchange.
- No new abuse surface: conversation/message creation is rate-limited the
  same way `/api/assistant` already is.

## Non-goals (explicitly deferred)

- The agent does **not** receive prior conversation turns as Bedrock Converse
  context in this phase. Each question is still answered independently by
  `rag/agent.py`, exactly as today. (Phase 2.)
- No Redis involvement in this phase. Supabase is read/written directly on
  every request. (Phase 3 adds caching; it must not change behavior, only
  latency/cost.)
- No user accounts, login, or password of any kind. Session identity is an
  anonymous per-browser ID (see below) — clearing browser storage or
  switching browsers loses access to that browser's conversation history,
  by design.
- No cross-conversation memory or search. Conversations are fully isolated
  from each other.
- No editing/regenerating a past message. A conversation's messages are
  append-only once created.

## Session identity

On first load, `web/app/assistant/page.tsx` checks `localStorage` for a
`assistant_session_id` key. If absent, it generates one
(`crypto.randomUUID()`) and stores it. Every conversation/message API call
sends it as a request header, `X-Session-Id`. There is no server-side session
table — the ID is just an opaque foreign key value stored on each
`conversations` row. Losing it (cleared storage, different browser,
incognito) means that browser can no longer see or manage those
conversations; the rows themselves are not deleted by this.

This is intentionally the same trust model as the rest of this app: nothing
sensitive is gated behind it, it's a convenience partition, not a security
boundary.

## Data model (Supabase, Postgres)

Two tables, created via a SQL migration the user runs once against their own
real Supabase project (the assistant never has direct Supabase admin access —
same credential-handling rule as AWS/GitHub throughout this project: the user
creates the Supabase project and runs the migration themselves, then pastes
the connection values into Vercel's env var UI).

```sql
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

- `tool_calls`/`sources` store exactly the same real shapes already returned
  by `rag/agent.py` today (`AssistantResult["toolCalls"]` /
  `AssistantResult["sources"]`, per `web/lib/assistant.ts`) — no new shape to
  invent, no data transformation beyond JSON-encoding what the Lambda already
  returns.
- `on delete cascade` means deleting a conversation deletes its messages in
  one operation — no orphaned rows, no separate cleanup job.
- Deletion is a **hard delete**. This is a low-stakes, per-browser demo
  conversation history, not an audit log; "delete" should mean gone.

## API surface

All five routes live under `web/app/api/conversations/`. All require the
`X-Session-Id` header; a request without one gets `400`. All read/write only
rows whose `session_id` matches the header — a request can never see or
touch another session's conversations, enforced in the route handler (not
Postgres RLS, since the service-role key is used server-side only, same
trust model as this project's other server-only external-API keys).

### `GET /api/conversations`
Returns this session's conversations, newest-first by `updated_at`.
```json
{ "conversations": [{ "id": "...", "title": "25/09/26", "updatedAt": "..." }] }
```

### `POST /api/conversations`
Creates a new conversation. Body: `{}` (no input needed). Default title is
the base string `dd/mm/yy` in the server's UTC date. To pick the final
title: query `select title from conversations where session_id = $1 and
title = $2 or title like $2 || ' (%'` (one query, `$2` = the base string),
count the matching rows `n`; if `n = 0` the title is just the base string,
otherwise it's `base + " (" + (n + 1) + ")"`. This is a read-then-write, not
a database-enforced uniqueness constraint — a rare double-click race could
produce two conversations both computing the same suffix, which is an
accepted, harmless outcome for a demo feature (see "Risks" below), not
worth a stricter locking scheme.
```json
{ "id": "...", "title": "25/09/26" }
```
Rate-limited: reuses `web/lib/ratelimit.ts`'s pattern, a new
`getConversationLimiter()` (`slidingWindow(10, "1 h")`) — mirrors the
existing per-route-limiter convention exactly (`getExplorerLimiter`,
`getCostLimiter`). Returns `429` with the same JSON error shape as the
existing rate-limited routes when exceeded.

### `PATCH /api/conversations/:id`
Body: `{ "title": "new name" }`. Renames if the conversation belongs to this
session; `404` if it doesn't exist or belongs to a different session (never
leak "exists but not yours" vs. "doesn't exist" — same response either way).
Trims and length-caps the title (100 chars, matching the general pattern of
`MAX_QUESTION_LENGTH` elsewhere in this codebase) and rejects empty after
trim with `400`.

### `DELETE /api/conversations/:id`
Deletes if owned by this session (cascades to messages); `404` otherwise
(same non-leaking rule as PATCH).

### `GET /api/conversations/:id/messages`
Returns the full message history for one conversation, oldest-first, for
rendering the chat thread and the tool-trace panel. `404` if not owned by
this session.
```json
{
  "messages": [
    {
      "id": "...",
      "question": "...",
      "answer": "...",
      "grounded": true,
      "toolCalls": [...],
      "sources": [...],
      "createdAt": "..."
    }
  ]
}
```

### `POST /api/assistant` (modified, not replaced)
Gains an optional `conversationId` in the request body. Behavior is
unchanged up through calling the real Lambda (same validation, same rate
limit, same Lambda invocation, same `normalizeAssistantResult`). The only
addition: on a successful (`200`) Lambda response, if `conversationId` was
provided, insert one row into `messages` for it before returning the
response to the client (fire-and-checked, not fire-and-forget — if the
insert fails, log it server-side but still return the real answer to the
user; a persistence hiccup must never hide a real, already-obtained answer).
If `conversationId` is provided but doesn't belong to this session
(`X-Session-Id` mismatch), respond `404` before ever calling the Lambda —
never spend a real Bedrock invocation on an invalid conversation reference.

## Frontend structure

`web/app/assistant/page.tsx` is restructured into three columns:

1. **`ConversationList`** (new component, left column): fetches
   `GET /api/conversations` on mount, renders each with its title and a
   relative/absolute updated time, inline rename (click a pencil icon, turns
   the title into a text input, `PATCH` on blur/Enter), delete (a confirm
   step — a real destructive action deleting real persisted data — then
   `DELETE`), and a "+ New conversation" action (`POST`, then selects it).
   Holds no chat state itself; reports the selected conversation id up to
   the page.
2. **`ChatThread`** (existing component, extended): currently takes a single
   `question`/`result`/`loading`. Extended to take the selected
   conversation's full `messages` array (from
   `GET /api/conversations/:id/messages`) and render one bubble-pair per
   message, in order, plus the in-flight question/loading state for a
   not-yet-persisted turn exactly as it does today. The per-message avatar
   icons and markdown rendering added earlier this project stay unchanged.
3. **`ToolTraceHistory`** (new component, replacing today's single-turn
   `ToolTrace`, right column): when no conversation is selected, shows a
   short empty-state prompt (not a duplicate conversation list — the
   3-column mockup you approved keeps the list on the left only). Once a
   conversation is open, renders every message's `toolCalls` in order,
   labeled by turn, reusing the existing tool-trace rendering styling.

Selecting, renaming, deleting, or creating a conversation in the left column
immediately re-renders both the middle and right columns to match — they all
key off the same `selectedConversationId` state in the page component, so
there's exactly one source of truth for "which conversation is open," not
three independently-synced ones.

Visual treatment (glass panels, icons, motion, matching the rest of this
app's established design system) is a `frontend-design` pass on top of this
structure, done once this structural design is implemented — not part of
this spec's plan.

## Error handling

- Every new API route follows this codebase's existing convention exactly:
  validate input → `400`; ownership check → `404`; real backend (Supabase)
  failure → `500` with a Vietnamese user-facing message, real error logged
  server-side via `console.error`, matching `/api/assistant`'s existing
  pattern.
- The frontend's conversation list and message history both need their own
  loading/error/retry states, following the existing pattern already used by
  `app/catalog/page.tsx`/`app/cicd/page.tsx` (a `Thử lại` retry button on
  fetch failure).
- If persisting a message fails after a real answer was already obtained
  (see `/api/assistant` above), the user still sees their real answer; the
  conversation's history will just be missing that one turn until they ask
  again. This is an accepted, logged degradation, not a hard failure.

## Testing plan

Following this codebase's standing convention: real unit tests, no
component-rendering tests. New/changed files needing tests:

- `web/app/api/conversations/route.ts` (GET/POST): default-title
  `dd/mm/yy` generation, the `(2)`/`(3)` collision-suffix logic, session-id
  requirement, rate-limit enforcement — Supabase client mocked at the same
  boundary this codebase already mocks AWS clients at in other route tests.
- `web/app/api/conversations/[id]/route.ts` (PATCH/DELETE): ownership
  enforcement (404 for another session's conversation), title
  trim/length-cap/empty-rejection.
- `web/app/api/conversations/[id]/messages/route.ts` (GET): ownership
  enforcement, ordering.
- `web/app/api/assistant/route.ts` (modified): existing tests must still
  pass unchanged; new tests for the `conversationId` ownership check (404
  before invoking the Lambda) and for the persistence step running only on a
  successful Lambda response.

## Deployment

- New env vars (Vercel): `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (the
  user creates the Supabase project, runs the SQL migration above once via
  the Supabase SQL editor, and pastes these into Vercel's env var UI — the
  same pattern as every other credential in this project; the assistant
  never handles or generates them).
- No AWS/Terraform changes. No changes to `rag/agent.py` or the deployed
  Lambda — Phase 1 is entirely a `web/` (Next.js) + Supabase change.
- New npm dependency: `@supabase/supabase-js` (the standard, official
  client — same category of decision as `react-markdown` earlier this
  project: a well-established library for a real functional need, not
  hand-rolled).

## Risks / open items

- Supabase's free tier (500MB DB, 2GB bandwidth/month) is real and finite.
  For a portfolio-scale demo this should be far from binding, but it's a
  real constraint worth the user's awareness, not a number this spec
  fabricates a guarantee about.
- A rare double-click on "+ New conversation" could produce two rows with
  the same title suffix collision resolved slightly differently (both see
  `0` existing dupes, both create `(2)`) — accepted as harmless per the
  "Rate limiting" section above; not worth a stricter locking scheme for a
  demo feature.
- This spec does not change `rag/agent.py` at all — Phase 2 will need to
  design how much conversation history to send back to Bedrock (all of it?
  last N turns? token-budget-truncated?) as a separate decision when that
  phase is brainstormed.
