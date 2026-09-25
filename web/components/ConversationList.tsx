"use client";

import { useState } from "react";
import type { ConversationJSON } from "@/lib/conversations";

export function ConversationList({
  conversations,
  selectedId,
  onSelect,
  onCreate,
  onRename,
  onDelete,
}: {
  conversations: ConversationJSON[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);

  function startEditing(conversation: ConversationJSON) {
    setEditingId(conversation.id);
    setEditingTitle(conversation.title);
  }

  function commitEditing() {
    const trimmed = editingTitle.trim();
    if (editingId && trimmed) {
      onRename(editingId, trimmed);
    }
    setEditingId(null);
  }

  return (
    <div className="w-[260px] shrink-0 rounded-lg border border-border bg-surface/75 backdrop-blur-md p-3 flex flex-col gap-2 overflow-auto">
      <button
        onClick={onCreate}
        className="rounded-lg bg-accent px-3 py-2 text-xs font-semibold text-bg transition-shadow hover:shadow-glowCyan"
      >
        + Cuộc trò chuyện mới
      </button>
      <div className="flex flex-col gap-1 mt-1">
        {conversations.map((c) => (
          <div
            key={c.id}
            className={`group flex items-center gap-1.5 rounded-lg px-2.5 py-2 cursor-pointer ${
              c.id === selectedId ? "bg-accent/10 border border-accent" : "border border-transparent hover:bg-bg/40"
            }`}
            onClick={() => onSelect(c.id)}
          >
            {editingId === c.id ? (
              <input
                autoFocus
                value={editingTitle}
                onChange={(e) => setEditingTitle(e.target.value)}
                onBlur={commitEditing}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitEditing();
                  if (e.key === "Escape") setEditingId(null);
                }}
                onClick={(e) => e.stopPropagation()}
                maxLength={100}
                className="flex-grow bg-transparent text-[12.5px] text-textPrimary outline-none border-b border-accent"
              />
            ) : (
              <span className="flex-grow text-[12.5px] text-textPrimary truncate">{c.title}</span>
            )}
            <button
              onClick={(e) => {
                e.stopPropagation();
                startEditing(c);
              }}
              className="opacity-0 group-hover:opacity-100 text-textMuted hover:text-accent flex-shrink-0"
              aria-label="Đổi tên"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 20h9" />
                <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
              </svg>
            </button>
            {confirmingDeleteId === c.id ? (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(c.id);
                  setConfirmingDeleteId(null);
                }}
                className="text-[10px] font-semibold text-error flex-shrink-0"
              >
                Xóa?
              </button>
            ) : (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setConfirmingDeleteId(c.id);
                }}
                className="opacity-0 group-hover:opacity-100 text-textMuted hover:text-error flex-shrink-0"
                aria-label="Xóa"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 6h18" />
                  <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0-1 14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2L4 6" />
                </svg>
              </button>
            )}
          </div>
        ))}
        {conversations.length === 0 && (
          <span className="text-[11px] text-textMuted px-2.5 py-2">Chưa có cuộc trò chuyện nào.</span>
        )}
      </div>
    </div>
  );
}
