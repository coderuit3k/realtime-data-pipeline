import { NextRequest, NextResponse } from "next/server";
import { InvokeCommand } from "@aws-sdk/client-lambda";
import { getLambdaClient, requiredEnv } from "@/lib/aws";
import { checkRateLimit } from "@/lib/ratelimit";
import { normalizeAssistantResult } from "@/lib/assistant";
import { clientIp } from "@/lib/clientIp";

// rag_agent's own Lambda timeout is 90s (see infra/rag.tf); 60 is Vercel's ceiling
// on non-Pro plans, so this may still not be enough headroom on a Hobby plan.
export const maxDuration = 60;

const MAX_QUESTION_LENGTH = 500;

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const question = typeof body?.question === "string" ? body.question.trim() : "";

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
    const functionName = requiredEnv("RAG_AGENT_FUNCTION_NAME");
    const response = await getLambdaClient().send(
      new InvokeCommand({ FunctionName: functionName, Payload: Buffer.from(JSON.stringify({ question })) })
    );
    const payload = JSON.parse(Buffer.from(response.Payload ?? new Uint8Array()).toString("utf-8"));
    if (payload.statusCode !== 200) {
      return NextResponse.json({ error: payload.error ?? "Lambda trả lỗi." }, { status: 502 });
    }
    return NextResponse.json(normalizeAssistantResult(payload));
  } catch (error) {
    console.error("Assistant API failed", error);
    return NextResponse.json({ error: "Không gọi được RAG Lambda, thử lại sau." }, { status: 500 });
  }
}
