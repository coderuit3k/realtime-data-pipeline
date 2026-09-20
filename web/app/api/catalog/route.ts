import { NextResponse } from "next/server";
import { getGlueClient, requiredEnv } from "@/lib/aws";
import { listCuratedTables } from "@/lib/glue";
import { CATALOG_META } from "@/lib/catalogMeta";
import type { CatalogTable } from "@/lib/types";

export const maxDuration = 60;

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
        columns: table.columns.map((col) => ({
          ...col,
          note: meta?.columnNotes?.[col.name],
        })),
        ragIndexed: meta?.ragIndexed ?? false,
        sourceApi: meta?.sourceApi ?? "",
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
