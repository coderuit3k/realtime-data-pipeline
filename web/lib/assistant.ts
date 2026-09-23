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

type RawAgentPayload = {
  question: string;
  answer: string;
  grounded: boolean;
  tool_calls: unknown[];
  sources: AssistantSource[];
};

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
