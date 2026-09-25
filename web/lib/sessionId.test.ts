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
