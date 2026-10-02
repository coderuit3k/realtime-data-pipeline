"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { readPanelCollapsed, writePanelCollapsed } from "@/lib/panelState";
import { PanelToggleButton } from "./PanelToggleButton";

const SIDEBAR_COLLAPSED_KEY = "sidebar_collapsed";

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
    label: "RAG Assistant",
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

// Working pages that fell outside the 4-item main nav. They stay reachable
// here until their content is folded into the main pages; /settings and
// /weather were dropped from the nav on purpose and are not listed.
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
  {
    href: "/trends",
    label: "Trend Events",
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
        <line x1="6" y1="20" x2="6" y2="14" />
        <line x1="12" y1="20" x2="12" y2="4" />
        <line x1="18" y1="20" x2="18" y2="10" />
      </svg>
    ),
  },
];

/** When collapsed only the icon shows, so the label moves to aria-label/title. */
function SidebarLink({ link, active, collapsed }: { link: NavLink; active: boolean; collapsed: boolean }) {
  return (
    <Link
      href={link.href}
      aria-current={active ? "page" : undefined}
      aria-label={collapsed ? link.label : undefined}
      title={collapsed ? link.label : undefined}
      className={`flex items-center gap-3 py-2 rounded-lg text-[13px] border whitespace-nowrap ${
        collapsed ? "justify-center px-0" : "px-3"
      } ${
        active
          ? "bg-accent/[0.12] text-accent font-semibold border-accent/30 shadow-glowCyan"
          : "text-textSecondary font-medium border-transparent"
      }`}
    >
      <span className="flex-shrink-0">{link.icon}</span>
      {!collapsed && <span>{link.label}</span>}
    </Link>
  );
}

/** App-wide navigation; the collapsed state is remembered in localStorage. */
export default function Sidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  // Animate only after the remembered state is applied, so a returning
  // visitor with a collapsed sidebar doesn't watch it slide shut on load.
  const [ready, setReady] = useState(false);

  // localStorage is read in an effect, not during render, to keep the
  // server-rendered markup and the first client render identical.
  useEffect(() => {
    setCollapsed(readPanelCollapsed(window.localStorage, SIDEBAR_COLLAPSED_KEY));
    const frame = requestAnimationFrame(() => setReady(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  function toggle() {
    const next = !collapsed;
    setCollapsed(next);
    writePanelCollapsed(window.localStorage, SIDEBAR_COLLAPSED_KEY, next);
  }

  return (
    <aside
      className={`${collapsed ? "w-[64px] px-2" : "w-[240px] px-[18px]"} ${
        ready ? "transition-[width] duration-200 ease-out motion-reduce:transition-none" : ""
      } flex-shrink-0 sticky top-0 h-screen bg-sidebarBg border-r border-border flex flex-col py-5 gap-4 overflow-x-hidden overflow-y-auto`}
    >
      <div className={`flex ${collapsed ? "flex-col items-center" : "items-center"} gap-2.5 ${collapsed ? "" : "px-1.5"}`}>
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
        {!collapsed && (
          <div className="flex flex-col flex-grow whitespace-nowrap">
            <span className="font-heading text-base font-bold text-textPrimary">DataPulse</span>
            <span className="font-mono text-[10px] text-textMuted">realtime-pipeline</span>
          </div>
        )}
        <PanelToggleButton
          collapsed={collapsed}
          edge="left"
          label={collapsed ? "Mở rộng thanh điều hướng" : "Thu gọn thanh điều hướng"}
          onClick={toggle}
        />
      </div>

      <nav className="flex flex-col gap-1">
        {NAV_LINKS.map((link) => (
          <SidebarLink key={link.href} link={link} active={pathname === link.href} collapsed={collapsed} />
        ))}
        {collapsed ? (
          <hr className="border-border my-2" />
        ) : (
          <span className="font-mono text-[10px] text-textFaint tracking-wide px-3 pt-3 pb-0.5">TRANG KHÁC</span>
        )}
        {LEGACY_LINKS.map((link) => (
          <SidebarLink key={link.href} link={link} active={pathname === link.href} collapsed={collapsed} />
        ))}
      </nav>
    </aside>
  );
}
