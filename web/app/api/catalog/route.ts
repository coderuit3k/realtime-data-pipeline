import { NextResponse } from "next/server";
import { getGlueClient, requiredEnv } from "@/lib/aws";
import { listCuratedTables } from "@/lib/glue";
import { CATALOG_META } from "@/lib/catalogMeta";
import type { CatalogTable } from "@/lib/types";

export const maxDuration = 60;

/**
 * Glue tables merged with the hand-maintained CATALOG_META. Schemas change only
 * on deploy, so responses are CDN-cached for 5 minutes.
 */
export async function GET() {
  try {
    const database = requiredEnv("ATHENA_DATABASE");
    const alarmPrefix = requiredEnv("ALARM_NAME_PREFIX");
    const bareTables = await listCuratedTables(getGlueClient(), database);

    const tables: CatalogTable[] = bareTables.map((table) => {
      const meta = CATALOG_META[table.name];
      return {
        name: table.name,
        location: table.location,
        columns: table.columns.map((col) => {
          // Glue's column comment (meaning) and CATALOG_META's note (an
          // operational caveat) are complementary, so show both when present.
          const metaNote = meta?.columnNotes?.[col.name];
          const note = metaNote && col.note ? `${col.note} — ${metaNote}` : metaNote ?? col.note;
          return { ...col, note };
        }),
        ragIndexed: meta?.ragIndexed ?? false,
        sourceApi: meta?.sourceApi ?? "",
        // ALARM_NAME_PREFIX doubles as the Lambda function-name prefix.
        ingestionLambda: meta ? `${alarmPrefix}-${meta.ingestionLambda}` : "",
        cadence: meta?.cadence ?? "",
      };
    });

    return NextResponse.json(tables, {
      headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" },
    });
  } catch (error) {
    console.error("Catalog API failed", error);
    return NextResponse.json(
      { error: "Không tải được Data Catalog, thử lại sau." },
      { status: 500 }
    );
  }
}
