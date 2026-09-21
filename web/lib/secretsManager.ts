import { DescribeSecretCommand, type SecretsManagerClient } from "@aws-sdk/client-secrets-manager";

// DescribeSecretCommand never returns the secret's actual value -- only
// metadata. VersionIdsToStages maps each version id to its staging
// labels; a version staged AWSCURRENT is the real, safe, read-only
// signal that a value has been set. GetSecretValue is never called
// anywhere in this app.
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
