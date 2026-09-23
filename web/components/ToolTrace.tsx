import type { AssistantResult } from "@/lib/assistant";

export function ToolTrace({ result }: { result: AssistantResult | null }) {
  if (!result) return null;

  if (result.cragDetail) {
    return (
      <div className="rounded-lg border border-border bg-surface p-5 flex flex-col gap-3">
        <span className="text-xs font-semibold text-textPrimary">Fixed pipeline steps</span>
        <span className="font-mono text-xs text-textSecondary">1. Embed câu hỏi (Titan Embed)</span>
        <span className="font-mono text-xs text-textSecondary">
          2. Grade (Claude Haiku) → {result.grounded ? "relevant" : "irrelevant/ambiguous"}
        </span>
        <span className="font-mono text-xs text-textSecondary">
          3. Trả lời từ {result.cragDetail.answerSource}
        </span>
      </div>
    );
  }

  if (result.agentDetail) {
    return (
      <div className="rounded-lg border border-border bg-surface p-5 flex flex-col gap-3">
        <span className="text-xs font-semibold text-textPrimary">Tool trace (agent tự quyết định)</span>
        {result.agentDetail.toolCalls.map((call, i) => (
          <span key={i} className="font-mono text-xs text-textSecondary">
            {JSON.stringify(call)}
          </span>
        ))}
      </div>
    );
  }

  return null;
}
