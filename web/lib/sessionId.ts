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
