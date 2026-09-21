import { NextResponse } from "next/server";
import { getAthenaClient, requiredEnv } from "@/lib/aws";
import { runAthenaQuery, todayUtcParts, buildSourceVolumeQuery, parseAthenaRows } from "@/lib/athena";
import { DATA_SOURCES } from "@/lib/settingsMeta";
import type { HealthResponse, SourceVolume } from "@/lib/types";

export const maxDuration = 60;

export async function GET() {
  try {
    const parts = todayUtcParts();
    const rows = await runAthenaQuery(getAthenaClient(), buildSourceVolumeQuery(parts));
    const sourceVolumes: SourceVolume[] = parseAthenaRows(rows, (cols) => ({
      source: cols[0] ?? "",
      records: Number(cols[1] ?? 0),
    }));
    const sourcesHealthy = sourceVolumes.filter((s) => s.records > 0).length;

    const response: HealthResponse = {
      sourcesHealthy,
      sourcesTotal: DATA_SOURCES.length,
      region: requiredEnv("AWS_REGION"),
      environment: requiredEnv("DEPLOY_ENVIRONMENT"),
    };

    return NextResponse.json(response, {
      headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120" },
    });
  } catch (error) {
    console.error("Health API failed", error);
    return NextResponse.json({ error: "Không tải được trạng thái, thử lại sau." }, { status: 500 });
  }
}
