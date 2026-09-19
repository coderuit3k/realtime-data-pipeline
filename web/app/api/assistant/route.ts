import { NextRequest, NextResponse } from "next/server";
import { InvokeCommand } from "@aws-sdk/client-lambda";
import { getLambdaClient, requiredEnv } from "@/lib/aws";
import { checkRateLimit } from "@/lib/ratelimit";
import { normalizeAssistantResult, type AssistantMode } from "@/lib/assistant";

// rag_agent's own Lambda timeout is 90s (see infra/rag.tf); 60 is Vercel's ceiling
// on non-Pro plans, so this may still not be enough headroom on a Hobby plan.
export const maxDuration = 60;

const MAX_QUESTION_LENGTH = 500;

function clientIp(request: NextRequest): string {
  const h = request.headers;
  const xff = h.get("x-forwarded-for")?.split(",").map((s) => s.trim()).filter(Boolean) ?? [];
  return (
    h.get("x-vercel-forwarded-for")?.trim() ||
    h.get("x-real-ip")?.trim() ||
    xff[xff.length - 1] ||
    "unknown"
  );
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const question = typeof body?.question === "string" ? body.question.trim() : "";
  const mode = body?.mode as AssistantMode;

  if (!question || (mode !== "crag" && mode !== "agent")) {
    return NextResponse.json({ error: "Thiếu 'question' hoặc 'mode' không hợp lệ." }, { status: 400 });
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
    const functionName = requiredEnv(
      mode === "crag" ? "RAG_QUERY_FUNCTION_NAME" : "RAG_AGENT_FUNCTION_NAME"
    );
    const response = await getLambdaClient().send(
      new InvokeCommand({ FunctionName: functionName, Payload: Buffer.from(JSON.stringify({ question })) })
    );
    const payload = JSON.parse(Buffer.from(response.Payload ?? new Uint8Array()).toString("utf-8"));
    if (payload.statusCode !== 200) {
      return NextResponse.json({ error: payload.error ?? "Lambda trả lỗi." }, { status: 502 });
    }
    return NextResponse.json(normalizeAssistantResult(mode, payload));
  } catch (error) {
    console.error("Assistant API failed", error);
    return NextResponse.json({ error: "Không gọi được RAG Lambda, thử lại sau." }, { status: 500 });
  }
}
