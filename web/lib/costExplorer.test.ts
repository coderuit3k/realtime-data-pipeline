import { describe, expect, it, vi } from "vitest";
import type { CostExplorerClient } from "@aws-sdk/client-cost-explorer";
import { getMonthToDateCostUsd } from "./costExplorer";

function mockClient(resultsByTime: unknown): CostExplorerClient {
  return { send: vi.fn().mockResolvedValue({ ResultsByTime: resultsByTime }) } as unknown as CostExplorerClient;
}

describe("getMonthToDateCostUsd", () => {
  it("parses a real-shaped response into a number", async () => {
    const client = mockClient([{ Total: { UnblendedCost: { Amount: "12.3456789", Unit: "USD" } } }]);
    const result = await getMonthToDateCostUsd(client, new Date("2026-09-21T10:00:00Z"));
    expect(result).toBe(12.3456789);
  });

  it("returns 0 when ResultsByTime is empty", async () => {
    const client = mockClient([]);
    const result = await getMonthToDateCostUsd(client, new Date("2026-09-01T00:00:00Z"));
    expect(result).toBe(0);
  });

  it("returns 0 when ResultsByTime is missing", async () => {
    const client = mockClient(undefined);
    const result = await getMonthToDateCostUsd(client, new Date("2026-09-01T00:00:00Z"));
    expect(result).toBe(0);
  });

  it("queries a MONTHLY, UnblendedCost range with an exclusive tomorrow End (UTC)", async () => {
    const client = mockClient([{ Total: { UnblendedCost: { Amount: "5", Unit: "USD" } } }]);
    await getMonthToDateCostUsd(client, new Date("2026-09-21T23:59:00Z"));
    const sendMock = client.send as unknown as { mock: { calls: unknown[][] } };
    const command = sendMock.mock.calls[0][0] as { input: Record<string, unknown> };
    expect(command.input).toEqual({
      TimePeriod: { Start: "2026-09-01", End: "2026-09-22" },
      Granularity: "MONTHLY",
      Metrics: ["UnblendedCost"],
    });
  });
});
