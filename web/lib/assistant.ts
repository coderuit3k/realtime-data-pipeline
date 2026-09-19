export type AssistantMode = "crag" | "agent";

export type AssistantSource = {
  title: string;
  url: string;
  source: string;
  score?: number | null;
  grade?: string;
};

export type AssistantResult = {
  mode: AssistantMode;
  question: string;
  answer: string;
  grounded: boolean;
  sources: AssistantSource[];
  cragDetail?: { answerSource: string; discarded: Array<{ title: string; grade: string }> };
  agentDetail?: { toolCalls: unknown[] };
};

type RawCragPayload = {
  question: string;
  answer: string;
  grounded: boolean;
  answer_source: string;
  sources: AssistantSource[];
  discarded_low_relevance: Array<{ title: string; grade: string }>;
};

type RawAgentPayload = {
  question: string;
  answer: string;
  grounded: boolean;
  tool_calls: unknown[];
  sources: AssistantSource[];
};

export function normalizeAssistantResult(mode: AssistantMode, raw: unknown): AssistantResult {
  const base = raw as { question: string; answer: string; grounded: boolean; sources: AssistantSource[] };
  const shared = {
    mode,
    question: base.question,
    answer: base.answer,
    grounded: base.grounded,
    sources: base.sources,
  };
  if (mode === "crag") {
    const cragRaw = raw as RawCragPayload;
    return {
      ...shared,
      cragDetail: { answerSource: cragRaw.answer_source, discarded: cragRaw.discarded_low_relevance },
    };
  }
  const agentRaw = raw as RawAgentPayload;
  return { ...shared, agentDetail: { toolCalls: agentRaw.tool_calls } };
}
