import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase";
import { listConversations, createConversation, toConversationJSON, getSessionIdHeader } from "@/lib/conversations";
import { checkRateLimit, getConversationLimiter } from "@/lib/ratelimit";

export async function GET(request: NextRequest) {
  const sessionId = getSessionIdHeader(request.headers);
  if (!sessionId) {
    return NextResponse.json({ error: "Thiếu X-Session-Id." }, { status: 400 });
  }

  try {
    const rows = await listConversations(getSupabaseClient(), sessionId);
    return NextResponse.json({ conversations: rows.map(toConversationJSON) });
  } catch (error) {
    console.error("List conversations failed", error);
    return NextResponse.json({ error: "Không tải được danh sách cuộc trò chuyện." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const sessionId = getSessionIdHeader(request.headers);
  if (!sessionId) {
    return NextResponse.json({ error: "Thiếu X-Session-Id." }, { status: 400 });
  }

  const rateLimit = await checkRateLimit(sessionId, getConversationLimiter());
  if (!rateLimit.allowed) {
    return NextResponse.json({ error: "Đợi một chút rồi tạo cuộc trò chuyện mới." }, { status: 429 });
  }

  try {
    const row = await createConversation(getSupabaseClient(), sessionId);
    return NextResponse.json(toConversationJSON(row));
  } catch (error) {
    console.error("Create conversation failed", error);
    return NextResponse.json({ error: "Không tạo được cuộc trò chuyện." }, { status: 500 });
  }
}
