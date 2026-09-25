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
