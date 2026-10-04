"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ChatThread } from "@/components/ChatThread";
import { ToolTraceHistory } from "@/components/ToolTraceHistory";
import { ConversationList } from "@/components/ConversationList";
import { getOrCreateSessionId } from "@/lib/sessionId";
import { readPanelCollapsed, writePanelCollapsed } from "@/lib/panelState";
import type { AssistantResult, ChatMessage } from "@/lib/assistant";
import type { ConversationJSON } from "@/lib/conversations";

const LIST_COLLAPSED_KEY = "assistant_list_collapsed";
const TRACE_COLLAPSED_KEY = "assistant_trace_collapsed";
const LIST_WIDTH = "260px";
const TRACE_WIDTH = "320px";
const RAIL_WIDTH = "48px";

// One starter per tool (crypto prices, Athena SQL, weather), from the README's "Questions to try".
const SUGGESTIONS = [
  "What are the current prices of Bitcoin, Ethereum and Solana?",
  "Which Hacker News stories got the highest scores in the last 24 hours?",
  "Which tracked location is the hottest right now, and which is the most humid?",
];

/** Slide-in panel for narrow screens; closes on Esc or a click on the backdrop. */
function Drawer({ side, label, onClose, children }: { side: "left" | "right"; label: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-40 lg:hidden">
      <button type="button" aria-label="Đóng" onClick={onClose} className="absolute inset-0 bg-black/60" />
      <div
        role="dialog"
        aria-label={label}
        className={`absolute inset-y-0 flex w-[min(340px,90vw)] flex-col overflow-y-auto bg-sidebarBg p-3 ${
          side === "left" ? "left-0 border-r" : "right-0 border-l"
        } border-border`}
      >
        {children}
      </div>
    </div>
  );
}

/**
 * Three-column RAG chat: conversation list, thread, tool trace. Conversations
 * are scoped to an anonymous per-browser session id sent as X-Session-Id.
 */
export default function AssistantPage() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<ConversationJSON[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [pendingQuestion, setPendingQuestion] = useState<string | null>(null);
  const [pendingResult, setPendingResult] = useState<AssistantResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [conversationsError, setConversationsError] = useState<string | null>(null);
  const [messagesError, setMessagesError] = useState<string | null>(null);
  const [listCollapsed, setListCollapsed] = useState(false);
  const [traceCollapsed, setTraceCollapsed] = useState(false);
  // Narrow screens show the list and trace as drawers instead of columns.
  const [drawer, setDrawer] = useState<"list" | "trace" | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // Panels animate only after the remembered state has been applied, so a
  // returning visitor with a collapsed panel doesn't watch it slide shut on load.
  const [panelsReady, setPanelsReady] = useState(false);
  // Async responses compare against this ref, not the closed-over state, so a
  // late reply for a conversation the user already left is not rendered.
  const selectedIdRef = useRef<string | null>(null);
  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  // Keep the newest turn in view; instant, not smooth, so reduced-motion users aren't affected.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, pendingQuestion, pendingResult, loading]);

  useEffect(() => {
    setSessionId(getOrCreateSessionId());
  }, []);

  useEffect(() => {
    setListCollapsed(readPanelCollapsed(window.localStorage, LIST_COLLAPSED_KEY));
    setTraceCollapsed(readPanelCollapsed(window.localStorage, TRACE_COLLAPSED_KEY));
    // Wait a frame so the restored widths paint before transitions switch on.
    const frame = requestAnimationFrame(() => setPanelsReady(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  function toggleList() {
    const next = !listCollapsed;
    setListCollapsed(next);
    writePanelCollapsed(window.localStorage, LIST_COLLAPSED_KEY, next);
  }

  function toggleTrace() {
    const next = !traceCollapsed;
    setTraceCollapsed(next);
    writePanelCollapsed(window.localStorage, TRACE_COLLAPSED_KEY, next);
  }

  const loadConversations = useCallback(async (sid: string) => {
    try {
      const res = await fetch("/api/conversations", { headers: { "X-Session-Id": sid } });
      if (!res.ok) throw new Error("request failed");
      const body = await res.json();
      setConversations(body.conversations);
      setConversationsError(null);
    } catch {
      setConversationsError("Không tải được danh sách cuộc trò chuyện.");
    }
  }, []);

  useEffect(() => {
    if (sessionId) loadConversations(sessionId);
  }, [sessionId, loadConversations]);

  // Returns the fetched messages (null on failure) even when the user has
  // switched away, so submit() can still check whether its turn was persisted.
  const loadMessages = useCallback(async (sid: string, conversationId: string): Promise<ChatMessage[] | null> => {
    try {
      const res = await fetch(`/api/conversations/${conversationId}/messages`, {
        headers: { "X-Session-Id": sid },
      });
      if (!res.ok) throw new Error("request failed");
      const body = await res.json();
      if (conversationId === selectedIdRef.current) {
        setMessages(body.messages);
        setMessagesError(null);
      }
      return body.messages;
    } catch {
      if (conversationId === selectedIdRef.current) {
        setMessagesError("Không tải được lịch sử tin nhắn.");
      }
      return null;
    }
  }, []);

  useEffect(() => {
    if (sessionId && selectedId) {
      loadMessages(sessionId, selectedId);
    } else {
      setMessages([]);
    }
  }, [sessionId, selectedId, loadMessages]);

  function handleSelect(id: string) {
    setSelectedId(id);
    setPendingQuestion(null);
    setPendingResult(null);
    setMessages([]);
    setMessagesError(null);
  }

  async function createConversation(): Promise<ConversationJSON | null> {
    if (!sessionId) return null;
    const res = await fetch("/api/conversations", { method: "POST", headers: { "X-Session-Id": sessionId } });
    if (!res.ok) return null;
    const created = await res.json();
    await loadConversations(sessionId);
    return created;
  }

  async function handleCreate() {
    const created = await createConversation();
    if (created) handleSelect(created.id);
  }

  async function handleRename(id: string, title: string) {
    if (!sessionId) return;
    await fetch(`/api/conversations/${id}`, {
      method: "PATCH",
      headers: { "X-Session-Id": sessionId, "content-type": "application/json" },
      body: JSON.stringify({ title }),
    });
    loadConversations(sessionId);
  }

  async function handleDelete(id: string) {
    if (!sessionId) return;
    await fetch(`/api/conversations/${id}`, { method: "DELETE", headers: { "X-Session-Id": sessionId } });
    if (selectedId === id) setSelectedId(null);
    loadConversations(sessionId);
  }

  // Lazily creates a conversation on the first question. The pending turn stays
  // on screen until the reloaded history contains it, so the answer never
  // flickers away if persistence lags or fails.
  async function submit() {
    const trimmed = input.trim();
    if (!trimmed || loading || !sessionId) return;

    let conversationId = selectedId;
    if (!conversationId) {
      const created = await createConversation();
      if (!created) {
        setNotice("Không tạo được cuộc trò chuyện mới, thử lại sau.");
        return;
      }
      conversationId = created.id;
      setSelectedId(conversationId);
    }

    setPendingQuestion(trimmed);
    setPendingResult(null);
    setNotice(null);
    setLoading(true);
    try {
      const res = await fetch("/api/assistant", {
        method: "POST",
        headers: { "content-type": "application/json", "X-Session-Id": sessionId },
        body: JSON.stringify({ question: trimmed, conversationId }),
      });
      const body = await res.json();
      if (res.status === 429) {
        setNotice(body.error ?? "Đợi một chút rồi hỏi tiếp.");
      } else if (!res.ok) {
        setNotice(body.error ?? "Không gọi được RAG Lambda.");
      } else {
        const assistantResult = body as AssistantResult;
        if (conversationId === selectedIdRef.current) {
          setPendingResult(assistantResult);
        }
        const reloaded = await loadMessages(sessionId, conversationId);
        const persisted =
          reloaded !== null &&
          reloaded.some((m) => m.question === trimmed && m.answer === assistantResult.answer);
        if (conversationId === selectedIdRef.current && persisted) {
          setPendingQuestion(null);
          setPendingResult(null);
        }
      }
    } catch {
      setNotice("Không gọi được RAG Lambda, thử lại sau.");
    } finally {
      setLoading(false);
      setInput("");
    }
  }

  const columns = `${listCollapsed ? RAIL_WIDTH : LIST_WIDTH} minmax(0, 1fr) ${traceCollapsed ? RAIL_WIDTH : TRACE_WIDTH}`;
  const closeDrawer = () => setDrawer(null);

  const conversationList = (inDrawer: boolean) => (
    <ConversationList
      conversations={conversations}
      selectedId={selectedId}
      onSelect={(id) => {
        handleSelect(id);
        if (inDrawer) closeDrawer();
      }}
      onCreate={async () => {
        await handleCreate();
        if (inDrawer) closeDrawer();
      }}
      onRename={handleRename}
      onDelete={handleDelete}
      collapsed={inDrawer ? false : listCollapsed}
      onToggleCollapsed={inDrawer ? closeDrawer : toggleList}
      hasError={conversationsError !== null}
    />
  );

  const drawerButton = "rounded-lg border border-border px-3 py-1.5 text-[12.5px] text-textSecondary transition-colors hover:border-accent/40 hover:text-textPrimary focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent";

  return (
    <div className="flex h-[calc(100dvh-3.5rem)] flex-col gap-4 p-4 lg:h-screen lg:gap-5 lg:p-9">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-heading text-3xl font-semibold tracking-tight text-textPrimary">RAG Assistant</h1>
        <div className="flex gap-2 lg:hidden">
          <button type="button" onClick={() => setDrawer("list")} className={drawerButton}>
            Cuộc trò chuyện
          </button>
          <button type="button" onClick={() => setDrawer("trace")} className={drawerButton}>
            Tool trace
          </button>
        </div>
      </div>
      <div
        className={`grid min-h-0 flex-grow grid-cols-1 gap-5 lg:[grid-template-columns:var(--cols)] ${
          panelsReady ? "transition-[grid-template-columns] duration-200 ease-out motion-reduce:transition-none" : ""
        }`}
        style={{ "--cols": columns } as React.CSSProperties}
      >
        <div className="hidden min-h-0 min-w-0 flex-col gap-2 lg:flex">
          {conversationsError && !listCollapsed && (
            <div className="rounded-lg border border-error/40 bg-error/10 px-3 py-2 flex items-center justify-between gap-2">
              <span className="text-[11.5px] text-error">{conversationsError}</span>
              <button
                onClick={() => sessionId && loadConversations(sessionId)}
                className="text-[11.5px] text-accent underline flex-shrink-0"
              >
                Thử lại
              </button>
            </div>
          )}
          {conversationList(false)}
        </div>
        <div className="flex min-h-0 min-w-0 flex-col rounded-xl border border-border bg-surface/75 backdrop-blur-md">
          {messagesError && (
            <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2.5">
              <span className="text-xs text-error">{messagesError}</span>
              <button
                onClick={() => sessionId && selectedId && loadMessages(sessionId, selectedId)}
                className="text-xs text-accent underline flex-shrink-0"
              >
                Thử lại
              </button>
            </div>
          )}
          <div ref={scrollRef} className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4 sm:p-6">
            <ChatThread
              messages={messages}
              pendingQuestion={pendingQuestion}
              pendingResult={pendingResult}
              loading={loading}
              suggestions={SUGGESTIONS}
              onSuggest={(q) => {
                setInput(q);
                inputRef.current?.focus();
              }}
            />
          </div>
          <div className="flex flex-col gap-2 border-t border-border p-3 sm:p-4">
            {notice && <p className="text-xs text-warning">{notice}</p>}
            <div className="flex items-center gap-2 rounded-xl border border-border px-3 py-2 transition-shadow focus-within:border-accent focus-within:shadow-glowCyan">
              <input
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && submit()}
                placeholder="Đặt câu hỏi về dữ liệu đã ingest…"
                aria-label="Câu hỏi"
                className="min-w-0 flex-grow bg-transparent text-sm text-textPrimary outline-none placeholder:text-textMuted"
                disabled={loading}
                maxLength={500}
              />
              {input.length > 400 && <span className="text-[11px] tabular-nums text-textMuted">{input.length}/500</span>}
              <button
                onClick={submit}
                disabled={loading}
                className="rounded-lg bg-accent px-4 py-2 text-[13px] font-semibold text-bg disabled:opacity-50 transition-shadow hover:shadow-glowCyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-accentBright"
              >
                Gửi
              </button>
            </div>
          </div>
        </div>
        <div className="hidden min-h-0 min-w-0 lg:block [&>*]:h-full">
          <ToolTraceHistory messages={messages} collapsed={traceCollapsed} onToggleCollapsed={toggleTrace} />
        </div>
      </div>

      {drawer === "list" && (
        <Drawer side="left" label="Danh sách cuộc trò chuyện" onClose={closeDrawer}>
          {conversationList(true)}
        </Drawer>
      )}
      {drawer === "trace" && (
        <Drawer side="right" label="Tool trace" onClose={closeDrawer}>
          <ToolTraceHistory messages={messages} collapsed={false} onToggleCollapsed={closeDrawer} />
        </Drawer>
      )}
    </div>
  );
}
