import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { requiredEnv } from "@/lib/aws";

let defaultLimiter: Ratelimit | undefined;
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

export type RateLimitResult = { allowed: boolean; remaining: number };

export async function checkRateLimit(
  identifier: string,
  limiter: Ratelimit = getDefaultLimiter()
): Promise<RateLimitResult> {
  const { success, remaining } = await limiter.limit(identifier);
  return { allowed: success, remaining };
}
