import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getAthenaClient, requiredEnv } from "@/lib/aws";
import { runAthenaQueryWithStats, parseAthenaRows, partitionWhere, todayUtcParts } from "@/lib/athena";
import { buildCatalogWorkbook, type ExportSheet } from "@/lib/excelExport";
import { getR2Client, uploadAndPresign } from "@/lib/r2";
import { checkRateLimit, getExportLimiter } from "@/lib/ratelimit";
import { clientIp } from "@/lib/clientIp";

export const maxDuration = 60;

const EXPORT_TABLES = [
  "hackernews_stories",
  "news_articles",
  "github_repos",
  "weather_observations",
  "crypto_prices",
];

const XLSX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const requestedTable = typeof body?.table === "string" ? body.table : null;
  if (requestedTable !== null && !EXPORT_TABLES.includes(requestedTable)) {
    return NextResponse.json({ error: "Bảng không hợp lệ." }, { status: 400 });
  }
  const tables = requestedTable ? [requestedTable] : EXPORT_TABLES;

  const rateLimit = await checkRateLimit(clientIp(request), getExportLimiter());
  if (!rateLimit.allowed) {
    return NextResponse.json({ error: "Đợi một chút rồi thử xuất lại." }, { status: 429 });
  }

  try {
    const athenaClient = getAthenaClient();
    // Same today-only partition filter as buildSourceVolumeQuery/buildRecentActivityQuery
    // (already proven fast in production for Dashboard/Insights) -- without it, ORDER BY
    // ingested_at DESC forces a full unpartitioned table scan, which timed out in
    // production once the raw ingestion history grew past ~1 week (real incident,
    // 2026-09-25: "Athena query timed out waiting for SUCCEEDED state"). 999 data rows
    // + 1 header row = exactly maxResults: 1000, Athena's per-call ceiling.
    const where = partitionWhere(todayUtcParts());
    const sheets: ExportSheet[] = await Promise.all(
      tables.map(async (table) => {
        const { columns, rows } = await runAthenaQueryWithStats(
          athenaClient,
          `SELECT * FROM ${table} ${where} ORDER BY ingested_at DESC LIMIT 999`,
          1000
        );
        return { name: table, columns, rows: parseAthenaRows(rows, (cols) => cols) };
      })
    );

    const buffer = await buildCatalogWorkbook(sheets);
    const suffix = requestedTable ? `${requestedTable}-` : "";
    const key = `exports/catalog-${suffix}${new Date().toISOString().replace(/[:.]/g, "-")}.xlsx`;
    const url = await uploadAndPresign(
      getR2Client(),
      requiredEnv("R2_EXCEL_BUCKET_NAME"),
      key,
      buffer,
      XLSX_CONTENT_TYPE
    );

    return NextResponse.json({ url });
  } catch (error) {
    console.error("Catalog export failed", error);
    return NextResponse.json({ error: "Không xuất được file Excel, thử lại sau." }, { status: 500 });
  }
}
