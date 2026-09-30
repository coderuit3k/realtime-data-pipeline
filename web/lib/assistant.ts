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

// Bounds how much prior conversation gets re-sent as context on every
// follow-up turn -- otherwise a long-running conversation would make each
// later question progressively more expensive (and eventually blow past
// rag_agent's own MAX_QUESTION_LENGTH-adjacent token budget) for no benefit,
// since only the last few turns are usually relevant to a follow-up.
const MAX_CONTEXT_TURNS = 4;
const MAX_CONTEXT_ANSWER_LENGTH = 400;

export type PriorTurn = { question: string; answer: string };

/**
 * Prefixes `question` with the last few turns of `priorMessages` so a
 * follow-up like "why those two days?" carries enough context for
 * rag_agent (which is stateless -- see rag/agent.py lambda_handler) to
 * resolve "those two days" itself. Returns `question` unchanged when there
 * is no prior history, so a fresh conversation's first turn -- and the
 * DynamoDB answer cache's lookup key for it -- is unaffected.
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
