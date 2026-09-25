import type { ChatMessage } from "@/lib/assistant";

export function ToolTraceHistory({ messages }: { messages: ChatMessage[] }) {
  if (messages.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-surface/75 backdrop-blur-md p-5 flex items-center justify-center">
        <span className="text-xs text-textMuted text-center">
          Chọn hoặc tạo một cuộc trò chuyện để xem tool trace.
        </span>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-surface/75 backdrop-blur-md p-5 flex flex-col gap-4 overflow-auto">
      <div className="flex items-center gap-2">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#8B5CF6" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
        </svg>
        <span className="text-xs font-semibold text-textPrimary">Tool trace (agent tự quyết định)</span>
      </div>
      {messages.map((m, turnIndex) => (
        <div key={m.id} className="flex flex-col gap-1.5 pb-3 border-b border-border last:border-b-0 last:pb-0">
          <span className="font-mono text-[10px] uppercase tracking-wide text-textMuted">
            Lượt {turnIndex + 1}: {m.question}
          </span>
          {m.toolCalls.length === 0 ? (
            <span className="font-mono text-xs text-textMuted">(không gọi tool nào)</span>
          ) : (
            m.toolCalls.map((call, i) => (
              <span key={i} className="font-mono text-xs text-textSecondary">
                {JSON.stringify(call)}
              </span>
            ))
          )}
        </div>
      ))}
    </div>
  );
}
