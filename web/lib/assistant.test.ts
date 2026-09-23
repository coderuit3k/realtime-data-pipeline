import { describe, expect, it } from "vitest";
import { normalizeAssistantResult } from "./assistant";

describe("normalizeAssistantResult", () => {
  it("normalizes a rag_agent payload", () => {
    const raw = {
      statusCode: 200,
      question: "Xu hướng AI agent tuần này?",
      answer: "Agent tự tra cứu và trả lời.",
      grounded: true,
      tool_calls: [{ tool: "search_knowledge_base", input: { query: "AI agent" }, result_count: 4 }],
      sources: [{ title: "agent-loop-examples", url: "https://gh/1", source: "github" }],
    };

    const result = normalizeAssistantResult(raw);

    expect(result.question).toBe(raw.question);
    expect(result.answer).toBe(raw.answer);
    expect(result.grounded).toBe(true);
    expect(result.sources).toEqual(raw.sources);
    expect(result.toolCalls).toEqual(raw.tool_calls);
  });

  it("falls back to safe defaults when fields are missing or malformed", () => {
    const raw = {
      question: "Xu hướng AI agent tuần này?",
      answer: 123,
      // grounded, tool_calls, sources intentionally missing/malformed
    };

    const result = normalizeAssistantResult(raw);

    expect(result.sources).toEqual([]);
    expect(result.answer).toBe("");
    expect(result.toolCalls).toEqual([]);
  });
});
