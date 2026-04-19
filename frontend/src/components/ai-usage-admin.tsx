/**
 * Admin AI Usage Panel — Settings 页专用
 * 显示所有用户今日用量 + 调整每用户每日上限 + 本月总计
 */
"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { aiApi } from "@/lib/api";

interface UserUsage {
  user_id: number;
  full_name: string;
  email: string;
  role: string;
  spent_today: number;
  daily_limit: number | null;
  percent: number | null;
  color: "green" | "yellow" | "red";
  unlimited: boolean;
}

interface AllUsageResponse {
  users: UserUsage[];
  daily_limit_usd: number;
  month_total_usd: number;
}

const COLOR_BAR: Record<string, string> = {
  green: "bg-green-500",
  yellow: "bg-yellow-500",
  red: "bg-red-500",
};

export default function AIUsageAdmin() {
  const [data, setData] = useState<AllUsageResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [editLimit, setEditLimit] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await aiApi.getAllUsage() as AllUsageResponse;
      setData(res);
      setEditLimit(res.daily_limit_usd.toFixed(2));
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleSave = async () => {
    const n = parseFloat(editLimit);
    if (isNaN(n) || n < 0) { setMsg("Invalid limit"); return; }
    setSaving(true);
    setMsg(null);
    try {
      await aiApi.updateLimit(n);
      setMsg(`✓ Limit updated to $${n.toFixed(2)}/day per user`);
      load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">AI Usage Limits</CardTitle>
        <p className="text-sm text-gray-500">
          Per-user daily AI budget. Admins are unlimited.
        </p>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Daily limit input */}
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <label className="text-xs text-gray-700 font-medium">
              Daily AI budget per user (USD)
            </label>
            <div className="flex items-center gap-1 mt-1">
              <span className="text-gray-500">$</span>
              <Input
                type="number"
                step="0.01"
                value={editLimit}
                onChange={(e) => setEditLimit(e.target.value)}
                className="h-9 w-32"
              />
            </div>
          </div>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Saving..." : "Save"}
          </Button>
        </div>
        {msg && (
          <p className={`text-sm ${msg.startsWith("✓") ? "text-green-600" : "text-red-500"}`}>
            {msg}
          </p>
        )}

        {/* Today's usage list */}
        <div>
          <p className="text-sm font-medium text-gray-700 mb-2">Today&rsquo;s Usage</p>
          {loading ? (
            <p className="text-sm text-gray-400">Loading…</p>
          ) : !data ? (
            <p className="text-sm text-gray-400">No data.</p>
          ) : (
            <div className="space-y-2">
              {data.users.map(u => (
                <div key={u.user_id} className="flex items-center gap-3 p-2 bg-gray-50 rounded">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">
                      {u.full_name}{" "}
                      <span className="text-xs text-gray-400">({u.role})</span>
                    </p>
                    <p className="text-xs text-gray-500 truncate">{u.email}</p>
                  </div>
                  <div className="text-right w-48 shrink-0">
                    <p className="text-sm font-mono">
                      ${u.spent_today.toFixed(2)}
                      {u.unlimited ? (
                        <span className="text-xs text-gray-400 ml-1">(no limit)</span>
                      ) : (
                        <span className="text-gray-400"> / ${u.daily_limit?.toFixed(2)}</span>
                      )}
                    </p>
                    {!u.unlimited && u.percent !== null && (
                      <div className="h-1.5 bg-gray-200 rounded overflow-hidden mt-1">
                        <div
                          className={`h-full ${COLOR_BAR[u.color]}`}
                          style={{ width: `${Math.min(100, u.percent)}%` }}
                        />
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Month total */}
        {data && (
          <div className="pt-3 border-t border-gray-100 flex items-center justify-between">
            <p className="text-sm text-gray-700">This Month Total</p>
            <p className="text-sm font-mono font-semibold">${data.month_total_usd.toFixed(4)}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
