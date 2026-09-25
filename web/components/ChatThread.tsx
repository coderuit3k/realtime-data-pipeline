import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import type { AssistantResult, AssistantSource, ChatMessage } from "@/lib/assistant";

// The agent's real answer text often contains markdown (bold, bullet/
// numbered lists, links) -- render it properly instead of showing raw
// "**"/"-" syntax to the user. These overrides just restyle the default
// elements to match this page's existing dark theme; they don't change
// what content renders.
const answerMarkdownComponents: Components = {
  p: ({ children }) => <p className="text-sm leading-relaxed text-textSecondary">{children}</p>,
  strong: ({ children }) => <strong className="font-semibold text-textPrimary">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  ul: ({ children }) => <ul className="list-disc pl-5 flex flex-col gap-1">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal pl-5 flex flex-col gap-1">{children}</ol>,
  li: ({ children }) => <li className="text-sm leading-relaxed text-textSecondary">{children}</li>,
  a: ({ children, href }) => (
    <a href={href} target="_blank" rel="noreferrer" className="text-accent underline decoration-accent/40 hover:text-accentBright">
      {children}
    </a>
  ),
  code: ({ children }) => <code className="font-mono text-[12px] bg-bg rounded px-1 py-0.5 text-accent">{children}</code>,
};

function QuestionBubble({ question }: { question: string }) {
  return (
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
  );
}

function AnswerBubble({ answer, sources }: { answer: string; sources: AssistantSource[] }) {
  return (
    <div className="flex items-end gap-2 justify-start">
      <span className="w-7 h-7 rounded-full bg-bg border border-secondary/40 flex items-center justify-center text-secondaryBright flex-shrink-0">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
        </svg>
      </span>
      <div className="max-w-[80%] rounded-lg rounded-bl-sm border border-border bg-surface/75 backdrop-blur-md px-4 py-3 flex flex-col gap-3">
        <div className="flex flex-col gap-2">
          <ReactMarkdown components={answerMarkdownComponents}>{answer}</ReactMarkdown>
        </div>
        <div className="flex flex-wrap gap-2">
          {sources.map((s, i) => (
            <span key={i} className="font-mono text-[10.5px] text-accent bg-accent/10 rounded px-2 py-1">
              {s.source} · {s.title}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

export function ChatThread({
  messages,
  pendingQuestion,
  pendingResult,
  loading,
}: {
  messages: ChatMessage[];
  pendingQuestion: string | null;
  pendingResult: AssistantResult | null;
  loading: boolean;
}) {
  if (messages.length === 0 && !pendingQuestion) {
    return <p className="text-sm text-textMuted">Đặt câu hỏi về dữ liệu đã ingest để bắt đầu.</p>;
  }
  return (
    <div className="flex flex-col gap-4">
      {messages.map((m) => (
        <div key={m.id} className="flex flex-col gap-4">
          <QuestionBubble question={m.question} />
          <AnswerBubble answer={m.answer} sources={m.sources} />
        </div>
      ))}
      {pendingQuestion && (
        <div className="flex flex-col gap-4">
          <QuestionBubble question={pendingQuestion} />
          {loading && <span className="text-xs text-textMuted">Đang xử lý…</span>}
          {pendingResult && <AnswerBubble answer={pendingResult.answer} sources={pendingResult.sources} />}
        </div>
      )}
    </div>
  );
}
