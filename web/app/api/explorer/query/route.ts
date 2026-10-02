import { NextResponse, type NextRequest } from "next/server";
import { getAthenaClient } from "@/lib/aws";
import { runAthenaQueryWithStats, parseAthenaRows } from "@/lib/athena";
import { validateReadOnlySelect } from "@/lib/sqlGuard";
import { checkRateLimit, getExplorerLimiter } from "@/lib/ratelimit";
import { clientIp } from "@/lib/clientIp";
import type { ExplorerQueryResult } from "@/lib/types";

export const maxDuration = 60;

/**
 * Runs user-supplied read-only SQL on Athena. The SQL guard runs before the
 * rate limiter so rejected input doesn't use up the caller's quota.
 */
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
    // 101 = header row + 100 data rows.
    const { columns, rows, stats, hasMoreRows } = await runAthenaQueryWithStats(getAthenaClient(), sql, 101);
    const dataRows = parseAthenaRows(rows, (cols) => cols);

    const result: ExplorerQueryResult = {
      columns,
      rows: dataRows,
      scannedBytes: stats.dataScannedInBytes,
      elapsedMs: stats.engineExecutionTimeMs,
      hasMoreRows,
    };
    return NextResponse.json(result);
  } catch (error) {
    console.error("Explorer query failed", error);
    // Athena's own errors (syntax, unknown column) help the user, but
    // permission errors leak ARNs/account ids, so replace those with a generic message.
    const raw = error instanceof Error ? error.message : "";
    const looksLikeAwsInternals = /arn:aws|not authorized|AccessDenied|\bUser: /i.test(raw);
    const message =
      !raw || looksLikeAwsInternals
        ? "Không chạy được truy vấn (không có quyền truy cập bảng này)."
        : raw;
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
