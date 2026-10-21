import type { ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";
import type { AssistantResult, AssistantSource, ChatMessage } from "@/lib/assistant";

// Agent answers are markdown (lists, bold, links, GFM tables). These
// overrides only restyle the default elements for the dark theme; they do
// not change what renders. Table cells don't wrap, so tables get a
// horizontal scroll wrapper instead of overflowing the bubble.
const answerMarkdownComponents: Components = {
  p: ({ children }) => <p className="max-w-[75ch] text-sm leading-relaxed text-textSecondary">{children}</p>,
  strong: ({ children }) => <strong className="font-semibold text-textPrimary">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  ul: ({ children }) => <ul className="max-w-[75ch] list-disc pl-5 flex flex-col gap-1">{children}</ul>,
  ol: ({ children }) => <ol className="max-w-[75ch] list-decimal pl-5 flex flex-col gap-1">{children}</ol>,
  li: ({ children }) => <li className="text-sm leading-relaxed text-textSecondary">{children}</li>,
  a: ({ children, href }) => (
    <a href={href} target="_blank" rel="noreferrer" className="text-accent underline decoration-accent/40 hover:text-accentBright">
      {children}
    </a>
  ),
  code: ({ children }) => <code className="font-mono text-[12.5px] bg-bg rounded px-1 py-0.5 text-accent">{children}</code>,
  table: ({ children }) => (
    <div className="overflow-x-auto rounded border border-border">
      <table className="w-full text-sm border-collapse">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-bg">{children}</thead>,
  tbody: ({ children }) => <tbody>{children}</tbody>,
  tr: ({ children }) => <tr className="border-b border-border last:border-b-0">{children}</tr>,
  th: ({ children }) => (
    <th className="px-3 py-2 text-left font-semibold text-textPrimary whitespace-nowrap">{children}</th>
  ),
  td: ({ children }) => (
    <td className="px-3 py-2 text-textSecondary whitespace-nowrap">{children}</td>
  ),
};

// rag_agent computes `grounded` as "at least one source with a URL", so
// answers built purely from the pipeline's own structured tools (Athena
// aggregates, crypto prices, weather) come back grounded=false even though
// they rest on exact data. The badge therefore distinguishes three cases
// instead of stamping those answers as ungrounded.
const PIPELINE_DATA_TOOLS = new Set(["query_athena", "get_crypto_prices", "get_weather"]);

type GroundingKind = "sourced" | "pipeline" | "none";

function groundingKind(grounded: boolean, toolCalls: unknown[]): GroundingKind {
  if (grounded) return "sourced";
  const usedPipelineData = toolCalls.some((call) => {
    if (typeof call !== "object" || call === null) return false;
    const tool = (call as { tool?: unknown }).tool;
    return typeof tool === "string" && PIPELINE_DATA_TOOLS.has(tool);
  });
  return usedPipelineData ? "pipeline" : "none";
}

const GROUNDING_BADGES: Record<GroundingKind, { label: string; className: string; icon: ReactNode }> = {
  sourced: {
    label: "Có nguồn đối chiếu",
    className: "bg-success/10 text-success",
    icon: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="m8.5 12.5 2.5 2.5 5-5.5" />
      </>
    ),
  },
  pipeline: {
    label: "Từ dữ liệu pipeline",
    className: "bg-accent/10 text-accent",
    icon: (
      <>
        <path d="M3 5a9 3 0 1 0 18 0 9 3 0 1 0-18 0" />
        <path d="M3 5v14a9 3 0 0 0 18 0V5" />
        <path d="M3 12a9 3 0 0 0 18 0" />
      </>
    ),
  },
  none: {
    label: "Chưa có nguồn đối chiếu",
    className: "bg-warning/10 text-warning",
    icon: (
      <>
        <path d="M12 3 2.5 20h19L12 3z" />
        <path d="M12 10v4M12 17.2v.3" />
      </>
    ),
  },
};

function GroundingBadge({ kind }: { kind: GroundingKind }) {
  const badge = GROUNDING_BADGES[kind];
  return (
    <span className={`inline-flex w-fit items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium ${badge.className}`}>
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {badge.icon}
      </svg>
      {badge.label}
    </span>
  );
}

function QuestionBubble({ question }: { question: string }) {
  return (
    <div className="flex items-end gap-2 justify-end">
      <div className="max-w-[85%] sm:max-w-[70%] rounded-2xl rounded-br-sm bg-[#1B2540] px-4 py-3">
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

function AnswerBubble({ answer, sources, grounding }: { answer: string; sources: AssistantSource[]; grounding: GroundingKind }) {
  return (
    <div className="flex items-end gap-2 justify-start min-w-0">
      <span className="w-7 h-7 rounded-full bg-bg border border-secondary/40 flex items-center justify-center text-secondaryBright flex-shrink-0">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
        </svg>
      </span>
      <div className="min-w-0 max-w-full rounded-2xl rounded-bl-sm border border-border bg-surface/75 backdrop-blur-md px-4 py-3 flex flex-col gap-3">
        <div className="flex flex-col gap-2">
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={answerMarkdownComponents}>
            {answer}
          </ReactMarkdown>
        </div>
        <GroundingBadge kind={grounding} />
        {sources.length > 0 && (
          <div className="flex flex-wrap gap-2 border-t border-border pt-3">
            {sources.map((s, i) => {
              const chip = "max-w-full truncate rounded-md bg-accent/10 px-2.5 py-1 text-[11.5px] text-accent";
              return /^https?:\/\//.test(s.url ?? "") ? (
                <a key={i} href={s.url} target="_blank" rel="noreferrer" title={s.title} className={`${chip} transition-colors hover:bg-accent/20 hover:text-accentBright focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent`}>
                  {s.source} · {s.title}
                </a>
              ) : (
                <span key={i} title={s.title} className={chip}>
                  {s.source} · {s.title}
                </span>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Persisted turns followed by the in-flight one. The pending turn is kept
 * separate so its answer can be shown before the reloaded history confirms
 * it was saved.
 */
export function ChatThread({
  messages,
  pendingQuestion,
  pendingResult,
  loading,
  suggestions = [],
  onSuggest,
}: {
  messages: ChatMessage[];
  pendingQuestion: string | null;
  pendingResult: AssistantResult | null;
  loading: boolean;
  suggestions?: string[];
  onSuggest?: (question: string) => void;
}) {
  if (messages.length === 0 && !pendingQuestion) {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-sm text-textMuted">Đặt câu hỏi về dữ liệu đã ingest để bắt đầu, hoặc thử một câu bên dưới.</p>
        {onSuggest && suggestions.length > 0 && (
          <div className="flex flex-col gap-2">
            {suggestions.map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => onSuggest(q)}
                className="rounded-xl border border-border bg-bg/60 px-4 py-3 text-left text-[13px] text-textSecondary transition-colors hover:border-accent/40 hover:text-textPrimary focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
              >
                {q}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      {messages.map((m) => (
        <div key={m.id} className="flex flex-col gap-4">
          <QuestionBubble question={m.question} />
          <AnswerBubble answer={m.answer} sources={m.sources} grounding={groundingKind(m.grounded, m.toolCalls)} />
        </div>
      ))}
      {pendingQuestion && (
        <div className="flex flex-col gap-4">
          <QuestionBubble question={pendingQuestion} />
          {loading && (
            <span className="flex items-center gap-2 text-xs text-textMuted" role="status">
              <span className="h-2 w-2 rounded-full bg-accent animate-pulse motion-reduce:animate-none" />
              Đang xử lý…
            </span>
          )}
          {pendingResult && (
            <AnswerBubble
              answer={pendingResult.answer}
              sources={pendingResult.sources}
              grounding={groundingKind(pendingResult.grounded, pendingResult.toolCalls)}
            />
          )}
        </div>
      )}
    </div>
  );
}
