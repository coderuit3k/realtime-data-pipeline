import { NextRequest, NextResponse } from "next/server";
import { InvokeCommand } from "@aws-sdk/client-lambda";
import { getLambdaClient, requiredEnv } from "@/lib/aws";
import { checkRateLimit } from "@/lib/ratelimit";
import { normalizeAssistantResult, buildContextualQuestion } from "@/lib/assistant";
import { clientIp } from "@/lib/clientIp";
import { getSupabaseClient } from "@/lib/supabase";
import { insertMessage, getSessionIdHeader, listMessagesForConversation } from "@/lib/conversations";

// rag_agent's Lambda timeout is 90s (infra/rag.tf) but 60s is Vercel's cap on
// non-Pro plans, so a slow answer can still be cut off here.
export const maxDuration = 60;

const MAX_QUESTION_LENGTH = 500;

/**
 * Asks rag_agent a question, optionally inside a conversation: prior turns are
 * sent as context and the new turn is saved. Validation and the per-IP rate
 * limit run before anything billable (Lambda/Bedrock) is invoked.
 */
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
    let priorMessages: { question: string; answer: string }[] = [];
    // Loading history doubles as the ownership check, which also guards the
    // insertMessage call below.
    if (conversationId) {
      const sessionId = getSessionIdHeader(request.headers);
      const history = sessionId
        ? await listMessagesForConversation(getSupabaseClient(), sessionId, conversationId)
        : null;
      if (history === null) {
        return NextResponse.json({ error: "Không tìm thấy cuộc trò chuyện." }, { status: 404 });
      }
      priorMessages = history;
    }

    const functionName = requiredEnv("RAG_AGENT_FUNCTION_NAME");
    const questionForLambda = buildContextualQuestion(question, priorMessages);
    const response = await getLambdaClient().send(
      new InvokeCommand({
        FunctionName: functionName,
        Payload: Buffer.from(JSON.stringify({ question: questionForLambda })),
      })
    );
    const payload = JSON.parse(Buffer.from(response.Payload ?? new Uint8Array()).toString("utf-8"));
    if (payload.statusCode !== 200) {
      return NextResponse.json({ error: payload.error ?? "Lambda trả lỗi." }, { status: 502 });
    }
    const result = normalizeAssistantResult(payload);
    // rag_agent echoes the context-augmented question; show and persist the
    // user's original text instead.
    result.question = question;

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
        // A failed save must not throw away an answer we already paid for.
        console.error("Persisting assistant turn failed", persistError);
      }
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error("Assistant API failed", error);
    return NextResponse.json({ error: "Không gọi được RAG Lambda, thử lại sau." }, { status: 500 });
  }
}
