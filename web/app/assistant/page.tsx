// web/app/assistant/page.tsx
"use client";

import { useState } from "react";
import { ChatThread } from "@/components/ChatThread";
import { ToolTrace } from "@/components/ToolTrace";
import type { AssistantResult } from "@/lib/assistant";

export default function AssistantPage() {
  const [input, setInput] = useState("");
  const [question, setQuestion] = useState<string | null>(null);
  const [result, setResult] = useState<AssistantResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  async function submit() {
    const trimmed = input.trim();
    if (!trimmed || loading) return;
    setQuestion(trimmed);
    setResult(null);
    setNotice(null);
    setLoading(true);
    try {
      const res = await fetch("/api/assistant", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: trimmed }),
      });
      const body = await res.json();
      if (res.status === 429) {
        setNotice(body.error ?? "Đợi một chút rồi hỏi tiếp.");
      } else if (!res.ok) {
        setNotice(body.error ?? "Không gọi được RAG Lambda.");
      } else {
        setResult(body as AssistantResult);
      }
    } catch {
      setNotice("Không gọi được RAG Lambda, thử lại sau.");
    } finally {
      setLoading(false);
      setInput("");
    }
  }

  return (
    <div className="p-9 flex flex-col gap-5">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-textPrimary">RAG Assistant</h1>
        <p className="mt-1.5 text-sm text-textSecondary">
          Agentic RAG — agent tự quyết định gọi tool truy xuất dữ liệu đã ingest hoặc tìm trên web.
        </p>
      </div>
      <div className="grid grid-cols-[1.5fr_1fr] gap-5">
        <div className="rounded-lg border border-border bg-surface p-6 flex flex-col gap-4">
          <ChatThread question={question} result={result} loading={loading} />
          {notice && <p className="text-xs text-warning">{notice}</p>}
          <div className="mt-auto flex gap-2 items-center border border-border rounded-xl px-3 py-2">
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
              className="rounded-lg bg-accent px-4 py-2 text-xs font-semibold text-bg disabled:opacity-50"
            >
              Gửi
            </button>
          </div>
        </div>
        <ToolTrace result={result} />
      </div>
    </div>
  );
}
