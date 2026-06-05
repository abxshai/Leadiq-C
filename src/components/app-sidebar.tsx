"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  FileText,
  BarChart3,
  Settings,
  Radar,
  MessageSquare,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { UserButton } from "@/components/user-button";

const nav = [
  { href: "/scrape", label: "Scrape", icon: Radar },
  { href: "/campaigns", label: "Campaigns", icon: LayoutDashboard },
  { href: "/templates", label: "Prompt Templates", icon: FileText },
  { href: "/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/chat", label: "Chat", icon: MessageSquare },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function AppSidebar({ email }: { email: string }) {
  const pathname = usePathname();

  return (
    <aside className="hidden md:flex md:w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar/60 backdrop-blur-xl">
      <div className="flex h-14 items-center px-5 border-b border-sidebar-border">
        <span className="relative font-display lowercase tracking-wide text-base leading-none [-webkit-text-stroke:0.3px_currentColor]">
          Lead-IQ
          {/* Deccan logo tucked at the top-left corner of the wordmark. */}
          <Image
            src="/logowhite.png"
            alt="Lead-IQ"
            width={90}
            height={28}
            priority
            className="pointer-events-none absolute bottom-full left-0 mb-0.5 h-4 w-auto object-contain invert dark:invert-0"
          />
        </span>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-1">
        {nav.map((item) => {
          const active =
            pathname === item.href || pathname.startsWith(`${item.href}/`);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                active
                  ? "bg-sidebar-accent text-sidebar-accent-foreground ring-1 ring-primary/25"
                  : "text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
              )}
            >
              <Icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-sidebar-border p-3 space-y-3">
        <UserButton email={email} />
        <div className="px-2 text-[11px] text-muted-foreground">
          <div className="opacity-70">Powered by</div>
          <div className="font-medium text-foreground/90">
            Groq · gpt-oss-120b
          </div>
        </div>
      </div>
    </aside>
  );
}
