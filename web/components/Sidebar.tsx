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

function SidebarLink({ link, active }: { link: NavLink; active: boolean }) {
  return (
    <Link
      href={link.href}
      aria-current={active ? "page" : undefined}
      className={`flex items-center gap-3 px-3 py-2 rounded-lg text-[13px] ${
        active ? "bg-accent/[0.12] text-accent font-semibold" : "text-textSecondary font-medium"
      }`}
    >
      {link.icon}
      <span>{link.label}</span>
    </Link>
  );
}

function statusDotColor(health: HealthResponse | null): string {
  if (!health) return "bg-textMuted";
  return health.sourcesHealthy === health.sourcesTotal
    ? "bg-success shadow-[0_0_8px_theme(colors.success)]"
    : "bg-warning shadow-[0_0_8px_theme(colors.warning)]";
}

export default function Sidebar() {
  const pathname = usePathname();
  const [health, setHealth] = useState<HealthResponse | null>(null);

  useEffect(() => {
    if (pathname === "/") return;
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
      </nav>

      <div className="mt-auto flex flex-col gap-2.5">
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-surface border border-border">
          <span className={`w-[7px] h-[7px] rounded-full flex-shrink-0 ${statusDotColor(health)}`} />
          <span className="font-mono text-[11px] text-textSecondary">
            {health ? `${health.sourcesHealthy}/${health.sourcesTotal} nguồn OK` : "—"}
          </span>
        </div>
        <div className="px-3 font-mono text-[10px] text-textFaint">{health ? `${health.region} · ${health.environment}` : "—"}</div>
      </div>
    </aside>
  );
}
