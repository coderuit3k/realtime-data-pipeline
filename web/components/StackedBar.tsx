export type BarSegment = { label: string; value: number; color: string };

type StackedBarProps = {
  segments: BarSegment[];
  /** Width of the whole bar as a percent of its container (default 100). */
  widthPct?: number;
  height?: number;
};

/** One horizontal bar split into proportional segments with a 2px gap; each segment has a hover title. */
export function StackedBar({ segments, widthPct = 100, height = 10 }: StackedBarProps) {
  const visible = segments.filter((s) => s.value > 0);
  const total = visible.reduce((sum, s) => sum + s.value, 0);
  return (
    <div className="w-full rounded-full bg-white/[0.04]" style={{ height }}>
      <div className="bar-grow flex h-full gap-[2px]" style={{ width: `${widthPct}%` }}>
        {visible.map((s, i) => (
          <div
            key={s.label}
            title={`${s.label}: ${s.value}`}
            className={`h-full ${i === 0 ? "rounded-l-full" : ""} ${i === visible.length - 1 ? "rounded-r-full" : ""}`}
            style={{ flexGrow: s.value / total, flexBasis: 0, backgroundColor: s.color }}
          />
        ))}
      </div>
    </div>
  );
}
