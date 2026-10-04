import type { ReactNode } from "react";

/** Inline stroke icon sized for card headers; `d` is one or more SVG path strings. */
export function CardIcon({ d }: { d: string | string[] }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {(Array.isArray(d) ? d : [d]).map((p) => (
        <path key={p} d={p} />
      ))}
    </svg>
  );
}

type SectionCardProps = {
  title: string;
  icon: ReactNode;
  /** Small right-aligned note in the header, e.g. a count. */
  meta?: string;
  className?: string;
  children: ReactNode;
};

/** Glass card with an icon chip header; hover lifts the border toward the accent. */
export function SectionCard({ title, icon, meta, className = "", children }: SectionCardProps) {
  return (
    <section
      className={`rounded-xl border border-border bg-surface/75 backdrop-blur-md p-5 flex flex-col gap-4 transition-colors hover:border-accent/30 ${className}`}
    >
      <header className="flex items-center gap-2.5">
        <span className="flex h-6 w-6 items-center justify-center rounded-md bg-accent/10 text-accent">
          {icon}
        </span>
        <h2 className="text-[13px] font-semibold text-textPrimary">{title}</h2>
        {meta && <span className="ml-auto text-[11px] text-textMuted">{meta}</span>}
      </header>
      {children}
    </section>
  );
}
