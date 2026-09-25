"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import {
  DATA_SOURCE_COUNT,
  LAMBDA_COUNT,
  TEST_COUNT,
  MONTHLY_COST_USD,
  WEATHER_LOCATION_COUNT,
} from "@/lib/landingMeta";
import type { CommitsResponse, GithubCommit, LogEntry } from "@/lib/types";
import { LiveBadge } from "@/components/LiveBadge";
import { ArchitectureFlow } from "@/components/ArchitectureFlow";

const GITHUB_URL = "https://github.com/coderuit3k/realtime-data-pipeline";

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

function FeatureCard({ icon, title, description, accent = "cyan" }: { icon: ReactNode; title: string; description: string; accent?: "cyan" | "indigo" }) {
  return (
    <div
      className={`rounded-lg border bg-surface/75 backdrop-blur-md px-6 py-[22px] flex flex-col gap-2 ${
        accent === "indigo" ? "border-secondary/25" : "border-border"
      }`}
    >
      {icon}
      <span className="text-sm font-semibold text-textPrimary">{title}</span>
      <span className="text-[12.5px] leading-relaxed text-textSecondary">{description}</span>
    </div>
  );
}

function relativeTime(iso: string, now: Date = new Date()): string {
  const diffMs = now.getTime() - new Date(iso).getTime();
  const minutes = Math.max(0, Math.round(diffMs / 60000));
  if (minutes < 1) return "vừa xong";
  if (minutes < 60) return `${minutes} phút trước`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} giờ trước`;
  return `${Math.round(hours / 24)} ngày trước`;
}

function detectLogLevel(message: string): "ERROR" | "WARN" | "INFO" {
  const match = message.match(/\b(ERROR|WARN(?:ING)?|INFO)\b/);
  if (!match) return "INFO";
  return match[1] === "WARNING" ? "WARN" : (match[1] as "ERROR" | "WARN" | "INFO");
}

function logLevelColor(level: "ERROR" | "WARN" | "INFO"): string {
  if (level === "ERROR") return "text-error";
  if (level === "WARN") return "text-warning";
  return "text-accent";
}

function CommitsPanel({ commits }: { commits: GithubCommit[] }) {
  if (commits.length === 0) return null;
  return (
    <div className="rounded-lg border border-border bg-surface/75 backdrop-blur-md px-4 py-4 flex flex-col gap-2.5">
      <span className="text-xs font-semibold text-textPrimary">Commit gần đây</span>
      <div className="flex flex-col gap-2.5">
        {commits.map((c) => (
          <a
            key={c.sha}
            href={c.htmlUrl}
            target="_blank"
            rel="noreferrer"
            className="flex flex-col gap-0.5 border-b border-border pb-2.5 last:border-0 last:pb-0"
          >
            <span className="text-[12px] text-textSecondary leading-snug">{c.message}</span>
            <span className="font-mono text-[10.5px] text-textMuted">
              {c.authorName} · {c.sha.slice(0, 7)} · {relativeTime(c.date)}
            </span>
          </a>
        ))}
      </div>
    </div>
  );
}

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
        /* commits panel is secondary -- CommitsPanel hides itself when empty */
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
    <div className="flex gap-4 p-9">
      <div className="flex-[2.6] min-w-0 flex flex-col gap-5">
        <section className="rounded-lg border border-border bg-surface/75 backdrop-blur-md px-10 py-12 flex flex-col items-center text-center gap-5">
          <span className="flex items-center gap-2 font-mono text-[11px] tracking-wide text-accent bg-accent/10 px-3.5 py-1.5 rounded-full">
            <span className="w-1.5 h-1.5 rounded-full bg-accent animate-ping motion-reduce:animate-none" />
            PORTFOLIO PROJECT · DATA ENGINEERING
          </span>
          <h1 className="max-w-3xl font-heading text-[40px] leading-[1.15] font-bold text-textPrimary">
            Pipeline dữ liệu real-time, serverless, chạy thật trên AWS
          </h1>
          <p className="max-w-xl text-[14.5px] leading-relaxed text-textSecondary">
            {DATA_SOURCE_COUNT} nguồn dị chủng đổ về S3 → Glue/Athena, cộng một pipeline Agentic RAG thật trên Bedrock —
            tự quyết định gọi tool truy xuất dữ liệu đã ingest hoặc tìm trên web. Toàn bộ hạ tầng bằng Terraform,
            deploy qua GitHub Actions với gate phê duyệt production.
          </p>
          <div className="flex gap-3 mt-1.5">
            <Link
              href="/dashboard"
              className="rounded-lg bg-accent px-6 py-3 text-[13.5px] font-semibold text-bg transition-shadow hover:shadow-glowCyan"
            >
              Xem demo nội bộ →
            </Link>
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noreferrer"
              className="rounded-lg border border-border px-6 py-3 text-[13.5px] text-textPrimary transition-colors hover:border-borderStrong"
            >
              Xem trên GitHub
            </a>
          </div>
        </section>

        <section className="grid grid-cols-4 gap-4">
          <div className="rounded-lg border-t-2 border-t-accent border border-border bg-surface/75 backdrop-blur-md px-4 py-4 flex items-center gap-3 transition-transform hover:scale-[1.01]">
            <span className="w-8 h-8 flex-shrink-0 rounded-md bg-bg flex items-center justify-center text-accent">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 3 2 8l10 5 10-5-10-5Z" />
                <path d="M2 12l10 5 10-5" />
                <path d="M2 16l10 5 10-5" />
              </svg>
            </span>
            <span className="flex flex-col gap-0.5">
              <span className="font-mono tabular-nums text-xl text-textPrimary">{DATA_SOURCE_COUNT}</span>
              <span className="text-[11px] text-textMuted">nguồn dữ liệu</span>
            </span>
          </div>
          <div className="rounded-lg border-t-2 border-t-accent border border-border bg-surface/75 backdrop-blur-md px-4 py-4 flex items-center gap-3 transition-transform hover:scale-[1.01]">
            <span className="w-8 h-8 flex-shrink-0 rounded-md bg-bg flex items-center justify-center text-secondaryBright">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                <path d="M13 2 3 14h8l-1 8 10-12h-8l1-8z" />
              </svg>
            </span>
            <span className="flex flex-col gap-0.5">
              <span className="font-mono tabular-nums text-xl text-textPrimary">{LAMBDA_COUNT}</span>
              <span className="text-[11px] text-textMuted">Lambda serverless</span>
            </span>
          </div>
          <div className="rounded-lg border-t-2 border-t-accent border border-border bg-surface/75 backdrop-blur-md px-4 py-4 flex items-center gap-3 transition-transform hover:scale-[1.01]">
            <span className="w-8 h-8 flex-shrink-0 rounded-md bg-bg flex items-center justify-center text-success">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 3l7 3v5c0 4.5-3 8-7 9-4-1-7-4.5-7-9V6l7-3Z" />
                <path d="m9 12 2 2 4-4" />
              </svg>
            </span>
            <span className="flex flex-col gap-0.5">
              <span className="font-mono tabular-nums text-xl text-textPrimary">{TEST_COUNT}</span>
              <span className="text-[11px] text-textMuted">test tự động</span>
            </span>
          </div>
          <div className="rounded-lg border-t-2 border-t-accent border border-border bg-surface/75 backdrop-blur-md px-4 py-4 flex items-center gap-3 transition-transform hover:scale-[1.01]">
            <span className="w-8 h-8 flex-shrink-0 rounded-md bg-bg flex items-center justify-center text-accent">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="9" />
                <path d="M14.5 9.5c0-1.1-1.1-2-2.5-2s-2.5.8-2.5 1.9c0 2.6 5 1.4 5 4 0 1.1-1.1 1.9-2.5 1.9s-2.5-.9-2.5-2" />
                <path d="M12 6.5v1M12 16v1" />
              </svg>
            </span>
            <span className="flex flex-col gap-0.5">
              <span className="font-mono tabular-nums text-xl text-textPrimary">${MONTHLY_COST_USD.toFixed(0)}</span>
              <span className="text-[11px] text-textMuted">chi phí / tháng</span>
            </span>
          </div>
        </section>

        <ArchitectureFlow />

        <section id="features" className="grid grid-cols-2 gap-4">
          <FeatureCard
            icon={
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#06B6D4" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
              </svg>
            }
            title={`${DATA_SOURCE_COUNT} nguồn dữ liệu dị chủng`}
            description={`Hacker News, News API, thời tiết Open-Meteo (${WEATHER_LOCATION_COUNT} khu vực), giá crypto CoinGecko, GitHub trending — ingest mỗi 30 phút.`}
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
            description="Lambda, EventBridge, S3, Glue, Athena — không quản lý server, không crawler, partition projection."
          />
          <FeatureCard
            accent="indigo"
            icon={
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#8B5CF6" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
              </svg>
            }
            title="Agentic RAG thật"
            description="Agent tự quyết định gọi tool search_knowledge_base hoặc search_web (Tavily) qua Bedrock Converse API, không phải pipeline retrieve → generate cố định."
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
            description={`Terraform 2-stack, GitHub Actions qua OIDC, gate phê duyệt thủ công trước khi apply production, ${TEST_COUNT} test tự động.`}
          />
        </section>

        <section className="flex flex-col items-center gap-4 py-4">
          <span className="font-mono text-[10.5px] tracking-wide text-textMuted">TECH STACK</span>
          <div className="flex flex-wrap gap-2 justify-center max-w-3xl">
            {TECH_STACK.map((tech) => (
              <span
                key={tech.name}
                className="flex items-center gap-1.5 font-mono text-[11px] px-3 py-1.5 rounded-lg bg-surface/75 backdrop-blur-md border border-border text-textSecondary"
              >
                {tech.icon}
                {tech.name}
              </span>
            ))}
          </div>
          <p className="mt-[6px] text-[11.5px] text-textMuted">Xây dựng để ứng tuyển vị trí Data Engineer Intern · 2026</p>
        </section>
      </div>

      <div className="flex-1 min-w-0 flex flex-col gap-4 min-h-0">
        <CommitsPanel commits={commits} />

        <div className="flex-1 rounded-lg border border-border bg-surface/75 backdrop-blur-md px-4 py-4 flex flex-col gap-2 min-h-0 overflow-auto">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-error/70" />
              <span className="w-2.5 h-2.5 rounded-full bg-warning/70" />
              <span className="w-2.5 h-2.5 rounded-full bg-success/70" />
              <span className="ml-1 text-xs font-semibold text-textPrimary">Log gần đây</span>
            </div>
            <LiveBadge status="ok" label="LIVE" />
          </div>
          <div className="font-mono flex flex-col gap-1.5 text-[10.5px] text-textMuted">
            {logs === null && !logsError && <span>Đang tải log…</span>}
            {logsError && <span>Không tải được log.</span>}
            {logs !== null && logs.length === 0 && <span>Chưa có log trong 24h qua.</span>}
            {logs !== null &&
              logs.map((log, i) => {
                const level = detectLogLevel(log.message);
                return (
                  <span key={i} className="break-all">
                    <span className={logLevelColor(level)}>{level}</span> {log.source}: {log.message}
                  </span>
                );
              })}
          </div>
        </div>
      </div>
    </div>
  );
}
