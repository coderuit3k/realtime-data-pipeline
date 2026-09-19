import { describe, expect, it } from "vitest";
import { normalizeAssistantResult } from "./assistant";

describe("normalizeAssistantResult", () => {
  it("normalizes a rag_query (CRAG) payload", () => {
    const raw = {
      statusCode: 200,
      question: "Xu hướng AI agent tuần này?",
      answer: "HN thảo luận nhiều về tool-calling agent.",
      grounded: true,
      answer_source: "local_knowledge_base",
      sources: [{ title: "Building a tool-calling agent loop", url: "https://hn/1", source: "hackernews", score: 0.83, grade: "relevant" }],
      discarded_low_relevance: [{ title: "Unrelated story", grade: "irrelevant" }],
    };

    const result = normalizeAssistantResult("crag", raw);

    expect(result.mode).toBe("crag");
    expect(result.answer).toBe(raw.answer);
    expect(result.grounded).toBe(true);
    expect(result.sources).toEqual(raw.sources);
    expect(result.cragDetail).toEqual({
      answerSource: "local_knowledge_base",
      discarded: [{ title: "Unrelated story", grade: "irrelevant" }],
    });
    expect(result.agentDetail).toBeUndefined();
  });

  it("normalizes a rag_agent payload", () => {
    const raw = {
      statusCode: 200,
      question: "Xu hướng AI agent tuần này?",
      answer: "Agent tự tra cứu và trả lời.",
      grounded: true,
      tool_calls: [{ tool: "search_knowledge_base", input: { query: "AI agent" }, result_count: 4 }],
      sources: [{ title: "agent-loop-examples", url: "https://gh/1", source: "github" }],
    };

    const result = normalizeAssistantResult("agent", raw);

    expect(result.mode).toBe("agent");
    expect(result.sources).toEqual(raw.sources);
    expect(result.agentDetail).toEqual({ toolCalls: raw.tool_calls });
    expect(result.cragDetail).toBeUndefined();
  });
});
