import { describe, expect, it } from "vitest";
import { readPanelCollapsed, writePanelCollapsed } from "./panelState";

function makeStorage(initial: Record<string, string> = {}) {
  const store: Record<string, string> = { ...initial };
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
  };
}

const throwingStorage = {
  getItem: () => {
    throw new Error("blocked");
  },
  setItem: () => {
    throw new Error("blocked");
  },
};

describe("readPanelCollapsed", () => {
  it("defaults to expanded when nothing is stored", () => {
    expect(readPanelCollapsed(makeStorage(), "panel")).toBe(false);
  });

  it("reads back a collapsed panel", () => {
    expect(readPanelCollapsed(makeStorage({ panel: "1" }), "panel")).toBe(true);
  });

  it("treats any other stored value as expanded", () => {
    expect(readPanelCollapsed(makeStorage({ panel: "garbage" }), "panel")).toBe(false);
  });

  it("falls back to expanded when storage is unavailable or throws", () => {
    expect(readPanelCollapsed(undefined, "panel")).toBe(false);
    expect(readPanelCollapsed(throwingStorage, "panel")).toBe(false);
  });
});

describe("writePanelCollapsed", () => {
  it("persists collapsed and expanded states", () => {
    const storage = makeStorage();
    writePanelCollapsed(storage, "panel", true);
    expect(readPanelCollapsed(storage, "panel")).toBe(true);
    writePanelCollapsed(storage, "panel", false);
    expect(readPanelCollapsed(storage, "panel")).toBe(false);
  });

  it("never throws when storage is unavailable or blocked", () => {
    expect(() => writePanelCollapsed(undefined, "panel", true)).not.toThrow();
    expect(() => writePanelCollapsed(throwingStorage, "panel", true)).not.toThrow();
  });
});
