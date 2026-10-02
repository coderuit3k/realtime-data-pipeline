export type AssistantSource = {
  title: string;
  url: string;
  source: string;
};

export type AssistantResult = {
  question: string;
  answer: string;
  grounded: boolean;
  sources: AssistantSource[];
  toolCalls: unknown[];
};

export type ChatMessage = {
  id: string;
  question: string;
  answer: string;
  sources: AssistantSource[];
  toolCalls: unknown[];
};

type RawAgentPayload = {
  question: string;
  answer: string;
  grounded: boolean;
  tool_calls: unknown[];
  sources: AssistantSource[];
};

// Caps the history re-sent on each follow-up so long conversations don't grow
// every request's token cost; only the last few turns matter for a follow-up.
const MAX_CONTEXT_TURNS = 4;
const MAX_CONTEXT_ANSWER_LENGTH = 400;

export type PriorTurn = { question: string; answer: string };

/**
 * Prefixes the question with recent turns, because rag_agent is stateless and
 * cannot otherwise resolve follow-ups like "why those two days?".
 * With no history the question is returned unchanged, so first turns keep
 * hitting rag_agent's DynamoDB answer cache under the same key.
 */
export function buildContextualQuestion(question: string, priorMessages: PriorTurn[]): string {
  if (priorMessages.length === 0) return question;

  const recent = priorMessages.slice(-MAX_CONTEXT_TURNS);
  const context = recent
    .map((m, i) => `[${i + 1}] Hỏi: ${m.question}\n    Đáp: ${m.answer.slice(0, MAX_CONTEXT_ANSWER_LENGTH)}`)
    .join("\n");

  return (
    "Các câu hỏi/trả lời trước đó trong cùng cuộc hội thoại này (dùng làm ngữ cảnh " +
    `nếu câu hỏi mới có liên quan, bỏ qua nếu không liên quan):\n${context}\n\n` +
    `Câu hỏi hiện tại, trả lời đúng câu này: ${question}`
  );
}

/** Maps rag_agent's snake_case Lambda payload to the camelCase API shape, defaulting missing arrays. */
export function normalizeAssistantResult(raw: unknown): AssistantResult {
  const payload = raw as RawAgentPayload;
  return {
    question: payload.question,
    answer: typeof payload.answer === "string" ? payload.answer : "",
    grounded: payload.grounded,
    sources: Array.isArray(payload.sources) ? payload.sources : [],
    toolCalls: Array.isArray(payload.tool_calls) ? payload.tool_calls : [],
  };
}
