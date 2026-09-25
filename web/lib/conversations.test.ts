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
