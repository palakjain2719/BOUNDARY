"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/matches", label: "Matches" },
  { href: "/history", label: "My Teams" },
  { href: "/learning", label: "Performance" },
  { href: "/settings", label: "Settings" },
];

export function NavLinks() {
  const path = usePathname();
  return (
    <nav aria-label="Primary" className="flex min-w-0 items-center gap-1 overflow-x-auto text-sm">
      {LINKS.map((l) => {
        const active = path === l.href || path.startsWith(`${l.href}/`);
        return (
          <Link
            key={l.href}
            href={l.href}
            aria-current={active ? "page" : undefined}
            className={`whitespace-nowrap rounded-full px-3 py-1.5 font-medium transition-colors ${active ? "bg-ink text-white" : "text-ink hover:bg-paper"}`}
          >
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
