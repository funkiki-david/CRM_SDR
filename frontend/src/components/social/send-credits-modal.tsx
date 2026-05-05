/**
 * SendCreditsModal — reusable "send virtual credits to a teammate" dialog.
 *
 * Mounted once at page level; opened by passing a recipientUserId.
 * The form body is a separate component keyed by recipientUserId so that
 * picking a new recipient remounts the form (zero state spillover, no
 * setState-in-effect needed).
 */
"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { findTeamMember } from "@/lib/team-mock";

const PRESETS = [10, 25, 50, 100];

interface SendCreditsModalProps {
  /** When set, opens the modal pre-filled for that teammate. null hides. */
  recipientUserId: number | null;
  /** Available balance — disable Send + show warning when amount > balance. */
  balance: number;
  /** Called when the user clicks Send. */
  onSend: (recipientUserId: number, amount: number, message: string) => void;
  onClose: () => void;
}

export default function SendCreditsModal({
  recipientUserId,
  balance,
  onSend,
  onClose,
}: SendCreditsModalProps) {
  return (
    <Dialog
      open={recipientUserId !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="sm:max-w-md">
        {recipientUserId !== null && (
          <SendCreditsForm
            key={recipientUserId}
            recipientUserId={recipientUserId}
            balance={balance}
            onSend={onSend}
            onClose={onClose}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function SendCreditsForm({
  recipientUserId,
  balance,
  onSend,
  onClose,
}: {
  recipientUserId: number;
  balance: number;
  onSend: (recipientUserId: number, amount: number, message: string) => void;
  onClose: () => void;
}) {
  const [amount, setAmount] = useState<number>(25);
  const [message, setMessage] = useState("");
  const recipient = findTeamMember(recipientUserId);
  const overdrawn = amount > balance;

  function handleSend() {
    if (overdrawn || amount <= 0) return;
    onSend(recipientUserId, amount, message.trim());
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {recipient ? `Send credits to ${recipient.name}` : "Send credits"}
        </DialogTitle>
      </DialogHeader>

      <div className="space-y-4 py-2">
        <div>
          <p className="text-xs text-slate-500 mb-2">Amount</p>
          <div className="flex gap-2 flex-wrap">
            {PRESETS.map((preset) => {
              const isActive = amount === preset;
              return (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setAmount(preset)}
                  className={`rounded-full px-4 py-1.5 text-sm font-medium border transition-colors ${
                    isActive
                      ? "bg-slate-900 text-white border-slate-900"
                      : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50"
                  }`}
                >
                  {preset}
                </button>
              );
            })}
            <input
              type="number"
              min={1}
              value={amount}
              onChange={(e) => {
                const n = parseInt(e.target.value, 10);
                setAmount(isNaN(n) ? 0 : Math.max(0, n));
              }}
              className="w-20 rounded-full border border-slate-200 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
              aria-label="Custom amount"
            />
          </div>
          <p className="text-xs text-slate-500 mt-1.5">
            Your balance:{" "}
            <span className={`font-medium ${overdrawn ? "text-red-600" : "text-slate-700"}`}>
              {balance.toLocaleString()}
            </span>
            {overdrawn && <span className="text-red-600 ml-2">— not enough credits</span>}
          </p>
        </div>

        <div>
          <p className="text-xs text-slate-500 mb-1.5">Message (optional)</p>
          <input
            type="text"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Crushed that call!"
            maxLength={120}
            className="w-full rounded-full border border-slate-200 px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
          />
        </div>
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={handleSend} disabled={overdrawn || amount <= 0}>
          Send
        </Button>
      </DialogFooter>
    </>
  );
}
