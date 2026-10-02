import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { requiredEnv } from "@/lib/aws";

// Upstash-backed sliding-window limiters, one per costly endpoint. Each has its
// own Redis key prefix so budgets are independent, and is created lazily so a
// missing env var fails inside the route's error handling.

let defaultLimiter: Ratelimit | undefined;
/** /api/assistant: 5 questions/min per IP, as each one invokes Bedrock via rag_agent. */
function getDefaultLimiter(): Ratelimit {
  if (!defaultLimiter) {
    const redis = new Redis({
      url: requiredEnv("UPSTASH_REDIS_REST_URL"),
      token: requiredEnv("UPSTASH_REDIS_REST_TOKEN"),
    });
    defaultLimiter = new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(5, "1 m"),
      prefix: "assistant-ratelimit",
    });
  }
  return defaultLimiter;
}

let explorerLimiter: Ratelimit | undefined;
/** /api/explorer/query: 3 queries/min per IP, since arbitrary SQL is billed per byte scanned. */
export function getExplorerLimiter(): Ratelimit {
  if (!explorerLimiter) {
    const redis = new Redis({
      url: requiredEnv("UPSTASH_REDIS_REST_URL"),
      token: requiredEnv("UPSTASH_REDIS_REST_TOKEN"),
    });
    explorerLimiter = new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(3, "1 m"),
      prefix: "explorer-ratelimit",
    });
  }
  return explorerLimiter;
}

let costLimiter: Ratelimit | undefined;
/** /api/cost: 5 requests/min per IP; guards the $0.01-per-call Cost Explorer API on CDN cache misses. */
export function getCostLimiter(): Ratelimit {
  if (!costLimiter) {
    const redis = new Redis({
      url: requiredEnv("UPSTASH_REDIS_REST_URL"),
      token: requiredEnv("UPSTASH_REDIS_REST_TOKEN"),
    });
    costLimiter = new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(5, "1 m"),
      prefix: "cost-ratelimit",
    });
  }
  return costLimiter;
}

let conversationLimiter: Ratelimit | undefined;
/** Conversation creation: 10/hour per IP, to stop scripted row spam in Supabase. */
export function getConversationLimiter(): Ratelimit {
  if (!conversationLimiter) {
    const redis = new Redis({
      url: requiredEnv("UPSTASH_REDIS_REST_URL"),
      token: requiredEnv("UPSTASH_REDIS_REST_TOKEN"),
    });
    conversationLimiter = new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(10, "1 h"),
      prefix: "conversation-ratelimit",
    });
  }
  return conversationLimiter;
}

export type RateLimitResult = { allowed: boolean; remaining: number };

/** Consumes one request for `identifier` (usually the client IP); defaults to the assistant limiter. */
export async function checkRateLimit(
  identifier: string,
  limiter: Ratelimit = getDefaultLimiter()
): Promise<RateLimitResult> {
  const { success, remaining } = await limiter.limit(identifier);
  return { allowed: success, remaining };
}
