import { afterEach, describe, expect, it, vi } from "vitest";
import { requiredEnv } from "./aws";

describe("requiredEnv", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns the value when set", () => {
    vi.stubEnv("AWS_REGION", "us-east-1");
    expect(requiredEnv("AWS_REGION")).toBe("us-east-1");
  });

  it("throws a clear error when missing", () => {
    vi.stubEnv("SOME_MISSING_VAR", "");
    expect(() => requiredEnv("SOME_MISSING_VAR")).toThrow(
      "Missing required environment variable: SOME_MISSING_VAR"
    );
  });
});
