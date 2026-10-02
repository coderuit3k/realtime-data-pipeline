import { DescribeSecretCommand, type SecretsManagerClient } from "@aws-sdk/client-secrets-manager";

/**
 * Whether a secret has a value, judged by a version staged AWSCURRENT.
 * Security: uses DescribeSecret, which returns metadata only. Never switch
 * this to GetSecretValue; the web app must not be able to read secret values.
 */
export async function getSecretStatus(
  client: SecretsManagerClient,
  secretId: string
): Promise<{ configured: boolean }> {
  const response = await client.send(new DescribeSecretCommand({ SecretId: secretId }));
  const configured = Object.values(response.VersionIdsToStages ?? {}).some((stages) =>
    stages.includes("AWSCURRENT")
  );
  return { configured };
}
