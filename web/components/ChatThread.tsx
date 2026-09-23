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
      <div className="flex justify-end">
        <div className="max-w-[70%] rounded-lg rounded-br-sm bg-[#1B2540] px-4 py-3">
          <span className="text-sm text-textPrimary">{question}</span>
        </div>
      </div>
      {loading && <span className="text-xs text-textMuted">Đang xử lý…</span>}
      {result && (
        <div className="flex justify-start">
          <div className="max-w-[80%] rounded-lg rounded-bl-sm border border-border bg-[#0F1728] px-4 py-3 flex flex-col gap-3">
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
