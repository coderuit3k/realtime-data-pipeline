import { NextResponse } from "next/server";
import { getAthenaClient, getCloudWatchClient, requiredEnv } from "@/lib/aws";
import {
  runAthenaQuery,
  todayUtcParts,
  buildSourceVolumeQuery,
  buildRecentActivityQuery,
  parseAthenaRows,
} from "@/lib/athena";
import { getAlarmStatus } from "@/lib/cloudwatchAlarms";
import { DATA_SOURCES } from "@/lib/settingsMeta";
import type { DashboardResponse, SourceVolume, ActivityItem } from "@/lib/types";

export const revalidate = 60;

// rag_query/rag_agent aren't invoked here, but Athena queries can be slow;
// 60 is Vercel's ceiling on non-Pro plans.
export const maxDuration = 60;

export async function GET() {
  try {
    const parts = todayUtcParts();
    const athena = getAthenaClient();

    const [volumeRows, activityRows] = await Promise.all([
      runAthenaQuery(athena, buildSourceVolumeQuery(parts)),
      runAthenaQuery(athena, buildRecentActivityQuery(parts)),
    ]);

    const sourceVolumes: SourceVolume[] = parseAthenaRows(volumeRows, (cols) => ({
      source: cols[0] ?? "",
      records: Number(cols[1] ?? 0),
    }));
    const recentActivity: ActivityItem[] = parseAthenaRows(activityRows, (cols) => ({
      source: cols[0] ?? "",
      label: cols[1] ?? "",
      ingestedAt: cols[2] ?? "",
    }));

    const recordsToday = sourceVolumes.reduce((sum, s) => sum + s.records, 0);
    const sourcesHealthy = sourceVolumes.filter((s) => s.records > 0).length;

    const { alarmsBreaching, alarmsTotal } = await getAlarmStatus(
      getCloudWatchClient(),
      requiredEnv("ALARM_NAME_PREFIX")
    );

    const response: DashboardResponse = {
      recordsToday,
      sourceVolumes,
      sourcesHealthy,
      sourcesTotal: DATA_SOURCES.length,
      alarmsBreaching,
      alarmsTotal,
      recentActivity,
    };
    return NextResponse.json(response, {
      headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" },
    });
  } catch (error) {
    console.error("Dashboard API failed", error);
    return NextResponse.json(
      { error: "Không tải được dữ liệu dashboard, thử lại sau." },
      { status: 500 }
    );
  }
}
