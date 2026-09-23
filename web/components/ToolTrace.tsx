import type { AssistantResult } from "@/lib/assistant";

export function ToolTrace({ result }: { result: AssistantResult | null }) {
  if (!result) return null;

  return (
    <div className="rounded-lg border border-border bg-surface p-5 flex flex-col gap-3">
      <span className="text-xs font-semibold text-textPrimary">Tool trace (agent tự quyết định)</span>
      {result.toolCalls.map((call, i) => (
        <span key={i} className="font-mono text-xs text-textSecondary">
          {JSON.stringify(call)}
        </span>
      ))}
    </div>
  );
}
