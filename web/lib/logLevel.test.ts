import { describe, expect, it } from "vitest";
import { detectLogLevel, logLevelColor } from "./logLevel";

describe("detectLogLevel", () => {
  it("finds the level keyword and folds WARNING into WARN", () => {
    expect(detectLogLevel("2026 ERROR boom")).toBe("ERROR");
    expect(detectLogLevel("WARNING slow")).toBe("WARN");
    expect(detectLogLevel("INFO ok")).toBe("INFO");
  });

  it("defaults to INFO", () => {
    expect(detectLogLevel("plain line")).toBe("INFO");
  });
});

describe("logLevelColor", () => {
  it("maps each level to a text colour", () => {
    expect(logLevelColor("ERROR")).toBe("text-error");
    expect(logLevelColor("WARN")).toBe("text-warning");
    expect(logLevelColor("INFO")).toBe("text-accent");
  });
});
