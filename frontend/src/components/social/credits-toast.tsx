/**
 * CreditsToast — minimal fixed-position toast for the social mockup.
 *
 * No external toast library per the spec. Shows a single message in the
 * bottom-right; the parent owns the message state and clears it (we just
 * auto-fire onClose after 2.5s as a convenience).
 */
"use client";

import { useEffect } from "react";

interface CreditsToastProps {
  message: string | null;
  onClose: () => void;
  /** Auto-dismiss timeout in ms. Default 2500. */
  ttl?: number;
}

export default function CreditsToast({
  message,
  onClose,
  ttl = 2500,
}: CreditsToastProps) {
  useEffect(() => {
    if (!message) return;
    const t = setTimeout(onClose, ttl);
    return () => clearTimeout(t);
  }, [message, onClose, ttl]);

  if (!message) return null;

  return (
    <div
      className="fixed bottom-6 right-6 z-50 rounded-full bg-slate-900 text-white px-5 py-3 text-sm shadow-lg flex items-center gap-2"
      role="status"
      aria-live="polite"
    >
      {message}
    </div>
  );
}
