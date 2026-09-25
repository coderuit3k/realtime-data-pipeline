"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChatThread } from "@/components/ChatThread";
import { ToolTraceHistory } from "@/components/ToolTraceHistory";
import { ConversationList } from "@/components/ConversationList";
import { getOrCreateSessionId } from "@/lib/sessionId";
import type { AssistantResult, ChatMessage } from "@/lib/assistant";
import type { ConversationJSON } from "@/lib/conversations";

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
  const selectedIdRef = useRef<string | null>(null);
  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  useEffect(() => {
    setSessionId(getOrCreateSessionId());
  }, []);

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

  return (
    <div className="p-9 flex flex-col gap-5 h-screen">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-textPrimary">RAG Assistant</h1>
        <p className="mt-1.5 text-sm text-textSecondary">
          Agentic RAG — agent tự quyết định gọi tool truy xuất dữ liệu đã ingest hoặc tìm trên web.
        </p>
      </div>
      <div className="grid grid-cols-[260px_1.5fr_1fr] gap-5 flex-grow min-h-0">
        <div className="flex flex-col gap-2 min-h-0">
          {conversationsError && (
            <div className="rounded-lg border border-error/40 bg-error/10 px-3 py-2 flex items-center justify-between gap-2">
              <span className="text-[11px] text-error">{conversationsError}</span>
              <button
                onClick={() => sessionId && loadConversations(sessionId)}
                className="text-[11px] text-accent underline flex-shrink-0"
              >
                Thử lại
              </button>
            </div>
          )}
          <ConversationList
            conversations={conversations}
            selectedId={selectedId}
            onSelect={handleSelect}
            onCreate={handleCreate}
            onRename={handleRename}
            onDelete={handleDelete}
          />
        </div>
        <div className="rounded-lg border border-border bg-surface/75 backdrop-blur-md p-6 flex flex-col gap-4 min-h-0 overflow-auto">
          {messagesError && (
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-error">{messagesError}</span>
              <button
                onClick={() => sessionId && selectedId && loadMessages(sessionId, selectedId)}
                className="text-xs text-accent underline flex-shrink-0"
              >
                Thử lại
              </button>
            </div>
          )}
          <ChatThread
            messages={messages}
            pendingQuestion={pendingQuestion}
            pendingResult={pendingResult}
            loading={loading}
          />
          {notice && <p className="text-xs text-warning">{notice}</p>}
          <div className="mt-auto flex gap-2 items-center border border-border rounded-xl px-3 py-2 transition-shadow focus-within:border-accent focus-within:shadow-glowCyan">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
              placeholder="Đặt câu hỏi về dữ liệu đã ingest…"
              className="flex-grow bg-transparent text-sm text-textPrimary outline-none placeholder:text-textMuted"
              disabled={loading}
              maxLength={500}
            />
            <button
              onClick={submit}
              disabled={loading}
              className="rounded-lg bg-accent px-4 py-2 text-xs font-semibold text-bg disabled:opacity-50 transition-shadow hover:shadow-glowCyan"
            >
              Gửi
            </button>
          </div>
        </div>
        <ToolTraceHistory messages={messages} />
      </div>
    </div>
  );
}
