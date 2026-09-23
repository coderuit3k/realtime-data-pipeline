import Link from "next/link";
import type { ReactNode } from "react";
import {
  DATA_SOURCE_COUNT,
  LAMBDA_COUNT,
  TEST_COUNT,
  MONTHLY_COST_USD,
  WEATHER_LOCATION_COUNT,
} from "@/lib/landingMeta";

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

function FeatureCard({ icon, title, description }: { icon: ReactNode; title: string; description: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface px-6 py-[22px] flex flex-col gap-2">
      {icon}
      <span className="text-sm font-semibold text-textPrimary">{title}</span>
      <span className="text-[12.5px] leading-relaxed text-textSecondary">{description}</span>
    </div>
  );
}

export default function LandingPage() {
  return (
    <div className="flex flex-col">
      <header className="h-[76px] flex-shrink-0 flex items-center justify-between px-14 border-b border-border">
        <div className="flex items-center gap-2.5">
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-accent"
          >
            <path d="M13 2 3 14h8l-1 8 10-12h-8l1-8z" />
          </svg>
          <span className="font-heading text-base font-bold text-textPrimary">DataPulse</span>
        </div>
        <nav className="flex items-center gap-7">
          <a href="#architecture" className="text-[13px] text-textSecondary">
            Kiến trúc
          </a>
          <a href="#features" className="text-[13px] text-textSecondary">
            Tính năng
          </a>
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noreferrer"
            className="rounded-lg border border-border px-4 py-2 text-[12.5px] text-textSecondary"
          >
            Mã nguồn
          </a>
          <Link href="/dashboard" className="rounded-lg bg-accent px-4 py-2 text-[12.5px] font-semibold text-bg">
            Xem demo →
          </Link>
        </nav>
      </header>

      <section className="px-14 pt-[88px] pb-16 flex flex-col items-center text-center gap-5 border-b border-border">
        <span className="font-mono text-[11px] tracking-wide text-accent bg-accent/10 px-3.5 py-1.5 rounded-full">
          PORTFOLIO PROJECT · DATA ENGINEERING
        </span>
        <h1 className="max-w-3xl font-heading text-[44px] leading-[1.15] font-bold text-textPrimary">
          Pipeline dữ liệu real-time, serverless, chạy thật trên AWS
        </h1>
        <p className="max-w-xl text-[15px] leading-relaxed text-textSecondary">
          {DATA_SOURCE_COUNT} nguồn dị chủng đổ về S3 → Glue/Athena, cộng 2 kiến trúc RAG song song trên Bedrock —
          một pipeline cố định (CRAG) và một agent tự quyết định gọi tool. Toàn bộ hạ tầng bằng Terraform, deploy
          qua GitHub Actions với gate phê duyệt production.
        </p>
        <div className="flex gap-3 mt-1.5">
          <Link href="/dashboard" className="rounded-lg bg-accent px-6 py-3 text-[13.5px] font-semibold text-bg">
            Xem demo nội bộ →
          </Link>
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noreferrer"
            className="rounded-lg border border-border px-6 py-3 text-[13.5px] text-textPrimary"
          >
            Xem trên GitHub
          </a>
        </div>
        <div className="flex gap-10 mt-6">
          <div className="flex flex-col items-center">
            <span className="font-mono text-xl text-textPrimary">{DATA_SOURCE_COUNT}</span>
            <span className="text-[11px] text-textMuted">nguồn dữ liệu</span>
          </div>
          <div className="flex flex-col items-center">
            <span className="font-mono text-xl text-textPrimary">{LAMBDA_COUNT}</span>
            <span className="text-[11px] text-textMuted">Lambda serverless</span>
          </div>
          <div className="flex flex-col items-center">
            <span className="font-mono text-xl text-textPrimary">{TEST_COUNT}</span>
            <span className="text-[11px] text-textMuted">test tự động</span>
          </div>
          <div className="flex flex-col items-center">
            <span className="font-mono text-xl text-textPrimary">${MONTHLY_COST_USD.toFixed(0)}</span>
            <span className="text-[11px] text-textMuted">chi phí / tháng</span>
          </div>
        </div>
      </section>

      <section id="architecture" className="px-14 py-[52px] flex flex-col gap-6 border-b border-border">
        <span className="text-center font-heading text-[19px] font-semibold text-textPrimary">
          Kiến trúc trong một dòng
        </span>
        <div className="flex items-center justify-center gap-3.5 flex-wrap">
          <div className="rounded-lg border border-border bg-surface px-4 py-3.5 flex flex-col items-center gap-1 w-[120px]">
            <span className="text-[11.5px] text-textPrimary">HN · News</span>
            <span className="text-[11.5px] text-textPrimary">Weather · Crypto</span>
            <span className="text-[11.5px] text-textPrimary">GitHub</span>
          </div>
          <ArrowIcon />
          <div className="rounded-lg border border-border bg-surface px-[18px] py-3.5 text-center w-[160px]">
            <span className="font-mono text-[11.5px] text-textPrimary">S3 raw → curated</span>
          </div>
          <ArrowIcon />
          <div className="rounded-lg border border-border bg-surface px-[18px] py-3.5 text-center w-[160px]">
            <span className="font-mono text-[11.5px] text-textPrimary">Glue Catalog + Athena</span>
          </div>
          <ArrowIcon />
          <div className="rounded-lg border border-accent bg-surface px-[18px] py-3.5 text-center w-[170px]">
            <span className="font-mono text-[11.5px] text-accent">RAG: CRAG + Agent</span>
          </div>
        </div>
      </section>

      <section id="features" className="px-14 py-[52px] grid grid-cols-2 gap-4 border-b border-border">
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
          icon={
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#06B6D4" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
            </svg>
          }
          title="RAG kép: CRAG + Agentic"
          description="So sánh trực tiếp pipeline CRAG cố định với một agent thật tự gọi tool qua Bedrock Converse API."
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

      <section className="px-14 py-10 flex flex-col items-center gap-4 flex-grow">
        <span className="font-mono text-[10.5px] tracking-wide text-textMuted">TECH STACK</span>
        <div className="flex flex-wrap gap-2 justify-center max-w-3xl">
          {TECH_STACK.map((tech) => (
            <span
              key={tech}
              className="font-mono text-[11px] px-3 py-1.5 rounded-lg bg-surface border border-border text-textSecondary"
            >
              {tech}
            </span>
          ))}
        </div>
        <p className="mt-[18px] text-[11.5px] text-textMuted">Xây dựng để ứng tuyển vị trí Data Engineer Intern · 2026</p>
      </section>
    </div>
  );
}
