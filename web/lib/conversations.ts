import type { SupabaseClient } from "@supabase/supabase-js";

// Supabase access here uses the service-role key, which bypasses RLS: every
// query must filter by session_id itself, or one browser could read or modify
// another's conversations.

/** Supabase row shape (snake_case); ConversationJSON is what the API returns. */
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

const CONVERSATION_TITLE_TIME_ZONE = "Asia/Ho_Chi_Minh";

/** Default title "dd/mm/yy HH:MM:SS" in Vietnam time, independent of the server's timezone. */
export function formatDateTitle(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: CONVERSATION_TITLE_TIME_ZONE,
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("day")}/${get("month")}/${get("year")} ${get("hour")}:${get("minute")}:${get("second")}`;
}

/** Disambiguates same-second titles as "base (2)", "base (3)", ... */
export function nextConversationTitle(base: string, existingTitles: string[]): string {
  const matches = existingTitles.filter((t) => t === base || t.startsWith(`${base} (`));
  return matches.length === 0 ? base : `${base} (${matches.length + 1})`;
}

export function toConversationJSON(row: ConversationRow): ConversationJSON {
  return { id: row.id, title: row.title, updatedAt: row.updated_at };
}

/**
 * The anonymous per-browser id (see lib/sessionId.ts) that scopes all
 * conversation access; null when missing or blank.
 */
export function getSessionIdHeader(headers: Headers): string | null {
  const value = headers.get("x-session-id")?.trim();
  return value ? value : null;
}

/** The session's conversations, most recently updated first. */
export async function listConversations(client: SupabaseClient, sessionId: string): Promise<ConversationRow[]> {
  const { data, error } = await client
    .from("conversations")
    .select("id, title, updated_at")
    .eq("session_id", sessionId)
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return (data as ConversationRow[] | null) ?? [];
}

/** Creates a conversation titled with the current time, suffixed if that title is already taken. */
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

/** Renames and bumps updated_at; null if the id doesn't exist or belongs to another session. */
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

/** Returns false if nothing was deleted (unknown id or another session's conversation). */
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

/** Ownership check run before reading messages, which have no session_id of their own. */
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

/**
 * Messages oldest first. Returns null (not []) when the conversation isn't the
 * session's, so callers can answer 404 without revealing that it exists.
 */
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

/** Appends one Q&A turn. Does no ownership check: callers must verify the conversation first. */
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
