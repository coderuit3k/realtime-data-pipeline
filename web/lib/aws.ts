import { AthenaClient } from "@aws-sdk/client-athena";
import { LambdaClient } from "@aws-sdk/client-lambda";
import { CloudWatchClient } from "@aws-sdk/client-cloudwatch";

export function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

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
