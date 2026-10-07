import { GetObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import type { GmailStats } from "./types";

export const GMAIL_STATS_KEY = "gmail_stats/latest.json";

const CATEGORIES = ["newsletter", "notification", "personal", "recruiting", "other"] as const;
const TOTAL_KEYS = ["emails", "needsReply", "urgent", "withDeadline", "unclassified"] as const;

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Validates the stats file and copies ONLY the known numeric/date fields, so nothing else that
 * ever lands in the file can reach the browser (the web app is public). Null when the shape is
 * wrong.
 */
export function parseGmailStats(raw: unknown): GmailStats | null {
  if (!isRecord(raw) || typeof raw.generatedAt !== "string" || !isCount(raw.windowDays)) return null;
  if (!isRecord(raw.totals) || !isRecord(raw.byCategory) || !Array.isArray(raw.perDay)) return null;

  const totals = {} as GmailStats["totals"];
  for (const key of TOTAL_KEYS) {
    const value = raw.totals[key];
    if (!isCount(value)) return null;
    totals[key] = value;
  }

  const byCategory = {} as GmailStats["byCategory"];
  for (const key of CATEGORIES) {
    const value = raw.byCategory[key];
    if (!isCount(value)) return null;
    byCategory[key] = value;
  }

  const perDay: GmailStats["perDay"] = [];
  for (const entry of raw.perDay) {
    if (!isRecord(entry) || typeof entry.date !== "string" || !isCount(entry.total)) return null;
    perDay.push({ date: entry.date, total: entry.total });
  }

  return { generatedAt: raw.generatedAt, windowDays: raw.windowDays, totals, byCategory, perDay };
}

/** The latest stats file, or null when it does not exist yet or cannot be parsed. */
export async function fetchGmailStats(client: Pick<S3Client, "send">, bucket: string): Promise<GmailStats | null> {
  try {
    const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: GMAIL_STATS_KEY }));
    const text = await response.Body?.transformToString();
    if (!text) return null;
    return parseGmailStats(JSON.parse(text));
  } catch (error) {
    const name = (error as { name?: string }).name;
    if (name === "NoSuchKey" || error instanceof SyntaxError) return null;
    throw error;
  }
}
