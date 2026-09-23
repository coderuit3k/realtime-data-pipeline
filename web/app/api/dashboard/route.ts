import { NextResponse } from "next/server";
import {
  getAthenaClient,
  getCloudWatchClient,
  getEventBridgeClient,
  getCloudWatchLogsClient,
  requiredEnv,
} from "@/lib/aws";
import {
  runAthenaQuery,
  todayUtcParts,
  buildSourceVolumeQuery,
  buildRecentActivityQuery,
  parseAthenaRows,
} from "@/lib/athena";
import { getAlarmStatus } from "@/lib/cloudwatchAlarms";
import { getScheduleStatus } from "@/lib/eventbridge";
import { getLambdaHealth } from "@/lib/cloudwatchMetrics";
import { queryRecentLogs } from "@/lib/cloudwatchLogs";
import { getBucketStorageStats } from "@/lib/s3Metrics";
import { getAthenaAvgQueryTimeMs } from "@/lib/athenaMetrics";
import { DATA_SOURCES } from "@/lib/settingsMeta";
import { PIPELINE_LAMBDAS, COST_BREAKDOWN } from "@/lib/opsMeta";
import type { DashboardResponse, SourceVolume, ActivityItem } from "@/lib/types";

export const maxDuration = 60;

export async function GET() {
  try {
    const parts = todayUtcParts();
    const athena = getAthenaClient();
    const cloudwatch = getCloudWatchClient();
    const prefix = requiredEnv("ALARM_NAME_PREFIX");
    const ruleName = `${prefix}-ingestion-schedule`;
    const functionNames = PIPELINE_LAMBDAS.map((lambda) => ({
      fullName: `${prefix}-${lambda.suffix}`,
      label: lambda.label,
    }));
    const logGroupNames = functionNames.map((fn) => `/aws/lambda/${fn.fullName}`);
    const rawBucket = requiredEnv("RAW_BUCKET");
    const curatedBucket = requiredEnv("CURATED_BUCKET");
    const workgroup = requiredEnv("ATHENA_WORKGROUP");

    const [
      volumeRows,
      activityRows,
      alarmStatus,
      schedule,
      lambdaHealth,
      recentLogs,
      rawStorage,
      curatedStorage,
      athenaAvgQueryMs,
    ] = await Promise.all([
      runAthenaQuery(athena, buildSourceVolumeQuery(parts)),
      runAthenaQuery(athena, buildRecentActivityQuery(parts)),
      getAlarmStatus(cloudwatch, prefix),
      getScheduleStatus(getEventBridgeClient(), ruleName),
      getLambdaHealth(cloudwatch, functionNames),
      queryRecentLogs(getCloudWatchLogsClient(), logGroupNames, 5, `${prefix}-`),
      getBucketStorageStats(cloudwatch, rawBucket),
      getBucketStorageStats(cloudwatch, curatedBucket),
      getAthenaAvgQueryTimeMs(cloudwatch, workgroup),
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

    const response: DashboardResponse = {
      recordsToday,
      sourceVolumes,
      sourcesHealthy,
      sourcesTotal: DATA_SOURCES.length,
      alarmsBreaching: alarmStatus.alarmsBreaching,
      alarmsTotal: alarmStatus.alarmsTotal,
      recentActivity,
      lambdaHealth,
      schedule,
      recentLogs,
      costBreakdown: COST_BREAKDOWN,
      rawStorage,
      curatedStorage,
      athenaAvgQueryMs,
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
