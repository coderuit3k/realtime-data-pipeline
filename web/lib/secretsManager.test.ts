import { describe, expect, it, vi } from "vitest";
import type { SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { getSecretStatus } from "./secretsManager";

function mockClient(versionIdsToStages: Record<string, string[]> | undefined): SecretsManagerClient {
  return { send: vi.fn().mockResolvedValue({ VersionIdsToStages: versionIdsToStages }) } as unknown as SecretsManagerClient;
}

describe("getSecretStatus", () => {
  it("returns configured: true when a version is staged AWSCURRENT", async () => {
    const client = mockClient({ v1: ["AWSCURRENT"] });
    const result = await getSecretStatus(client, "my-secret");
    expect(result).toEqual({ configured: true });
  });

  it("returns configured: false when VersionIdsToStages is undefined", async () => {
    const client = mockClient(undefined);
    const result = await getSecretStatus(client, "my-secret");
    expect(result).toEqual({ configured: false });
  });

  it("returns configured: false when VersionIdsToStages is empty", async () => {
    const client = mockClient({});
    const result = await getSecretStatus(client, "my-secret");
    expect(result).toEqual({ configured: false });
  });

  it("returns configured: false when versions exist but none staged AWSCURRENT", async () => {
    const client = mockClient({ v1: ["AWSPREVIOUS"] });
    const result = await getSecretStatus(client, "my-secret");
    expect(result).toEqual({ configured: false });
  });
});
