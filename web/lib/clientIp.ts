import type { NextRequest } from "next/server";

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
