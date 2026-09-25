import type { SupabaseClient } from "@supabase/supabase-js";

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
