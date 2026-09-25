import { NextRequest, NextResponse } from "next/server";
import { InvokeCommand } from "@aws-sdk/client-lambda";
import { getLambdaClient, requiredEnv } from "@/lib/aws";
import { checkRateLimit } from "@/lib/ratelimit";
import { normalizeAssistantResult } from "@/lib/assistant";
import { clientIp } from "@/lib/clientIp";
import { getSupabaseClient } from "@/lib/supabase";
import { conversationBelongsToSession, insertMessage, getSessionIdHeader } from "@/lib/conversations";

// rag_agent's own Lambda timeout is 90s (see infra/rag.tf); 60 is Vercel's ceiling
// on non-Pro plans, so this may still not be enough headroom on a Hobby plan.
export const maxDuration = 60;

const MAX_QUESTION_LENGTH = 500;

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const question = typeof body?.question === "string" ? body.question.trim() : "";
  const conversationId = typeof body?.conversationId === "string" ? body.conversationId : null;

  if (!question) {
    return NextResponse.json({ error: "Thiếu 'question'." }, { status: 400 });
  }

  if (question.length > MAX_QUESTION_LENGTH) {
    return NextResponse.json(
      { error: `Câu hỏi quá dài (tối đa ${MAX_QUESTION_LENGTH} ký tự).` },
      { status: 400 }
    );
  }

  const rateLimit = await checkRateLimit(clientIp(request));
  if (!rateLimit.allowed) {
    return NextResponse.json({ error: "Đợi một chút rồi hỏi tiếp." }, { status: 429 });
  }

  try {
    if (conversationId) {
      const sessionId = getSessionIdHeader(request.headers);
      const belongs = sessionId && (await conversationBelongsToSession(getSupabaseClient(), sessionId, conversationId));
      if (!belongs) {
        return NextResponse.json({ error: "Không tìm thấy cuộc trò chuyện." }, { status: 404 });
      }
    }

    const functionName = requiredEnv("RAG_AGENT_FUNCTION_NAME");
    const response = await getLambdaClient().send(
      new InvokeCommand({ FunctionName: functionName, Payload: Buffer.from(JSON.stringify({ question })) })
    );
    const payload = JSON.parse(Buffer.from(response.Payload ?? new Uint8Array()).toString("utf-8"));
    if (payload.statusCode !== 200) {
      return NextResponse.json({ error: payload.error ?? "Lambda trả lỗi." }, { status: 502 });
    }
    const result = normalizeAssistantResult(payload);

    if (conversationId) {
      try {
        await insertMessage(getSupabaseClient(), conversationId, {
          question: result.question,
          answer: result.answer,
          grounded: result.grounded,
          toolCalls: result.toolCalls,
          sources: result.sources,
        });
      } catch (persistError) {
        // A persistence hiccup must never hide a real, already-obtained
        // answer -- log it and still return the real result to the user.
        console.error("Persisting assistant turn failed", persistError);
      }
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error("Assistant API failed", error);
    return NextResponse.json({ error: "Không gọi được RAG Lambda, thử lại sau." }, { status: 500 });
  }
}
