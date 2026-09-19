import { describe, expect, it, vi } from "vitest";
import type { Ratelimit } from "@upstash/ratelimit";
import { checkRateLimit } from "./ratelimit";

function fakeLimiter(success: boolean, remaining: number): Ratelimit {
  return { limit: vi.fn().mockResolvedValue({ success, remaining }) } as unknown as Ratelimit;
}

describe("checkRateLimit", () => {
  it("returns allowed:true under the limit", async () => {
    const result = await checkRateLimit("1.2.3.4", fakeLimiter(true, 4));
    expect(result).toEqual({ allowed: true, remaining: 4 });
  });

  it("returns allowed:false over the limit", async () => {
    const result = await checkRateLimit("1.2.3.4", fakeLimiter(false, 0));
    expect(result).toEqual({ allowed: false, remaining: 0 });
  });
});
