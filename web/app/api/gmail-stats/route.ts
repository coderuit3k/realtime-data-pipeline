import { NextResponse } from "next/server";
import { getS3Client, requiredEnv } from "@/lib/aws";
import { fetchGmailStats } from "@/lib/gmailStats";
import type { GmailStatsResponse } from "@/lib/types";

/**
 * Aggregate Gmail numbers (counts and dates only) written by the gmail_stats Lambda. Reads one S3
 * object; the Gmail Glue database stays out of reach of the public web app.
 */
export async function GET() {
  try {
    const stats = await fetchGmailStats(getS3Client(), requiredEnv("CURATED_BUCKET"));
    const response: GmailStatsResponse = { stats };
    return NextResponse.json(response, {
      headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" },
    });
  } catch (error) {
    console.error("Gmail stats API failed", error);
    return NextResponse.json({ error: "Không tải được thống kê Gmail, thử lại sau." }, { status: 500 });
  }
}
