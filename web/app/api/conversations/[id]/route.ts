import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase";
import { renameConversation, deleteConversation, toConversationJSON, getSessionIdHeader, MAX_TITLE_LENGTH } from "@/lib/conversations";

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const sessionId = getSessionIdHeader(request.headers);
  if (!sessionId) {
    return NextResponse.json({ error: "Thiếu X-Session-Id." }, { status: 400 });
  }

  const body = await request.json().catch(() => null);
  const title = typeof body?.title === "string" ? body.title.trim() : "";
  if (!title) {
    return NextResponse.json({ error: "Thiếu tên cuộc trò chuyện." }, { status: 400 });
  }
  if (title.length > MAX_TITLE_LENGTH) {
    return NextResponse.json(
      { error: `Tên cuộc trò chuyện quá dài (tối đa ${MAX_TITLE_LENGTH} ký tự).` },
      { status: 400 }
    );
  }

  const { id } = await params;
  try {
    const row = await renameConversation(getSupabaseClient(), sessionId, id, title);
    if (!row) {
      return NextResponse.json({ error: "Không tìm thấy cuộc trò chuyện." }, { status: 404 });
    }
    return NextResponse.json(toConversationJSON(row));
  } catch (error) {
    console.error("Rename conversation failed", error);
    return NextResponse.json({ error: "Không đổi được tên cuộc trò chuyện." }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: RouteContext) {
  const sessionId = getSessionIdHeader(request.headers);
  if (!sessionId) {
    return NextResponse.json({ error: "Thiếu X-Session-Id." }, { status: 400 });
  }

  const { id } = await params;
  try {
    const deleted = await deleteConversation(getSupabaseClient(), sessionId, id);
    if (!deleted) {
      return NextResponse.json({ error: "Không tìm thấy cuộc trò chuyện." }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Delete conversation failed", error);
    return NextResponse.json({ error: "Không xóa được cuộc trò chuyện." }, { status: 500 });
  }
}
