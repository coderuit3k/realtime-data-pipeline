import { NextResponse } from "next/server";
import { getEventBridgeClient, getSecretsManagerClient, requiredEnv } from "@/lib/aws";
import { getScheduleStatus } from "@/lib/eventbridge";
import { getSecretStatus } from "@/lib/secretsManager";
import { SECRET_LABELS } from "@/lib/settingsMeta";
import type { SettingsResponse } from "@/lib/types";

export const maxDuration = 60;

// Env vars holding each secret's name; positional with SECRET_LABELS.
const SECRET_ENV_NAMES = ["NEWS_SECRET_NAME", "TAVILY_SECRET_NAME", "QDRANT_SECRET_NAME", "JINA_SECRET_NAME"];

/**
 * Configured flag for one secret, or null when it cannot be checked (env var
 * not set on Vercel yet, or the web-app IAM user lacks DescribeSecret on it),
 * so one unreachable secret does not take the whole page down.
 */
async function checkSecret(client: ReturnType<typeof getSecretsManagerClient>, envName: string): Promise<boolean | null> {
  try {
    const { configured } = await getSecretStatus(client, requiredEnv(envName));
    return configured;
  } catch (error) {
    console.error(`Settings: could not check secret from ${envName}`, error);
    return null;
  }
}

/** Read-only view of the ingestion schedules and whether each API-key secret is set (never its value). */
export async function GET() {
  try {
    const prefix = requiredEnv("ALARM_NAME_PREFIX");
    // Must match the rule names in infra/eventbridge.tf.
    const sharedRuleName = `${prefix}-ingestion-schedule`;
    const newsRuleName = `${prefix}-news-ingestion-schedule`;

    const eventBridge = getEventBridgeClient();
    const secretsManager = getSecretsManagerClient();

    const [sharedSchedule, newsSchedule, ...configured] = await Promise.all([
      getScheduleStatus(eventBridge, sharedRuleName),
      getScheduleStatus(eventBridge, newsRuleName),
      ...SECRET_ENV_NAMES.map((envName) => checkSecret(secretsManager, envName)),
    ]);

    const response: SettingsResponse = {
      sharedSchedule,
      newsSchedule,
      secrets: SECRET_LABELS.map((name, i) => ({ name, configured: configured[i] })),
    };

    return NextResponse.json(response, {
      headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120" },
    });
  } catch (error) {
    console.error("Settings API failed", error);
    return NextResponse.json({ error: "Không tải được Settings, thử lại sau." }, { status: 500 });
  }
}
