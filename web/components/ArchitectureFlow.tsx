function ArrowIcon() {
  return (
    <svg width="26" height="14" viewBox="0 0 26 14" fill="none" stroke="currentColor" strokeWidth={2} className="text-border">
      <path d="M0 7h22M17 2l6 5-6 5" />
    </svg>
  );
}

export function ArchitectureFlow() {
  return (
    <section id="architecture" className="rounded-lg border border-border bg-surface/75 backdrop-blur-md px-8 py-9 flex flex-col gap-6">
      <span className="text-center font-heading text-[17px] font-semibold text-textPrimary">
        Kiến trúc trong một dòng
      </span>
      <div className="flex items-center justify-center gap-3.5 flex-wrap">
        <div className="rounded-lg border border-border bg-bg px-4 py-3.5 flex flex-col items-center gap-1 w-[120px] transition-transform hover:scale-[1.01]">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#06B6D4" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" />
            <path d="M12 8v7M9 12l3 3 3-3" />
          </svg>
          <span className="text-[11.5px] text-textPrimary">HN · News</span>
          <span className="text-[11.5px] text-textPrimary">Weather · Crypto</span>
          <span className="text-[11.5px] text-textPrimary">GitHub</span>
        </div>
        <ArrowIcon />
        <div className="rounded-lg border border-border bg-bg px-[18px] py-3.5 text-center w-[160px] transition-transform hover:scale-[1.01]">
          <div className="flex flex-col items-center gap-1.5">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#10B981" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="4" width="18" height="4" rx="1" />
              <path d="M5 8v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8" />
              <path d="M10 13h4" />
            </svg>
            <span className="font-mono text-[11.5px] text-textPrimary">S3 raw → curated</span>
          </div>
        </div>
        <ArrowIcon />
        <div className="rounded-lg border border-border bg-bg px-[18px] py-3.5 text-center w-[160px] transition-transform hover:scale-[1.01]">
          <div className="flex flex-col items-center gap-1.5">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#06B6D4" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
              <circle cx="10.5" cy="10.5" r="6.5" />
              <path d="M20 20l-4.35-4.35" />
            </svg>
            <span className="font-mono text-[11.5px] text-textPrimary">Glue Catalog + Athena</span>
          </div>
        </div>
        <ArrowIcon />
        <div className="rounded-lg border border-secondary bg-bg px-[18px] py-3.5 text-center w-[170px] shadow-glowIndigo transition-transform hover:scale-[1.01]">
          <div className="flex flex-col items-center gap-1.5">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#8B5CF6" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
            </svg>
            <span className="font-mono text-[11.5px] text-secondaryBright">Agentic RAG</span>
          </div>
        </div>
      </div>
    </section>
  );
}
