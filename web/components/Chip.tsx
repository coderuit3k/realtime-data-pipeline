import type { ReactNode } from "react";

const TONES = {
  success: "bg-success/15 text-success",
  error: "bg-error/15 text-error",
  warning: "bg-warning/15 text-warning",
  accent: "bg-accent/15 text-accentBright",
  muted: "bg-white/[0.06] text-textMuted",
} as const;

/** Small rounded status label (RAG indexed, configured, ...). */
export function Chip({ tone = "muted", children }: { tone?: keyof typeof TONES; children: ReactNode }) {
  return (
    <span className={`inline-flex w-fit items-center rounded-full px-2.5 py-0.5 text-[11.5px] font-semibold ${TONES[tone]}`}>
      {children}
    </span>
  );
}
