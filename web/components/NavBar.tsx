"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Tổng quan" },
  { href: "/assistant", label: "RAG Assistant" },
  { href: "/catalog", label: "Data Catalog" },
  { href: "/explorer", label: "Data Explorer" },
  { href: "/insights", label: "Insights" },
  { href: "/ops", label: "Ops" },
];

export function NavBar() {
  const pathname = usePathname();

  return (
    <nav className="flex items-center gap-6 border-b border-border px-9 py-4">
      <span className="font-heading text-base font-bold text-textPrimary">DataPulse</span>
      {LINKS.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          className={`text-sm font-medium ${
            pathname === link.href ? "text-accent" : "text-textSecondary"
          }`}
        >
          {link.label}
        </Link>
      ))}
    </nav>
  );
}
