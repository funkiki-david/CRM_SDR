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
import { Badge } from "@/components/ui/badge";
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
        // Token 失效：清 token + remembered email（spec: 退出登录清所有）
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
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <p className="text-slate-500">Loading...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Top navigation bar */}
      <header className="bg-slate-900 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-8">
          <h1 className="text-lg font-bold text-white">SDR CRM</h1>
          <nav className="flex items-center gap-1">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${
                  pathname === link.href
                    ? "bg-slate-700 text-white"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                {link.label}
              </Link>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-3">
          {/* Log Activity button — always visible */}
          <Button
            size="sm"
            onClick={() => setQuickEntryOpen(true)}
            className="bg-blue-600 hover:bg-blue-700 text-white"
          >
            + Log Activity
          </Button>
          <span className="text-sm text-slate-300">{user?.full_name}</span>
          <Badge variant="secondary" className="text-xs bg-slate-700 text-slate-200 hover:bg-slate-700">
            {roleLabels[user?.role || ""] || user?.role}
          </Badge>
          <button
            onClick={handleLogout}
            className="text-sm text-slate-400 hover:text-white transition-colors"
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
