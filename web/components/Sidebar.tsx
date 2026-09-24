"use client";

import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { HealthResponse } from "@/lib/types";

type NavLink = { href: string; label: string; icon: ReactNode };

const NAV_LINKS: NavLink[] = [
  {
    href: "/",
    label: "Showcase & Overview",
    icon: (
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
        <path d="M13 2 3 14h8l-1 8 10-12h-8l1-8z" />
      </svg>
    ),
  },
  {
    href: "/dashboard",
    label: "Live Metrics & Ops",
    icon: (
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="7" height="9" rx="1.5" />
        <rect x="14" y="3" width="7" height="5" rx="1.5" />
        <rect x="14" y="12" width="7" height="9" rx="1.5" />
        <rect x="3" y="16" width="7" height="5" rx="1.5" />
      </svg>
    ),
  },
  {
    href: "/assistant",
    label: "RAG Comparison Studio",
    icon: (
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
      </svg>
    ),
  },
  {
    href: "/catalog",
    label: "Architecture & Lakehouse",
    icon: (
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <path d="M3 10h18M9 4v16" />
      </svg>
    ),
  },
];

// Temporary secondary nav for pages the 4-item IA collapse (an earlier
// task on this branch) silently dropped: /cicd, /explorer, and
// /insights are real, fully-working pages with real data -- not part of
// the intentional settings/weather removal. Keep them reachable here
// until later sub-projects fold their content into the 4-item IA, then
// delete this group.
const LEGACY_LINKS: NavLink[] = [
  {
    href: "/cicd",
    label: "CI/CD",
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
        <line x1="6" y1="3" x2="6" y2="15" />
        <circle cx="18" cy="6" r="3" />
        <circle cx="6" cy="18" r="3" />
        <path d="M18 9a9 9 0 0 1-9 9" />
      </svg>
    ),
  },
  {
    href: "/explorer",
    label: "Data Explorer",
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <path d="m7 9 3 3-3 3M13 15h4" />
      </svg>
    ),
  },
  {
    href: "/insights",
    label: "Insights",
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 17 9 11 13 15 21 7M21 7h-6M21 7v6" />
      </svg>
    ),
  },
];

function SidebarLink({ link, active }: { link: NavLink; active: boolean }) {
  return (
    <Link
      href={link.href}
      aria-current={active ? "page" : undefined}
      className={`flex items-center gap-3 px-3 py-2 rounded-lg text-[13px] border ${
        active
          ? "bg-accent/[0.12] text-accent font-semibold border-accent/30 shadow-glowCyan"
          : "text-textSecondary font-medium border-transparent"
      }`}
    >
      {link.icon}
      <span>{link.label}</span>
    </Link>
  );
}

function statusDotColor(health: HealthResponse | null): { dot: string; pulse: boolean } {
  if (!health) return { dot: "bg-textMuted", pulse: false };
  return health.sourcesHealthy === health.sourcesTotal
    ? { dot: "bg-success", pulse: true }
    : { dot: "bg-warning", pulse: false };
}

export default function Sidebar() {
  const pathname = usePathname();
  const [health, setHealth] = useState<HealthResponse | null>(null);

  useEffect(() => {
    fetch("/api/health")
      .then((res) => res.json().then((body) => ({ ok: res.ok, body })))
      .then(({ ok, body }) => {
        if (ok) setHealth(body);
      })
      .catch(() => {
        /* decorative status only -- never block the sidebar's nav links */
      });
  }, [pathname]);

  return (
    <aside className="w-[240px] flex-shrink-0 sticky top-0 h-screen bg-sidebarBg border-r border-border flex flex-col px-[18px] py-5 gap-4 overflow-y-auto">
      <div className="flex items-center gap-2.5 px-1.5">
        <svg
          width="26"
          height="26"
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
        <div className="flex flex-col">
          <span className="font-heading text-base font-bold text-textPrimary">DataPulse</span>
          <span className="font-mono text-[10px] text-textMuted">realtime-pipeline</span>
        </div>
      </div>

      <nav className="flex flex-col gap-1">
        {NAV_LINKS.map((link) => (
          <SidebarLink key={link.href} link={link} active={pathname === link.href} />
        ))}
        <span className="font-mono text-[10px] text-textFaint tracking-wide px-3 pt-3 pb-0.5">TRANG KHÁC</span>
        {LEGACY_LINKS.map((link) => (
          <SidebarLink key={link.href} link={link} active={pathname === link.href} />
        ))}
      </nav>

      <div className="mt-auto flex flex-col gap-2.5">
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-surface/75 backdrop-blur-md border border-border">
          <span className="relative flex h-[7px] w-[7px] flex-shrink-0">
            {statusDotColor(health).pulse && (
              <span className={`absolute inline-flex h-full w-full animate-ping rounded-full ${statusDotColor(health).dot} opacity-75`} />
            )}
            <span className={`relative inline-flex h-[7px] w-[7px] rounded-full ${statusDotColor(health).dot} ${statusDotColor(health).pulse ? "shadow-glowEmerald" : ""}`} />
          </span>
          <span className="font-mono text-[11px] text-textSecondary">
            {health ? `${health.sourcesHealthy}/${health.sourcesTotal} nguồn OK` : "—"}
          </span>
        </div>
        <div className="px-3 font-mono text-[10px] text-textFaint">{health ? `${health.region} · ${health.environment}` : "—"}</div>
      </div>
    </aside>
  );
}
