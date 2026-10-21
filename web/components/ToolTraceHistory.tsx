"use client";

import type { ReactNode } from "react";
import type { ChatMessage } from "@/lib/assistant";
import { PanelToggleButton } from "./PanelToggleButton";

/**
 * One rag_agent trace entry, as built in run_agent:
 * { tool, input, result_count, expanded_queries? }. Fields stay `unknown`
 * because toolCalls is persisted through Supabase as untyped JSON; every
 * read below is guarded, and anything unrecognised falls back to raw JSON.
 */
type TraceEntry = {
  tool?: unknown;
  input?: unknown;
  result_count?: unknown;
  expanded_queries?: unknown;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((x): x is string => typeof x === "string") : [];
}

const TOOL_ICONS: Record<string, ReactNode> = {
  search_knowledge_base: (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="M20 20l-4.35-4.35" />
    </>
  ),
  query_athena: (
    <>
      <path d="M3 5a9 3 0 1 0 18 0 9 3 0 1 0-18 0" />
      <path d="M3 5v14a9 3 0 0 0 18 0V5" />
      <path d="M3 12a9 3 0 0 0 18 0" />
    </>
  ),
  get_crypto_prices: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M14.5 9.5c0-1.1-1.1-2-2.5-2s-2.5.8-2.5 1.9c0 2.6 5 1.4 5 4 0 1.1-1.1 1.9-2.5 1.9s-2.5-.9-2.5-2" />
      <path d="M12 6.5v1M12 16v1" />
    </>
  ),
  get_weather: <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" />,
  search_web: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18" />
    </>
  ),
};

function ToolIcon({ tool }: { tool: string }) {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="flex-shrink-0 text-accent">
      {TOOL_ICONS[tool] ?? <path d="M14.7 6.3a4.5 4.5 0 0 0-6 6L3 18l3 3 5.7-5.7a4.5 4.5 0 0 0 6-6L14 13l-3-3 3.7-3.7z" />}
    </svg>
  );
}

/** The tool's main input, rendered for humans instead of as a JSON blob. */
function InputSummary({ tool, input }: { tool: string; input: Record<string, unknown> }) {
  if (tool === "search_knowledge_base" || tool === "search_web") {
    const query = typeof input.query === "string" ? input.query : "";
    const sources = stringList(input.sources);
    const daysBack = typeof input.days_back === "number" ? input.days_back : null;
    return (
      <div className="flex flex-col gap-0.5">
        <span className="text-[12px] italic leading-snug text-textSecondary">“{query}”</span>
        {(sources.length > 0 || daysBack !== null) && (
          <span className="text-[11px] text-textMuted">
            {sources.length > 0 ? `Nguồn: ${sources.join(", ")}` : ""}
            {sources.length > 0 && daysBack !== null ? " · " : ""}
            {daysBack !== null ? `trong ${daysBack} ngày gần đây` : ""}
          </span>
        )}
      </div>
    );
  }
  if (tool === "query_athena") {
    const sql = typeof input.sql === "string" ? input.sql : "";
    return (
      <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-words rounded-md bg-bg px-2.5 py-2 font-mono text-[11px] leading-relaxed text-textSecondary">
        {sql}
      </pre>
    );
  }
  if (tool === "get_crypto_prices") {
    return <span className="text-[12px] text-textMuted">Toàn bộ coin đang theo dõi</span>;
  }
  if (tool === "get_weather") {
    return <span className="text-[12px] text-textMuted">Tất cả địa điểm đang theo dõi</span>;
  }
  const keys = Object.keys(input);
  if (keys.length === 0) return null;
  return (
    <span className="break-all font-mono text-[11px] text-textMuted">
      {keys.map((k) => `${k}: ${JSON.stringify(input[k])}`).join(" · ")}
    </span>
  );
}

function TraceCallCard({ call }: { call: unknown }) {
  const entry = asRecord(call) as TraceEntry | null;
  const tool = entry && typeof entry.tool === "string" ? entry.tool : null;

  // Unrecognised shape (older cached turns, future fields): keep the old
  // raw-JSON rendering rather than dropping the information.
  if (!entry || !tool) {
    return (
      <span className="break-all rounded-md bg-bg/70 px-2.5 py-1.5 font-mono text-[11.5px] text-textSecondary">
        {JSON.stringify(call)}
      </span>
    );
  }

  const input = asRecord(entry.input) ?? {};
  const resultCount = typeof entry.result_count === "number" ? entry.result_count : null;
  const expanded = stringList(entry.expanded_queries);

  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-border bg-bg/70 px-3 py-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1.5 font-mono text-[11.5px] font-semibold text-textPrimary">
          <ToolIcon tool={tool} />
          <span className="truncate">{tool}</span>
        </span>
        {resultCount !== null && (
          <span className="flex-shrink-0 text-[11px] tabular-nums text-textMuted">{resultCount} kết quả</span>
        )}
      </div>

      <InputSummary tool={tool} input={input} />

      {expanded.length > 0 && (
        <div className="flex flex-col gap-1">
          <span className="text-[11px] text-textMuted">Truy vấn đã mở rộng:</span>
          <div className="flex flex-wrap gap-1.5">
            {expanded.map((q, i) => (
              <span
                key={i}
                className={`rounded-md px-2 py-0.5 text-[11px] leading-snug ${
                  i === 0
                    ? "border border-accent/40 bg-accent/10 text-accentBright"
                    : "bg-white/[0.05] text-textSecondary"
                }`}
              >
                {q}
                {i === 0 ? " · gốc" : ""}
              </span>
            ))}
          </div>
        </div>
      )}

      <details>
        <summary className="cursor-pointer text-[11px] text-textMuted transition-colors hover:text-textSecondary">
          JSON gốc
        </summary>
        <pre className="mt-1 overflow-auto whitespace-pre-wrap break-all rounded-md bg-bg px-2.5 py-2 font-mono text-[11px] text-textSecondary">
          {JSON.stringify(call, null, 2)}
        </pre>
      </details>
    </div>
  );
}

/**
 * Per-turn list of the tools the RAG agent chose to call, rendered as
 * readable cards (tool, main input, result count, expanded queries) with
 * the raw JSON kept one click away, so the agent's routing decisions are
 * inspectable without reading a JSON blob.
 */
export function ToolTraceHistory({
  messages,
  collapsed,
  onToggleCollapsed,
}: {
  messages: ChatMessage[];
  collapsed: boolean;
  onToggleCollapsed: () => void;
}) {
  if (collapsed) {
    return (
      <div className="w-full rounded-xl border border-border bg-surface/75 backdrop-blur-md py-3 flex flex-col items-center gap-3">
        <PanelToggleButton collapsed edge="right" label="Hiện tool trace" onClick={onToggleCollapsed} />
        <span className="text-[11px] font-semibold text-textMuted [writing-mode:vertical-rl]">Tool trace</span>
      </div>
    );
  }

  if (messages.length === 0) {
    return (
      <div className="min-w-0 rounded-xl border border-border bg-surface/75 backdrop-blur-md p-5 flex flex-col gap-3">
        <div className="flex justify-end">
          <PanelToggleButton collapsed={false} edge="right" label="Ẩn tool trace" onClick={onToggleCollapsed} />
        </div>
        <span className="text-[12.5px] text-textMuted text-center">
          Chọn hoặc tạo một cuộc trò chuyện để xem tool trace.
        </span>
      </div>
    );
  }

  return (
    <div className="min-w-0 rounded-xl border border-border bg-surface/75 backdrop-blur-md p-5 flex flex-col gap-4 overflow-auto">
      <div className="flex items-center gap-2">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#8B5CF6" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
        </svg>
        <span className="flex-grow text-xs font-semibold text-textPrimary">Tool trace (agent tự quyết định)</span>
        <PanelToggleButton collapsed={false} edge="right" label="Ẩn tool trace" onClick={onToggleCollapsed} />
      </div>
      {messages.map((m, turnIndex) => (
        <div key={m.id} className="flex flex-col gap-1.5 pb-3 border-b border-border last:border-b-0 last:pb-0">
          <span className="text-[12px] font-medium text-textSecondary">
            Lượt {turnIndex + 1}: {m.question}
          </span>
          {m.toolCalls.length === 0 ? (
            <span className="text-[12px] text-textMuted">(không gọi tool nào)</span>
          ) : (
            m.toolCalls.map((call, i) => <TraceCallCard key={i} call={call} />)
          )}
        </div>
      ))}
    </div>
  );
}
