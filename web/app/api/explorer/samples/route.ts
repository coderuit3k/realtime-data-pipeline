import { NextResponse } from "next/server";
import { requiredEnv } from "@/lib/aws";
import { todayUtcParts } from "@/lib/athena";
import { buildSampleQueryGroups } from "@/lib/explorerQueries";

export async function GET() {
  try {
    const workgroup = requiredEnv("ATHENA_WORKGROUP");
    const database = requiredEnv("ATHENA_DATABASE");
    const groups = buildSampleQueryGroups(todayUtcParts());

    return NextResponse.json(
      { workgroup, database, groups },
      { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120" } }
    );
  } catch (error) {
    console.error("Explorer samples API failed", error);
    return NextResponse.json(
      { error: "Không tải được danh sách truy vấn mẫu, thử lại sau." },
      { status: 500 }
    );
  }
}
