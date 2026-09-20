import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { clientIp } from "./clientIp";

function requestWithHeaders(headers: Record<string, string>): NextRequest {
  return new NextRequest("http://localhost/api/test", { headers });
}

describe("clientIp", () => {
  it("prefers x-vercel-forwarded-for when present", () => {
    const request = requestWithHeaders({
      "x-vercel-forwarded-for": "1.1.1.1",
      "x-real-ip": "2.2.2.2",
      "x-forwarded-for": "3.3.3.3, 4.4.4.4",
    });
    expect(clientIp(request)).toBe("1.1.1.1");
  });

  it("falls back to x-real-ip when x-vercel-forwarded-for is absent", () => {
    const request = requestWithHeaders({
      "x-real-ip": "2.2.2.2",
      "x-forwarded-for": "3.3.3.3, 4.4.4.4",
    });
    expect(clientIp(request)).toBe("2.2.2.2");
  });

  it("falls back to the rightmost X-Forwarded-For hop (client-spoofable leftmost hop is ignored)", () => {
    const request = requestWithHeaders({ "x-forwarded-for": "1.2.3.4, 5.6.7.8" });
    expect(clientIp(request)).toBe("5.6.7.8");
  });

  it("returns 'unknown' when no IP header is present", () => {
    const request = requestWithHeaders({});
    expect(clientIp(request)).toBe("unknown");
  });
});
