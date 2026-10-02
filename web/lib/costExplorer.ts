import { GetCostAndUsageCommand, type CostExplorerClient } from "@aws-sdk/client-cost-explorer";

function monthToDateRange(now: Date): { Start: string; End: string } {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const day = now.getUTCDate();
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return {
    Start: fmt(new Date(Date.UTC(year, month, 1))),
    // End is exclusive, so tomorrow (UTC) is needed to include today.
    End: fmt(new Date(Date.UTC(year, month, day + 1))),
  };
}

/**
 * Month-to-date UnblendedCost in USD (no reserved capacity here, so it equals
 * AmortizedCost). Returns 0 when Cost Explorer has no data yet, e.g. early on
 * the 1st. Each call is billed ($0.01), so callers must cache the result.
 */
export async function getMonthToDateCostUsd(client: CostExplorerClient, now: Date = new Date()): Promise<number> {
  const response = await client.send(
    new GetCostAndUsageCommand({
      TimePeriod: monthToDateRange(now),
      Granularity: "MONTHLY",
      Metrics: ["UnblendedCost"],
    })
  );
  const amount = response.ResultsByTime?.[0]?.Total?.UnblendedCost?.Amount;
  return amount ? Number(amount) : 0;
}
