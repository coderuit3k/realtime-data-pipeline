"use client";

import { useState } from "react";
import type { ConversationJSON } from "@/lib/conversations";
import { PanelToggleButton } from "./PanelToggleButton";

/**
 * Conversation sidebar for the assistant page, with inline rename and a
 * two-click delete (first click arms, second confirms). Collapses to a rail
 * that still offers "new conversation" and an error dot via `hasError`.
 */
export function ConversationList({
  conversations,
  selectedId,
  onSelect,
  onCreate,
  onRename,
  onDelete,
  collapsed,
  onToggleCollapsed,
  hasError = false,
}: {
  conversations: ConversationJSON[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  hasError?: boolean;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);

  function startEditing(conversation: ConversationJSON) {
    setEditingId(conversation.id);
    setEditingTitle(conversation.title);
  }

  // Runs on both Enter and blur; a blank title cancels instead of renaming.
  function commitEditing() {
    const trimmed = editingTitle.trim();
    if (editingId && trimmed) {
      onRename(editingId, trimmed);
    }
    setEditingId(null);
  }

  if (collapsed) {
    return (
      <div className="w-full rounded-xl border border-border bg-surface/75 backdrop-blur-md py-3 flex flex-col items-center gap-3">
        <PanelToggleButton
          collapsed
          edge="left"
          label="Hiện danh sách cuộc trò chuyện"
          onClick={onToggleCollapsed}
          alert={hasError}
        />
        <button
          type="button"
          onClick={onCreate}
          aria-label="Cuộc trò chuyện mới"
          title="Cuộc trò chuyện mới"
          className="w-8 h-8 rounded-lg bg-accent text-base font-semibold leading-none text-bg transition-shadow hover:shadow-glowCyan"
        >
          +
        </button>
      </div>
    );
  }

  return (
    <div className="w-full min-w-0 rounded-xl border border-border bg-surface/75 backdrop-blur-md p-3 flex flex-col gap-2 overflow-auto">
      <div className="flex items-center gap-2">
        <button
          onClick={onCreate}
          className="flex-grow rounded-lg bg-accent px-3 py-2.5 text-[13px] font-semibold text-bg transition-shadow hover:shadow-glowCyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-accentBright"
        >
          + Cuộc trò chuyện mới
        </button>
        <PanelToggleButton
          collapsed={false}
          edge="left"
          label="Ẩn danh sách cuộc trò chuyện"
          onClick={onToggleCollapsed}
        />
      </div>
      <div className="flex flex-col gap-1 mt-1">
        {conversations.map((c) => (
          <div
            key={c.id}
            className={`group flex items-center gap-1.5 rounded-lg px-2.5 py-2.5 cursor-pointer ${
              c.id === selectedId ? "bg-accent/10 border border-accent" : "border border-transparent hover:bg-bg/40"
            }`}
            onClick={() => onSelect(c.id)}
          >
            {/* Controls inside the row stop propagation so they don't also select the conversation. */}
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
              <span className="flex-grow text-[13px] text-textPrimary truncate">{c.title}</span>
            )}
            <button
              onClick={(e) => {
                e.stopPropagation();
                startEditing(c);
              }}
              className="p-1 opacity-100 lg:opacity-0 lg:group-hover:opacity-100 focus-visible:opacity-100 text-textMuted hover:text-accent flex-shrink-0"
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
                className="p-1 text-[11px] font-semibold text-error flex-shrink-0"
              >
                Xóa?
              </button>
            ) : (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setConfirmingDeleteId(c.id);
                }}
                className="p-1 opacity-100 lg:opacity-0 lg:group-hover:opacity-100 focus-visible:opacity-100 text-textMuted hover:text-error flex-shrink-0"
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
          <span className="text-[12px] text-textMuted px-2.5 py-2">Chưa có cuộc trò chuyện nào. Gửi một câu hỏi để bắt đầu.</span>
        )}
      </div>
    </div>
  );
}
