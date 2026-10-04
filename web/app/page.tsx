"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { DATA_SOURCE_COUNT, LAMBDA_COUNT, TEST_COUNT, MONTHLY_COST_USD } from "@/lib/landingMeta";
import type { CommitsResponse, GithubCommit, LogEntry } from "@/lib/types";
import { relativeTime } from "@/lib/time";
import { ArchitectureFlow } from "@/components/ArchitectureFlow";
import { LogPanel } from "@/components/LogPanel";

const GITHUB_URL = "https://github.com/coderuit3k/realtime-data-pipeline";

/** Shared SVG frame so each tech-stack entry only supplies its paths. */
function TechIcon({ children }: { children: ReactNode }) {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="text-accent flex-shrink-0">
      {children}
    </svg>
  );
}

const TECH_STACK: { name: string; icon: ReactNode }[] = [
  {
    name: "Python",
    icon: (
      <TechIcon>
        <polyline points="16 18 22 12 16 6" />
        <polyline points="8 6 2 12 8 18" />
      </TechIcon>
    ),
  },
  {
    name: "Terraform",
    icon: (
      <TechIcon>
        <polygon points="12 2 2 7 12 12 22 7 12 2" />
        <polyline points="2 17 12 22 22 17" />
        <polyline points="2 12 12 17 22 12" />
      </TechIcon>
    ),
  },
  {
    name: "AWS Lambda",
    icon: (
      <TechIcon>
        <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" />
      </TechIcon>
    ),
  },
  {
    name: "S3",
    icon: (
      <TechIcon>
        <rect x="3" y="4" width="18" height="4" rx="1" />
        <path d="M5 8v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8" />
        <path d="M10 13h4" />
      </TechIcon>
    ),
  },
  {
    name: "Glue",
    icon: (
      <TechIcon>
        <path d="M9 17H7A5 5 0 0 1 7 7h2M15 7h2a5 5 0 1 1 0 10h-2M8 12h8" />
      </TechIcon>
    ),
  },
  {
    name: "Athena",
    icon: (
      <TechIcon>
        <circle cx="10.5" cy="10.5" r="6.5" />
        <path d="M20 20l-4.35-4.35" />
      </TechIcon>
    ),
  },
  {
    name: "Bedrock",
    icon: (
      <TechIcon>
        <path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
      </TechIcon>
    ),
  },
  {
    name: "GitHub Actions",
    icon: (
      <TechIcon>
        <line x1="6" y1="3" x2="6" y2="15" />
        <circle cx="18" cy="6" r="3" />
        <circle cx="6" cy="18" r="3" />
        <path d="M18 9a9 9 0 0 1-9 9" />
      </TechIcon>
    ),
  },
  {
    name: "Next.js",
    icon: (
      <TechIcon>
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <path d="M3 9h18" />
      </TechIcon>
    ),
  },
  {
    name: "TypeScript",
    icon: (
      <TechIcon>
        <path d="M8 3a2 2 0 0 0-2 2v3a2 2 0 0 1-2 2 2 2 0 0 1 2 2v3a2 2 0 0 0 2 2" />
        <path d="M16 3a2 2 0 0 1 2 2v3a2 2 0 0 0 2 2 2 2 0 0 0-2 2v3a2 2 0 0 1-2 2" />
      </TechIcon>
    ),
  },
  {
    name: "Vercel",
    icon: (
      <TechIcon>
        <path d="M12 3 22 20H2Z" />
      </TechIcon>
    ),
  },
];

function FeatureCard({ icon, title, accent = "cyan" }: { icon: ReactNode; title: string; accent?: "cyan" | "indigo" }) {
  return (
    <div
      className={`rounded-xl border bg-surface/75 backdrop-blur-md px-5 py-5 flex items-center gap-4 transition-colors hover:border-accent/30 ${
        accent === "indigo" ? "border-secondary/25" : "border-border"
      }`}
    >
      <span className="w-11 h-11 flex-shrink-0 rounded-lg bg-bg flex items-center justify-center">{icon}</span>
      <span className="text-[15px] font-semibold text-textPrimary leading-snug">{title}</span>
    </div>
  );
}

const PIPELINE_SOURCES = ["Hacker News", "News", "Weather", "Crypto", "GitHub"];

/** Vertical 16px connector with a dot travelling downwards (hidden under reduced motion). */
function FlowConnector() {
  return (
    <div className="relative mx-auto h-4 w-px bg-border">
      <span className="absolute -left-[2.5px] top-0 h-1.5 w-1.5 rounded-full bg-accentBright shadow-glowCyan animate-flowDotY motion-reduce:hidden" />
    </div>
  );
}

function PipelineNode({ label, color, icon }: { label: string; color: string; icon: ReactNode }) {
  return (
    <div className="flex items-center justify-center gap-2.5 rounded-lg border border-border bg-bg/80 px-4 py-2.5 text-[13px] font-medium text-textPrimary">
      <span style={{ color }}>{icon}</span>
      {label}
    </div>
  );
}

/** Compact live-looking pipeline for the hero: sources fan in, then S3 -> Athena -> Bedrock. */
function PipelineVisual() {
  const svg = (children: ReactNode) => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
  return (
    <div className="flex flex-col gap-0 rounded-xl border border-border bg-surface/60 p-5" aria-label="Luồng dữ liệu: nguồn, S3, Athena, Bedrock" role="img">
      <div className="flex flex-wrap justify-center gap-1.5">
        {PIPELINE_SOURCES.map((name) => (
          <span key={name} className="flex items-center gap-1.5 rounded-full bg-white/[0.05] px-2.5 py-1 text-[11.5px] text-textSecondary">
            <span className="h-1.5 w-1.5 rounded-full bg-accent" />
            {name}
          </span>
        ))}
      </div>
      <FlowConnector />
      <PipelineNode label="S3 raw → curated" color="#10B981" icon={svg(<><rect x="3" y="4" width="18" height="4" rx="1" /><path d="M5 8v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8" /><path d="M10 13h4" /></>)} />
      <FlowConnector />
      <PipelineNode label="Glue + Athena" color="#06B6D4" icon={svg(<><circle cx="10.5" cy="10.5" r="6.5" /><path d="M20 20l-4.35-4.35" /></>)} />
      <FlowConnector />
      <div className="flex items-center justify-center gap-2.5 rounded-lg border border-secondary bg-bg/80 px-4 py-2.5 text-[13px] font-semibold text-secondaryBright shadow-glowIndigo">
        {svg(<path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />)}
        Agentic RAG
      </div>
    </div>
  );
}

const STATS: { value: string; label: string; color: string; path: ReactNode }[] = [
  {
    value: String(DATA_SOURCE_COUNT),
    label: "nguồn dữ liệu",
    color: "text-accent",
    path: (
      <>
        <path d="M12 3 2 8l10 5 10-5-10-5Z" />
        <path d="M2 12l10 5 10-5" />
        <path d="M2 16l10 5 10-5" />
      </>
    ),
  },
  { value: String(LAMBDA_COUNT), label: "Lambda serverless", color: "text-secondaryBright", path: <path d="M13 2 3 14h8l-1 8 10-12h-8l1-8z" /> },
  {
    value: String(TEST_COUNT),
    label: "test tự động",
    color: "text-success",
    path: (
      <>
        <path d="M12 3l7 3v5c0 4.5-3 8-7 9-4-1-7-4.5-7-9V6l7-3Z" />
        <path d="m9 12 2 2 4-4" />
      </>
    ),
  },
  {
    value: `$${MONTHLY_COST_USD.toFixed(0)}`,
    label: "chi phí / tháng",
    color: "text-accent",
    path: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M14.5 9.5c0-1.1-1.1-2-2.5-2s-2.5.8-2.5 1.9c0 2.6 5 1.4 5 4 0 1.1-1.1 1.9-2.5 1.9s-2.5-.9-2.5-2" />
        <path d="M12 6.5v1M12 16v1" />
      </>
    ),
  },
];

/** Renders nothing when empty, which doubles as the error state for /api/commits. */
function CommitsPanel({ commits }: { commits: GithubCommit[] }) {
  if (commits.length === 0) return null;
  return (
    <section className="rounded-xl border border-border bg-surface/75 backdrop-blur-md p-5 flex flex-col gap-3">
      <h2 className="text-[13px] font-semibold text-textPrimary">Commit gần đây</h2>
      <div className="flex flex-col gap-3">
        {commits.map((c) => (
          <a
            key={c.sha}
            href={c.htmlUrl}
            target="_blank"
            rel="noreferrer"
            className="flex flex-col gap-0.5 border-b border-border pb-3 last:border-0 last:pb-0 transition-colors hover:text-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
          >
            <span className="text-[12.5px] text-textSecondary leading-snug">{c.message}</span>
            <span className="text-[11.5px] text-textMuted">
              {c.authorName} · {c.sha.slice(0, 7)} · {relativeTime(c.date)}
            </span>
          </a>
        ))}
      </div>
    </section>
  );
}

/**
 * Public showcase page. Headline numbers are static constants; only the
 * commits and log side panels are fetched live, and either may fail without
 * affecting the rest of the page.
 */
export default function LandingPage() {
  const [commits, setCommits] = useState<GithubCommit[]>([]);
  const [logs, setLogs] = useState<LogEntry[] | null>(null);
  const [logsError, setLogsError] = useState(false);

  useEffect(() => {
    fetch("/api/commits")
      .then((res) => res.json().then((body) => ({ ok: res.ok, body })))
      .then(({ ok, body }: { ok: boolean; body: CommitsResponse }) => {
        if (ok) setCommits(body.commits);
      })
      .catch(() => {
        /* secondary panel: CommitsPanel simply stays hidden */
      });
  }, []);

  useEffect(() => {
    fetch("/api/ops")
      .then((res) => res.json().then((body) => ({ ok: res.ok, body })))
      .then(({ ok, body }) => {
        if (ok && Array.isArray(body?.recentLogs)) {
          setLogs(body.recentLogs);
        } else {
          setLogsError(true);
        }
      })
      .catch(() => {
        setLogsError(true);
      });
  }, []);

  return (
    <div className="flex flex-col gap-5 p-6 lg:p-9 xl:flex-row">
      <div className="flex min-w-0 flex-1 flex-col gap-5">
        <section className="grid items-center gap-8 rounded-xl border border-border bg-surface/75 px-6 py-8 backdrop-blur-md sm:px-10 sm:py-10 lg:grid-cols-[1.35fr_1fr]">
          <div className="flex flex-col items-start gap-5">
            <h1 className="font-heading text-[30px] font-bold leading-[1.15] tracking-tight text-textPrimary sm:text-[38px]">
              Pipeline dữ liệu real‑time, serverless, chạy thật trên AWS
            </h1>
            <p className="max-w-xl text-[14.5px] leading-relaxed text-textSecondary">
              {DATA_SOURCE_COUNT} nguồn dị chủng đổ về S3 → Glue/Athena, cộng một pipeline Agentic RAG thật trên Bedrock —
              tự quyết định gọi tool truy xuất dữ liệu đã ingest hoặc tìm trên web. Toàn bộ hạ tầng bằng Terraform,
              deploy qua GitHub Actions với gate phê duyệt production.
            </p>
            <div className="mt-1 flex flex-wrap gap-3">
              <Link
                href="/dashboard"
                className="rounded-lg bg-accent px-6 py-3 text-[13.5px] font-semibold text-bg transition-shadow hover:shadow-glowCyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-accentBright"
              >
                Xem demo nội bộ
              </Link>
              <a
                href={GITHUB_URL}
                target="_blank"
                rel="noreferrer"
                className="rounded-lg border border-border px-6 py-3 text-[13.5px] text-textPrimary transition-colors hover:border-borderStrong focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
              >
                Xem trên GitHub
              </a>
            </div>
          </div>
          <PipelineVisual />
        </section>

        <section className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-4">
          {STATS.map((st) => (
            <div key={st.label} className="flex items-center gap-3 bg-surface px-5 py-4">
              <span className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-bg ${st.color}`}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  {st.path}
                </svg>
              </span>
              <span className="flex flex-col">
                <span className="text-2xl font-semibold tabular-nums text-textPrimary">{st.value}</span>
                <span className="text-[11.5px] text-textMuted">{st.label}</span>
              </span>
            </div>
          ))}
        </section>

        <ArchitectureFlow />

        <section id="features" className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FeatureCard
            icon={
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#06B6D4" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
              </svg>
            }
            title={`${DATA_SOURCE_COUNT} nguồn dữ liệu dị chủng`}
          />
          <FeatureCard
            icon={
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#06B6D4" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="7" height="9" rx="1.5" />
                <rect x="14" y="3" width="7" height="5" rx="1.5" />
                <rect x="14" y="12" width="7" height="9" rx="1.5" />
                <rect x="3" y="16" width="7" height="5" rx="1.5" />
              </svg>
            }
            title="100% serverless trên AWS"
          />
          <FeatureCard
            accent="indigo"
            icon={
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#8B5CF6" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
              </svg>
            }
            title="Agentic RAG thật"
          />
          <FeatureCard
            icon={
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#06B6D4" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                <line x1="6" y1="3" x2="6" y2="15" />
                <circle cx="18" cy="6" r="3" />
                <circle cx="6" cy="18" r="3" />
                <path d="M18 9a9 9 0 0 1-9 9" />
              </svg>
            }
            title="IaC + CI/CD thật"
          />
        </section>

        <section className="flex flex-col items-center gap-4 py-4">
          <h2 className="text-[13px] font-medium text-textMuted">Công nghệ sử dụng</h2>
          <div className="flex max-w-3xl flex-wrap justify-center gap-2">
            {TECH_STACK.map((tech) => (
              <span
                key={tech.name}
                className="flex items-center gap-1.5 rounded-lg border border-border bg-surface/75 px-3 py-1.5 text-[12px] text-textSecondary backdrop-blur-md"
              >
                {tech.icon}
                {tech.name}
              </span>
            ))}
          </div>
        </section>
      </div>

      <div className="flex w-full flex-col gap-4 xl:w-[340px] xl:flex-shrink-0">
        <CommitsPanel commits={commits} />
        <LogPanel logs={logs} error={logsError} />
      </div>
    </div>
  );
}
