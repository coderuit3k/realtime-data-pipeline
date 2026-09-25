import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase";
import { listMessagesForConversation, getSessionIdHeader, type MessageRow } from "@/lib/conversations";

type RouteContext = { params: Promise<{ id: string }> };

function toMessageJSON(row: MessageRow) {
  return {
    id: row.id,
    question: row.question,
    answer: row.answer,
    grounded: row.grounded,
    toolCalls: row.tool_calls,
    sources: row.sources,
    createdAt: row.created_at,
  };
}

export async function GET(request: NextRequest, { params }: RouteContext) {
  const sessionId = getSessionIdHeader(request.headers);
  if (!sessionId) {
    return NextResponse.json({ error: "Thiếu X-Session-Id." }, { status: 400 });
  }

  const { id } = await params;
  try {
    const rows = await listMessagesForConversation(getSupabaseClient(), sessionId, id);
    if (rows === null) {
      return NextResponse.json({ error: "Không tìm thấy cuộc trò chuyện." }, { status: 404 });
    }
    return NextResponse.json({ messages: rows.map(toMessageJSON) });
  } catch (error) {
    console.error("List messages failed", error);
    return NextResponse.json({ error: "Không tải được lịch sử tin nhắn." }, { status: 500 });
  }
}
