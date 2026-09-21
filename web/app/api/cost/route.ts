import { NextResponse } from "next/server";
import { getCostExplorerClient } from "@/lib/aws";
import { getMonthToDateCostUsd } from "@/lib/costExplorer";
import type { CostResponse } from "@/lib/types";

export const maxDuration = 60;

export async function GET() {
  try {
    const monthToDateCostUsd = await getMonthToDateCostUsd(getCostExplorerClient());

    const response: CostResponse = { monthToDateCostUsd };

    // 24h cache, decoupled from Dashboard/Ops's own ~60s-fresh data --
    // Cost Explorer's underlying data only refreshes ~every 8h anyway,
    // and each real query costs $0.01.
    return NextResponse.json(response, {
      headers: { "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=172800" },
    });
  } catch (error) {
    console.error("Cost API failed", error);
    return NextResponse.json({ error: "Không tải được chi phí, thử lại sau." }, { status: 500 });
  }
}
