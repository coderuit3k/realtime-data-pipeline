"use client";

import { useMemo, useRef } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { sql, StandardSQL } from "@codemirror/lang-sql";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorView, keymap } from "@codemirror/view";
import { Prec } from "@codemirror/state";
import { tags as t } from "@lezer/highlight";

// Colours mirror web/tailwind.config.ts so the editor blends with the
// surrounding cards instead of looking like a foreign widget.
const editorTheme = EditorView.theme(
  {
    "&": {
      backgroundColor: "transparent",
      color: "#DFE2EE",
      fontSize: "13px",
      maxHeight: "45vh",
    },
    ".cm-content": {
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
      lineHeight: "1.625",
      caretColor: "#4CD7F6",
      minHeight: "196px",
      padding: "14px 0",
    },
    ".cm-scroller": { overflow: "auto" },
    ".cm-gutters": {
      backgroundColor: "transparent",
      borderRight: "1px solid rgba(255, 255, 255, 0.08)",
      color: "#869397",
    },
    ".cm-activeLineGutter": { backgroundColor: "transparent", color: "#DFE2EE" },
    ".cm-activeLine": { backgroundColor: "rgba(255, 255, 255, 0.03)" },
    ".cm-cursor": { borderLeftColor: "#4CD7F6" },
    ".cm-selectionBackground": { backgroundColor: "rgba(6, 182, 212, 0.28)" },
    "&.cm-focused .cm-selectionBackground": { backgroundColor: "rgba(6, 182, 212, 0.28)" },
    ".cm-matchingBracket": { backgroundColor: "rgba(6, 182, 212, 0.25)", outline: "none" },
    "&.cm-focused": { outline: "none" },
  },
  { dark: true },
);

const highlightStyle = HighlightStyle.define([
  { tag: t.keyword, color: "#4CD7F6" },
  { tag: [t.string, t.special(t.string)], color: "#10B981" },
  { tag: [t.number, t.bool, t.null], color: "#F59E0B" },
  { tag: t.comment, color: "#869397", fontStyle: "italic" },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: "#8B5CF6" },
  { tag: [t.typeName, t.standard(t.variableName)], color: "#BCC9CD" },
  { tag: t.operator, color: "#BCC9CD" },
]);

/**
 * SQL editor for the Explorer page: CodeMirror 6 with syntax highlighting
 * (StandardSQL is the closest bundled dialect to Athena's Trino SQL), line
 * numbers, undo/search from the basic setup, and Ctrl/Cmd+Enter to run --
 * the same shortcut the old plain textarea had.
 */
export default function SqlEditor({
  value,
  onChange,
  onRun,
  ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  onRun: () => void;
  ariaLabel?: string;
}) {
  // The parent's run callback is recreated every render; a ref keeps the
  // memoized extensions stable so the editor is not reconfigured per render.
  const onRunRef = useRef(onRun);
  onRunRef.current = onRun;

  const extensions = useMemo(
    () => [
      sql({ dialect: StandardSQL }),
      syntaxHighlighting(highlightStyle),
      Prec.highest(
        keymap.of([
          {
            key: "Mod-Enter",
            run: () => {
              onRunRef.current();
              return true;
            },
          },
        ]),
      ),
      EditorView.contentAttributes.of({ "aria-label": ariaLabel ?? "SQL" }),
    ],
    [ariaLabel],
  );

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-bg transition-colors focus-within:border-accent/60">
      <CodeMirror
        value={value}
        onChange={onChange}
        extensions={extensions}
        theme={editorTheme}
        basicSetup={{ foldGutter: false }}
      />
    </div>
  );
}
