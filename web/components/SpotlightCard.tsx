import { useEffect, useState, type ReactNode } from "react";

type SpotlightStat = { label: string; value: string; icon?: ReactNode };

type SpotlightByline = { name: string; timeLabel?: string };

type SpotlightCardProps = {
  label: string;
  title?: string;
  url?: string;
  imageUrl?: string;
  /** Short summary under the headline (a news description); omitted when the source has none. */
  excerpt?: string;
  /** Who published it, rendered as an avatar byline pinned to the card's foot. */
  byline?: SpotlightByline;
  /** Verb before the byline name: "Đăng bởi" for an HN author, "Từ" for a news provider. */
  bylineVerb?: string;
  /** Big figures above the byline. */
  stats?: SpotlightStat[];
  /** Intensity bar (e.g. how heated a discussion is); the raw value stays visible as text. */
  meter?: { label: string; pct: number; value: string };
  /** SVG path(s) drawn large in a banner where a cover image would go, for stories that have none. */
  artPaths?: string[];
  /** Accent for the label chip, the top edge and the meter fill. */
  tone: "orange" | "indigo" | "cyan";
  emptyText: string;
};

const TONES = {
  orange: { chip: "bg-[#d95926]/15 text-[#f08a5d]", edge: "from-[#d95926]", art: "from-[#d95926]/30 text-[#f08a5d]", bar: "from-[#d95926] to-[#f08a5d]" },
  indigo: { chip: "bg-secondary/15 text-[#a5a8f7]", edge: "from-secondary", art: "from-secondary/30 text-[#a5a8f7]", bar: "from-secondary to-[#a5a8f7]" },
  cyan: { chip: "bg-accent/15 text-accentBright", edge: "from-accent", art: "from-accent/30 text-accentBright", bar: "from-accent to-accentBright" },
} as const;

/** Host of the story link ("github.com"), shown so readers know where the headline leads. */
function hostOf(url?: string): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

/**
 * Featured story: coloured top edge, label chip + link host, linked headline,
 * optional cover image or excerpt, stat tiles, and an avatar byline (author +
 * age) pinned to the foot so the three cards line up in their grid row.
 */
export function SpotlightCard({
  label,
  title,
  url,
  imageUrl,
  excerpt,
  byline,
  bylineVerb = "Đăng bởi",
  stats,
  meter,
  artPaths,
  tone,
  emptyText,
}: SpotlightCardProps) {
  const t = TONES[tone];
  const host = hostOf(url);
  // A cover URL that fails to load (hotlink protection, dead CDN) falls back
  // to the art banner instead of leaving an empty hole in the card.
  const [imgFailed, setImgFailed] = useState(false);
  useEffect(() => setImgFailed(false), [imageUrl]);
  return (
    <article className="relative flex flex-col gap-3 overflow-hidden rounded-xl border border-border bg-surface/75 p-5 backdrop-blur-md transition-colors hover:border-accent/30">
      <div className={`absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r ${t.edge} to-transparent`} />
      <div className="flex items-center justify-between gap-2">
        <span className={`w-fit rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${t.chip}`}>{label}</span>
        {host && <span className="truncate font-mono text-[11px] text-textMuted">{host}</span>}
      </div>
      {title ? (
        <>
          {imageUrl && !imgFailed ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={imageUrl}
              alt=""
              loading="lazy"
              className="h-28 w-full rounded-lg object-cover"
              onError={() => setImgFailed(true)}
            />
          ) : artPaths ? (
            <div
              aria-hidden="true"
              className={`relative flex h-24 w-full items-center justify-center overflow-hidden rounded-lg bg-gradient-to-br to-transparent ${t.art}`}
            >
              <span className="absolute h-40 w-40 rounded-full border border-current opacity-10" />
              <span className="absolute h-24 w-24 rounded-full border border-current opacity-20" />
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
                {artPaths.map((d) => (
                  <path key={d} d={d} />
                ))}
              </svg>
            </div>
          ) : null}
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="line-clamp-3 text-[17px] font-semibold leading-snug text-textPrimary transition-colors hover:text-accentBright focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
          >
            {title}
          </a>
          {excerpt && <p className="line-clamp-2 text-[12.5px] leading-relaxed text-textSecondary">{excerpt}</p>}
          {meter && (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-baseline justify-between gap-2 text-[11px]">
                <span className="text-textMuted">{meter.label}</span>
                <span className="font-semibold tabular-nums text-textSecondary">{meter.value}</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.05]">
                <div
                  className={`h-full rounded-full bg-gradient-to-r ${t.bar}`}
                  style={{ width: `${Math.min(100, Math.max(2, meter.pct))}%` }}
                />
              </div>
            </div>
          )}
          {stats && stats.length > 0 && (
            <dl className="grid gap-2" style={{ gridTemplateColumns: `repeat(${stats.length}, minmax(0, 1fr))` }}>
              {stats.map((st) => (
                <div key={st.label} className="rounded-lg bg-bg/70 px-3 py-2.5">
                  <dd className="truncate text-xl font-semibold tabular-nums text-textPrimary" title={st.value}>{st.value}</dd>
                  <dt className="mt-0.5 flex items-center gap-1 text-[11px] text-textMuted">
                    {st.icon}
                    {st.label}
                  </dt>
                </div>
              ))}
            </dl>
          )}
          {byline && (
            <div className="mt-auto flex items-center gap-2 border-t border-border pt-3">
              <span
                aria-hidden="true"
                className={`flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${t.chip}`}
              >
                {byline.name.charAt(0).toUpperCase()}
              </span>
              <span className="min-w-0 truncate text-[11.5px] text-textMuted">
                {bylineVerb} <span className="font-medium text-textSecondary">{byline.name}</span>
                {byline.timeLabel && <> · {byline.timeLabel}</>}
              </span>
            </div>
          )}
        </>
      ) : (
        <span className="text-[12px] text-textMuted">{emptyText}</span>
      )}
    </article>
  );
}
