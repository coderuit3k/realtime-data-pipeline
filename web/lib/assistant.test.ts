import { describe, expect, it } from "vitest";
import { normalizeAssistantResult, buildContextualQuestion } from "./assistant";

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

describe("buildContextualQuestion", () => {
  it("returns the question unchanged when there is no prior history", () => {
    expect(buildContextualQuestion("Giá Bitcoin hiện tại?", [])).toBe("Giá Bitcoin hiện tại?");
  });

  it("prefixes prior turns as context ahead of the new question", () => {
    const result = buildContextualQuestion("Vậy tại sao?", [
      { question: "Ngày nào nhiều repo nhất?", answer: "23/09 và 24/09." },
    ]);

    expect(result).toContain("Ngày nào nhiều repo nhất?");
    expect(result).toContain("23/09 và 24/09.");
    expect(result).toContain("Vậy tại sao?");
    expect(result.indexOf("23/09 và 24/09.")).toBeLessThan(result.indexOf("Vậy tại sao?"));
  });

  it("keeps only the most recent turns, dropping older ones", () => {
    const priorMessages = Array.from({ length: 6 }, (_, i) => ({
      question: `Câu hỏi ${i + 1}`,
      answer: `Trả lời ${i + 1}`,
    }));

    const result = buildContextualQuestion("Câu hỏi mới", priorMessages);

    expect(result).not.toContain("Câu hỏi 1\n");
    expect(result).toContain("Câu hỏi 6");
  });

  it("truncates a very long prior answer instead of sending it in full", () => {
    const longAnswer = "a".repeat(1000);
    const result = buildContextualQuestion("Câu hỏi mới", [{ question: "Q", answer: longAnswer }]);

    expect(result.length).toBeLessThan(longAnswer.length + 200);
  });
});
