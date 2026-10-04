import type { ReactNode } from "react";

type SpotlightCardProps = {
  label: string;
  title?: string;
  url?: string;
  imageUrl?: string;
  footer?: ReactNode;
  /** Big figures pinned to the bottom of the card; fills the space when a sibling card is taller. */
  stats?: { label: string; value: string }[];
  /** Accent for the label chip and the top edge. */
  tone: "orange" | "indigo" | "cyan";
  emptyText: string;
};

const TONES = {
  orange: { chip: "bg-[#d95926]/15 text-[#f08a5d]", edge: "from-[#d95926]" },
  indigo: { chip: "bg-secondary/15 text-[#a5a8f7]", edge: "from-secondary" },
  cyan: { chip: "bg-accent/15 text-accentBright", edge: "from-accent" },
} as const;

/** Featured story: coloured top edge, label chip, large linked headline, optional cover image. */
export function SpotlightCard({ label, title, url, imageUrl, footer, stats, tone, emptyText }: SpotlightCardProps) {
  const t = TONES[tone];
  return (
    <article className="relative flex flex-col gap-3 overflow-hidden rounded-xl border border-border bg-surface/75 p-5 backdrop-blur-md transition-colors hover:border-accent/30">
      <div className={`absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r ${t.edge} to-transparent`} />
      <span className={`w-fit rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${t.chip}`}>{label}</span>
      {title ? (
        <>
          {imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={imageUrl}
              alt=""
              loading="lazy"
              className="h-24 w-full rounded-lg object-cover"
              onError={(e) => {
                e.currentTarget.style.display = "none";
              }}
            />
          ) : null}
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="line-clamp-4 text-xl font-semibold leading-snug text-textPrimary transition-colors hover:text-accentBright focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
          >
            {title}
          </a>
          {stats && stats.length > 0 && (
            <dl className="mt-auto grid gap-2" style={{ gridTemplateColumns: `repeat(${stats.length}, minmax(0, 1fr))` }}>
              {stats.map((st) => (
                <div key={st.label} className="rounded-lg bg-bg/70 px-3 py-2.5">
                  <dd className="text-xl font-semibold tabular-nums text-textPrimary">{st.value}</dd>
                  <dt className="text-[11px] text-textMuted">{st.label}</dt>
                </div>
              ))}
            </dl>
          )}
          {footer && (
            <div className={`${stats && stats.length > 0 ? "" : "mt-auto "}text-[11.5px] tabular-nums text-textMuted`}>
              {footer}
            </div>
          )}
        </>
      ) : (
        <span className="text-[12px] text-textMuted">{emptyText}</span>
      )}
    </article>
  );
}
