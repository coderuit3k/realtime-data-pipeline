import { NextResponse } from "next/server";
import { getRecentCommits } from "@/lib/github";
import type { CommitsResponse } from "@/lib/types";

export const maxDuration = 60;

export async function GET() {
  try {
    const commits = await getRecentCommits(5);
    const response: CommitsResponse = { commits };

    return NextResponse.json(response, {
      headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120" },
    });
  } catch (error) {
    console.error("Commits API failed", error);
    return NextResponse.json({ error: "Không tải được commit, thử lại sau." }, { status: 500 });
  }
}
