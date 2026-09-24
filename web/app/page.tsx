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

const GITHUB_URL = "https://github.com/coderuit3k/realtime-data-pipeline";

const TECH_STACK = [
  "Python",
  "Terraform",
  "AWS Lambda",
  "S3",
  "Glue",
  "Athena",
  "Bedrock",
  "GitHub Actions",
  "Next.js",
  "TypeScript",
  "Vercel",
];

function ArrowIcon() {
  return (
    <svg width="26" height="14" viewBox="0 0 26 14" fill="none" stroke="currentColor" strokeWidth={2} className="text-border">
      <path d="M0 7h22M17 2l6 5-6 5" />
    </svg>
  );
}

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
          <span className="font-mono text-[11px] tracking-wide text-accent bg-accent/10 px-3.5 py-1.5 rounded-full">
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
          <div className="rounded-lg border-t-2 border-t-accent border border-border bg-surface/75 backdrop-blur-md px-4 py-4 flex flex-col items-center gap-1">
            <span className="font-mono tabular-nums text-xl text-textPrimary">{DATA_SOURCE_COUNT}</span>
            <span className="text-[11px] text-textMuted">nguồn dữ liệu</span>
          </div>
          <div className="rounded-lg border-t-2 border-t-accent border border-border bg-surface/75 backdrop-blur-md px-4 py-4 flex flex-col items-center gap-1">
            <span className="font-mono tabular-nums text-xl text-textPrimary">{LAMBDA_COUNT}</span>
            <span className="text-[11px] text-textMuted">Lambda serverless</span>
          </div>
          <div className="rounded-lg border-t-2 border-t-accent border border-border bg-surface/75 backdrop-blur-md px-4 py-4 flex flex-col items-center gap-1">
            <span className="font-mono tabular-nums text-xl text-textPrimary">{TEST_COUNT}</span>
            <span className="text-[11px] text-textMuted">test tự động</span>
          </div>
          <div className="rounded-lg border-t-2 border-t-accent border border-border bg-surface/75 backdrop-blur-md px-4 py-4 flex flex-col items-center gap-1">
            <span className="font-mono tabular-nums text-xl text-textPrimary">${MONTHLY_COST_USD.toFixed(0)}</span>
            <span className="text-[11px] text-textMuted">chi phí / tháng</span>
          </div>
        </section>

        <section id="architecture" className="rounded-lg border border-border bg-surface/75 backdrop-blur-md px-8 py-9 flex flex-col gap-6">
          <span className="text-center font-heading text-[17px] font-semibold text-textPrimary">
            Kiến trúc trong một dòng
          </span>
          <div className="flex items-center justify-center gap-3.5 flex-wrap">
            <div className="rounded-lg border border-border bg-bg px-4 py-3.5 flex flex-col items-center gap-1 w-[120px]">
              <span className="text-[11.5px] text-textPrimary">HN · News</span>
              <span className="text-[11.5px] text-textPrimary">Weather · Crypto</span>
              <span className="text-[11.5px] text-textPrimary">GitHub</span>
            </div>
            <ArrowIcon />
            <div className="rounded-lg border border-border bg-bg px-[18px] py-3.5 text-center w-[160px]">
              <span className="font-mono text-[11.5px] text-textPrimary">S3 raw → curated</span>
            </div>
            <ArrowIcon />
            <div className="rounded-lg border border-border bg-bg px-[18px] py-3.5 text-center w-[160px]">
              <span className="font-mono text-[11.5px] text-textPrimary">Glue Catalog + Athena</span>
            </div>
            <ArrowIcon />
            <div className="rounded-lg border border-secondary bg-bg px-[18px] py-3.5 text-center w-[170px] shadow-glowIndigo">
              <span className="font-mono text-[11.5px] text-secondaryBright">Agentic RAG</span>
            </div>
          </div>
        </section>

        <section id="features" className="grid grid-cols-2 gap-4">
          <FeatureCard
            icon={
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#06B6D4" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
              </svg>
            }
            title={`${DATA_SOURCE_COUNT} nguồn dữ liệu dị chủng`}
            description={`Hacker News, News API, thời tiết Open-Meteo (${WEATHER_LOCATION_COUNT} khu vực), giá crypto CoinGecko, GitHub trending — ingest mỗi 10-20 phút tuỳ nguồn.`}
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
                key={tech}
                className="font-mono text-[11px] px-3 py-1.5 rounded-lg bg-surface/75 backdrop-blur-md border border-border text-textSecondary"
              >
                {tech}
              </span>
            ))}
          </div>
          <p className="mt-[6px] text-[11.5px] text-textMuted">Xây dựng để ứng tuyển vị trí Data Engineer Intern · 2026</p>
        </section>
      </div>

      <div className="flex-1 min-w-0 flex flex-col gap-4 min-h-0">
        <CommitsPanel commits={commits} />

        <div className="flex-1 rounded-lg border border-border bg-surface/75 backdrop-blur-md px-4 py-4 flex flex-col gap-2 min-h-0 overflow-auto">
          <span className="text-xs font-semibold text-textPrimary">Log gần đây</span>
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
