import { NextResponse } from "next/server";
import { getEventBridgeClient, getSecretsManagerClient, requiredEnv } from "@/lib/aws";
import { getScheduleStatus } from "@/lib/eventbridge";
import { getSecretStatus } from "@/lib/secretsManager";
import { SECRET_LABELS } from "@/lib/settingsMeta";
import type { SettingsResponse } from "@/lib/types";

export const maxDuration = 60;

/** Read-only view of the ingestion schedules and whether each API-key secret is set (never its value). */
export async function GET() {
  try {
    const prefix = requiredEnv("ALARM_NAME_PREFIX");
    // Must match the rule names in infra/eventbridge.tf.
    const sharedRuleName = `${prefix}-ingestion-schedule`;
    const newsRuleName = `${prefix}-news-ingestion-schedule`;
    const newsSecretId = requiredEnv("NEWS_SECRET_NAME");
    const tavilySecretId = requiredEnv("TAVILY_SECRET_NAME");

    const eventBridge = getEventBridgeClient();
    const secretsManager = getSecretsManagerClient();

    const [sharedSchedule, newsSchedule, newsSecret, tavilySecret] = await Promise.all([
      getScheduleStatus(eventBridge, sharedRuleName),
      getScheduleStatus(eventBridge, newsRuleName),
      getSecretStatus(secretsManager, newsSecretId),
      getSecretStatus(secretsManager, tavilySecretId),
    ]);

    // SECRET_LABELS is positional: [0] = news, [1] = tavily.
    const response: SettingsResponse = {
      sharedSchedule,
      newsSchedule,
      secrets: [
        { name: SECRET_LABELS[0], configured: newsSecret.configured },
        { name: SECRET_LABELS[1], configured: tavilySecret.configured },
      ],
    };

    return NextResponse.json(response, {
      headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120" },
    });
  } catch (error) {
    console.error("Settings API failed", error);
    return NextResponse.json({ error: "Không tải được Settings, thử lại sau." }, { status: 500 });
  }
}
