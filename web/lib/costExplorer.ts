import { GetCostAndUsageCommand, type CostExplorerClient } from "@aws-sdk/client-cost-explorer";

function monthToDateRange(now: Date): { Start: string; End: string } {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const day = now.getUTCDate();
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return {
    Start: fmt(new Date(Date.UTC(year, month, 1))),
    // End is exclusive (real AWS SDK doc comment) -- tomorrow, UTC,
    // includes today's data.
    End: fmt(new Date(Date.UTC(year, month, day + 1))),
  };
}

// Real month-to-date spend via AWS Cost Explorer's GetCostAndUsage.
// UnblendedCost is the standard "what this actually costs" metric --
// this project has no reserved capacity, so it doesn't diverge from
// AmortizedCost in practice. Returns 0 (not a throw) when
// ResultsByTime is empty -- a brand-new month's first query can
// plausibly return no results yet.
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
