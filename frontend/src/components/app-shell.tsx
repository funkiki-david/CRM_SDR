/**
 * AppShell — Shared layout wrapper with top navigation bar
 * Used by all authenticated pages (dashboard, contacts, etc.)
 * Includes the "Log Activity" button that opens Quick Entry from anywhere
 */
"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { authApi } from "@/lib/api";
import QuickEntry from "@/components/quick-entry";

interface UserInfo {
  id: number;
  email: string;
  full_name: string;
  role: string;
}

const roleLabels: Record<string, string> = {
  admin: "Admin",
  manager: "Manager",
  sdr: "SDR",
};

// Navigation links
const navLinks = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/contacts", label: "Contacts" },
  { href: "/emails", label: "Emails" },
  { href: "/finder", label: "Finder" },
  { href: "/settings", label: "Settings" },
];

interface AppShellProps {
  children: React.ReactNode;
  /** Pre-select a contact in the Quick Entry dialog */
  quickEntryContactId?: number | null;
}

export default function AppShell({ children, quickEntryContactId }: AppShellProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<UserInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [quickEntryOpen, setQuickEntryOpen] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem("token");
    if (!token) {
      router.push("/login");
      return;
    }
    authApi
      .getMe()
      .then(setUser)
      .catch(() => {
        // Token invalid → clear token + remembered email (spec: full sign-out wipes everything).
        localStorage.removeItem("token");
        localStorage.removeItem("sdr_crm_remembered_email");
        router.push("/login");
      })
      .finally(() => setLoading(false));
  }, [router]);

  function handleLogout() {
    localStorage.removeItem("token");
    localStorage.removeItem("sdr_crm_remembered_email");
    router.push("/login");
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center" style={{ background: "var(--bg-app)" }}>
        <p className="text-slate-500">Loading...</p>
      </div>
    );
  }

  // Phase A: navy navbar with dual-tone Fraunces logo + blue active pill +
  // pill primary CTA. Inline `style` is used for brand tokens (CSS vars
  // defined in globals.css) since Tailwind doesn't know about them.
  const initials = (user?.full_name || user?.email || "?")
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => p[0]?.toUpperCase())
    .slice(0, 2)
    .join("");

  return (
    <div className="min-h-screen" style={{ background: "var(--bg-app)" }}>
      {/* Top navigation bar — sticky 56px navy bar */}
      <header
        className="sticky top-0 z-40 px-6 flex items-center justify-between"
        style={{ background: "var(--brand-navy)", height: 56 }}
      >
        <div className="flex items-center gap-8">
          {/* Dual-tone wordmark: "SDR " white + "CRM" blue, Fraunces */}
          <Link href="/dashboard" className="font-display text-xl font-bold tracking-tight">
            <span className="text-white">SDR </span>
            <span style={{ color: "var(--brand-blue)" }}>CRM</span>
          </Link>
          <nav className="flex items-center gap-1">
            {navLinks.map((link) => {
              const active = pathname === link.href;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`px-3.5 py-1.5 rounded-full text-[13px] font-medium transition-colors ${
                    active ? "text-white" : "text-white/60 hover:text-white"
                  }`}
                  style={active ? { background: "var(--brand-blue)" } : undefined}
                >
                  {link.label}
                </Link>
              );
            })}
          </nav>
        </div>
        <div className="flex items-center gap-3">
          {/* Primary CTA — pill, blue */}
          <Button
            size="sm"
            onClick={() => setQuickEntryOpen(true)}
            className="text-white text-[13px] font-semibold px-4 h-8"
            style={{ background: "var(--brand-blue)" }}
          >
            + Log Action
          </Button>
          <span className="text-[13px] text-white/70 hidden md:inline">{user?.full_name}</span>
          {/* User avatar — 32px blue circle, white initials */}
          <div
            className="flex items-center justify-center rounded-full text-white text-[12px] font-semibold"
            style={{ background: "var(--brand-blue)", width: 32, height: 32 }}
            title={`${user?.full_name || ""} (${roleLabels[user?.role || ""] || user?.role})`}
          >
            {initials}
          </div>
          <button
            onClick={handleLogout}
            className="text-[13px] text-white/60 hover:text-white transition-colors"
          >
            Sign Out
          </button>
        </div>
      </header>

      {/* Page content */}
      <main>{children}</main>

      {/* Quick Entry dialog */}
      <QuickEntry
        open={quickEntryOpen}
        onClose={() => setQuickEntryOpen(false)}
        preselectedContactId={quickEntryContactId}
        onSuccess={() => {
          // Refresh the page to show updated data
          router.refresh();
          window.location.reload();
        }}
      />
    </div>
  );
}
