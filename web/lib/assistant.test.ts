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

  it("falls back to safe defaults when fields are missing or malformed", () => {
    const raw = {
      question: "Xu hướng AI agent tuần này?",
      answer_source: "local_knowledge_base",
      // sources, answer, discarded_low_relevance all missing/malformed on purpose
      answer: 123,
      discarded_low_relevance: "not-an-array",
    };

    const result = normalizeAssistantResult("crag", raw);

    expect(result.sources).toEqual([]);
    expect(result.answer).toBe("");
    expect(result.cragDetail).toEqual({
      answerSource: "local_knowledge_base",
      discarded: [],
    });
  });

  it("falls back to an empty toolCalls array when tool_calls is missing", () => {
    const raw = {
      question: "Xu hướng AI agent tuần này?",
      answer: "Agent tự tra cứu và trả lời.",
      grounded: true,
      // tool_calls and sources intentionally missing
    };

    const result = normalizeAssistantResult("agent", raw);

    expect(result.sources).toEqual([]);
    expect(result.agentDetail).toEqual({ toolCalls: [] });
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
