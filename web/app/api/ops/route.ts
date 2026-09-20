import { NextResponse } from "next/server";
import { getCloudWatchClient, getEventBridgeClient, getCloudWatchLogsClient, requiredEnv } from "@/lib/aws";
import { getScheduleStatus } from "@/lib/eventbridge";
import { getLambdaHealth } from "@/lib/cloudwatchMetrics";
import { queryRecentLogs } from "@/lib/cloudwatchLogs";
import { getAlarmStatus } from "@/lib/cloudwatchAlarms";
import { PIPELINE_LAMBDAS, COST_ESTIMATE_USD, COST_BREAKDOWN } from "@/lib/opsMeta";
import type { OpsResponse } from "@/lib/types";

export const maxDuration = 60;

export async function GET() {
  try {
    const prefix = requiredEnv("ALARM_NAME_PREFIX");
    const ruleName = `${prefix}-ingestion-schedule`;
    const functionNames = PIPELINE_LAMBDAS.map((lambda) => ({
      fullName: `${prefix}-${lambda.suffix}`,
      label: lambda.label,
    }));
    const logGroupNames = functionNames.map((fn) => `/aws/lambda/${fn.fullName}`);

    const [schedule, lambdaHealth, recentLogs, alarmStatus] = await Promise.all([
      getScheduleStatus(getEventBridgeClient(), ruleName),
      getLambdaHealth(getCloudWatchClient(), functionNames),
      queryRecentLogs(getCloudWatchLogsClient(), logGroupNames, 5, `${prefix}-`),
      getAlarmStatus(getCloudWatchClient(), prefix),
    ]);

    const response: OpsResponse = {
      lambdaHealth,
      schedule,
      alarmsBreaching: alarmStatus.alarmsBreaching,
      alarmsTotal: alarmStatus.alarmsTotal,
      costEstimateUsd: COST_ESTIMATE_USD,
      costBreakdown: COST_BREAKDOWN,
      recentLogs,
    };

    return NextResponse.json(response, {
      headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120" },
    });
  } catch (error) {
    console.error("Ops API failed", error);
    return NextResponse.json({ error: "Không tải được Ops, thử lại sau." }, { status: 500 });
  }
}
