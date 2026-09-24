import type { AssistantResult } from "@/lib/assistant";

export function ChatThread({
  question,
  result,
  loading,
}: {
  question: string | null;
  result: AssistantResult | null;
  loading: boolean;
}) {
  if (!question) {
    return <p className="text-sm text-textMuted">Đặt câu hỏi về dữ liệu đã ingest để bắt đầu.</p>;
  }
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-end gap-2 justify-end">
        <div className="max-w-[70%] rounded-lg rounded-br-sm bg-[#1B2540] px-4 py-3">
          <span className="text-sm text-textPrimary">{question}</span>
        </div>
        <span className="w-7 h-7 rounded-full bg-bg border border-border flex items-center justify-center text-textSecondary flex-shrink-0">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="8" r="4" />
            <path d="M4 20c0-4 4-6 8-6s8 2 8 6" />
          </svg>
        </span>
      </div>
      {loading && <span className="text-xs text-textMuted">Đang xử lý…</span>}
      {result && (
        <div className="flex items-end gap-2 justify-start">
          <span className="w-7 h-7 rounded-full bg-bg border border-secondary/40 flex items-center justify-center text-secondaryBright flex-shrink-0">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
            </svg>
          </span>
          <div className="max-w-[80%] rounded-lg rounded-bl-sm border border-border bg-surface/75 backdrop-blur-md px-4 py-3 flex flex-col gap-3">
            <span className="text-sm leading-relaxed text-textSecondary">{result.answer}</span>
            <div className="flex flex-wrap gap-2">
              {result.sources.map((s, i) => (
                <span key={i} className="font-mono text-[10.5px] text-accent bg-accent/10 rounded px-2 py-1">
                  {s.source} · {s.title}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
