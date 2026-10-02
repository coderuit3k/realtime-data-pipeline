import type { NextRequest } from "next/server";

/**
 * Best-effort client IP used as the rate-limit key. Prefers headers set by
 * Vercel's proxy; for x-forwarded-for it takes the LAST hop, since earlier
 * entries are client-supplied and trivially spoofed to dodge the limiter.
 */
export function clientIp(request: NextRequest): string {
  const h = request.headers;
  const xff = h.get("x-forwarded-for")?.split(",").map((s) => s.trim()).filter(Boolean) ?? [];
  return (
    h.get("x-vercel-forwarded-for")?.trim() ||
    h.get("x-real-ip")?.trim() ||
    xff[xff.length - 1] ||
    "unknown"
  );
}
