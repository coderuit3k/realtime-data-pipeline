import { AthenaClient } from "@aws-sdk/client-athena";
import { LambdaClient } from "@aws-sdk/client-lambda";
import { CloudWatchClient } from "@aws-sdk/client-cloudwatch";
import { GlueClient } from "@aws-sdk/client-glue";
import { EventBridgeClient } from "@aws-sdk/client-eventbridge";
import { CloudWatchLogsClient } from "@aws-sdk/client-cloudwatch-logs";
import { SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { CostExplorerClient } from "@aws-sdk/client-cost-explorer";

/** Reads an env var, throwing (rather than passing `undefined` on) when it is unset or empty. */
export function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

// Lazy module-level singletons: reused across requests on a warm serverless
// instance, and created on first call so a missing env var surfaces inside the
// route's try/catch instead of at import time.
let athenaClient: AthenaClient | undefined;
export function getAthenaClient(): AthenaClient {
  if (!athenaClient) athenaClient = new AthenaClient({ region: requiredEnv("AWS_REGION") });
  return athenaClient;
}

let lambdaClient: LambdaClient | undefined;
export function getLambdaClient(): LambdaClient {
  if (!lambdaClient) lambdaClient = new LambdaClient({ region: requiredEnv("AWS_REGION") });
  return lambdaClient;
}

let cloudWatchClient: CloudWatchClient | undefined;
export function getCloudWatchClient(): CloudWatchClient {
  if (!cloudWatchClient) cloudWatchClient = new CloudWatchClient({ region: requiredEnv("AWS_REGION") });
  return cloudWatchClient;
}

let glueClient: GlueClient | undefined;
export function getGlueClient(): GlueClient {
  if (!glueClient) glueClient = new GlueClient({ region: requiredEnv("AWS_REGION") });
  return glueClient;
}

let eventBridgeClient: EventBridgeClient | undefined;
export function getEventBridgeClient(): EventBridgeClient {
  if (!eventBridgeClient) eventBridgeClient = new EventBridgeClient({ region: requiredEnv("AWS_REGION") });
  return eventBridgeClient;
}

let cloudWatchLogsClient: CloudWatchLogsClient | undefined;
export function getCloudWatchLogsClient(): CloudWatchLogsClient {
  if (!cloudWatchLogsClient) cloudWatchLogsClient = new CloudWatchLogsClient({ region: requiredEnv("AWS_REGION") });
  return cloudWatchLogsClient;
}

let secretsManagerClient: SecretsManagerClient | undefined;
export function getSecretsManagerClient(): SecretsManagerClient {
  if (!secretsManagerClient) secretsManagerClient = new SecretsManagerClient({ region: requiredEnv("AWS_REGION") });
  return secretsManagerClient;
}

let costExplorerClient: CostExplorerClient | undefined;
/** Cost Explorer only has a us-east-1 endpoint, so this client deliberately ignores AWS_REGION. */
export function getCostExplorerClient(): CostExplorerClient {
  if (!costExplorerClient) costExplorerClient = new CostExplorerClient({ region: "us-east-1" });
  return costExplorerClient;
}
