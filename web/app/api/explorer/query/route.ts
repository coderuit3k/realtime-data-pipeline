import { NextResponse, type NextRequest } from "next/server";
import { getAthenaClient } from "@/lib/aws";
import { runAthenaQueryWithStats, parseAthenaRows } from "@/lib/athena";
import { validateReadOnlySelect } from "@/lib/sqlGuard";
import { checkRateLimit, getExplorerLimiter } from "@/lib/ratelimit";
import { clientIp } from "@/lib/clientIp";

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const sql = typeof body?.sql === "string" ? body.sql : "";

  const guard = validateReadOnlySelect(sql);
  if (!guard.ok) {
    return NextResponse.json({ error: guard.reason }, { status: 400 });
  }

  const rateLimit = await checkRateLimit(clientIp(request), getExplorerLimiter());
  if (!rateLimit.allowed) {
    return NextResponse.json({ error: "Đợi một chút rồi chạy tiếp." }, { status: 429 });
  }

  try {
    const { columns, rows, stats, hasMoreRows } = await runAthenaQueryWithStats(getAthenaClient(), sql, 100);
    const dataRows = parseAthenaRows(rows, (cols) => cols);

    return NextResponse.json({
      columns,
      rows: dataRows,
      scannedBytes: stats.dataScannedInBytes,
      elapsedMs: stats.engineExecutionTimeMs,
      hasMoreRows,
    });
  } catch (error) {
    console.error("Explorer query failed", error);
    const message = error instanceof Error ? error.message : "Không chạy được truy vấn.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
