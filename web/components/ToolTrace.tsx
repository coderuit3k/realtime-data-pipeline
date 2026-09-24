import type { AssistantResult } from "@/lib/assistant";

export function ToolTrace({ result }: { result: AssistantResult | null }) {
  if (!result) return null;

  return (
    <div className="rounded-lg border border-border bg-surface/75 backdrop-blur-md p-5 flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#8B5CF6" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
        </svg>
        <span className="text-xs font-semibold text-textPrimary">Tool trace (agent tự quyết định)</span>
      </div>
      {result.toolCalls.map((call, i) => (
        <span key={i} className="font-mono text-xs text-textSecondary">
          {JSON.stringify(call)}
        </span>
      ))}
    </div>
  );
}
