import type { PipelineStage } from "@/lib/types";

const COLORS: Record<string, { ring: string; bg: string; text: string }> = {
  success: { ring: "border-success", bg: "bg-success/10", text: "text-success" },
  waiting: { ring: "border-warning", bg: "bg-warning/10", text: "text-warning" },
  in_progress: { ring: "border-accent", bg: "bg-accent/10", text: "text-accent" },
  failure: { ring: "border-error", bg: "bg-error/10", text: "text-error" },
  cancelled: { ring: "border-textMuted", bg: "bg-textMuted/10", text: "text-textMuted" },
  skipped: { ring: "border-textMuted", bg: "bg-textMuted/10", text: "text-textMuted" },
};
// Unknown statuses (e.g. "pending") fall through to a neutral style.
const NEUTRAL = { ring: "border-border", bg: "bg-surface", text: "text-textMuted" };

const STATUS_LABEL: Record<string, string> = {
  success: "Thành công",
  waiting: "Chờ phê duyệt",
  in_progress: "Đang chạy",
  failure: "Thất bại",
  cancelled: "Đã huỷ",
  skipped: "Bỏ qua",
  pending: "Chưa chạy",
};

function StageIcon({ stage, index }: { stage: PipelineStage; index: number }) {
  const { text } = COLORS[stage.status] ?? NEUTRAL;
  const svg = (children: React.ReactNode, extra = "") => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className={`${text} ${extra}`} aria-hidden="true">
      {children}
    </svg>
  );
  if (stage.status === "success") return svg(<path d="M20 6 9 17l-5-5" />);
  if (stage.status === "in_progress") return svg(<path d="M21 12a9 9 0 1 1-9-9" />, "animate-spin motion-reduce:animate-none");
  if (stage.status === "waiting")
    return svg(
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3.5 2" />
      </>,
    );
  if (stage.status === "failure" || stage.status === "cancelled" || stage.status === "skipped") return svg(<path d="M18 6 6 18M6 6l12 12" />);
  // Not-started stages show their step number rather than a status icon.
  return <span className={`text-xs font-semibold ${text}`}>{index + 1}</span>;
}

/** Vertical on mobile, horizontal from md; the waiting stage carries the approve link. */
export function StageTimeline({ stages, approveUrl }: { stages: PipelineStage[]; approveUrl: string | null }) {
  return (
    <ol className="flex flex-col md:flex-row">
      {stages.map((stage, i) => {
        const colors = COLORS[stage.status] ?? NEUTRAL;
        const prevDone = i > 0 && stages[i - 1].status === "success";
        const done = stage.status === "success";
        const isLast = i === stages.length - 1;
        return (
          <li key={stage.name} className="flex flex-1 gap-4 md:flex-col md:items-center md:gap-3">
            <div className="flex flex-col items-center md:w-full md:flex-row">
              <span className={`h-2 w-0.5 md:h-0.5 md:w-auto md:flex-1 ${i === 0 ? "invisible" : ""} ${prevDone ? "bg-success/50" : "bg-border"}`} />
              <span
                className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full border ${colors.ring} ${colors.bg} ${
                  stage.status === "waiting" ? "shadow-[0_0_14px_rgba(245,158,11,0.35)]" : ""
                }`}
              >
                <StageIcon stage={stage} index={i} />
              </span>
              <span className={`min-h-4 w-0.5 flex-1 md:h-0.5 md:min-h-0 md:w-auto ${isLast ? "invisible" : ""} ${done ? "bg-success/50" : "bg-border"}`} />
            </div>
            <div className="flex flex-col pb-3 md:items-center md:pb-0 md:text-center">
              <span className="text-[13px] font-semibold text-textPrimary">{stage.name}</span>
              <span className={`text-[12px] ${colors.text}`}>{STATUS_LABEL[stage.status] ?? stage.status}</span>
              {stage.detail && <span className="text-[11.5px] text-textMuted">{stage.detail}</span>}
              {stage.status === "waiting" && approveUrl && (
                <a
                  href={approveUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 w-fit rounded-lg bg-warning px-3.5 py-1.5 text-[12px] font-semibold text-bg transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-warning"
                >
                  Phê duyệt trên GitHub
                </a>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
