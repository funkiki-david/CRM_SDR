/**
 * Team Members — list + Admin-only management actions.
 *
 * Any signed-in user can view the list. Admins additionally can:
 *   - Add Team Member (+)
 *   - Edit (name / role / reset password)
 *   - Deactivate / Activate
 */
"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { usersApi } from "@/lib/api";

type Role = "admin" | "manager" | "sdr";

interface TeamMember {
  id: number;
  email: string;
  full_name: string;
  role: Role;
  is_active: boolean;
  manager_id: number | null;
  last_login_at: string | null;
  created_at: string;
}

function relativeLogin(iso: string | null): string {
  if (!iso) return "Never logged in";
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

// Active when logged in within last 24h, otherwise Away.
function presence(iso: string | null): "active" | "away" {
  if (!iso) return "away";
  const diff = Date.now() - new Date(iso).getTime();
  return diff < 24 * 60 * 60 * 1000 ? "active" : "away";
}

const ROLE_LABEL: Record<Role, string> = {
  admin: "Admin",
  manager: "Manager",
  sdr: "SDR",
};

const ROLE_COLOR: Record<Role, string> = {
  admin: "bg-purple-100 text-purple-800 border-purple-200",
  manager: "bg-blue-100 text-blue-800 border-blue-200",
  sdr: "bg-green-100 text-green-800 border-green-200",
};

interface TeamMembersProps {
  currentUserId: number | null;
  currentUserRole: Role | null;
}

export default function TeamMembers({ currentUserId, currentUserRole }: TeamMembersProps) {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isAdmin = currentUserRole === "admin";

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await usersApi.list() as TeamMember[];
      setMembers(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load users");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleDeactivate = async (m: TeamMember) => {
    if (!confirm(`Deactivate ${m.full_name} (${m.email})? They will no longer be able to log in.`)) return;
    try {
      await usersApi.deactivate(m.id);
      load();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed");
    }
  };

  const handleActivate = async (m: TeamMember) => {
    try {
      await usersApi.activate(m.id);
      load();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed");
    }
  };

  const editingMember = editingId !== null ? members.find(m => m.id === editingId) ?? null : null;

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle
              className="font-display font-bold"
              style={{ fontSize: 18, color: "var(--text-primary)" }}
            >
              Team Members
            </CardTitle>
            <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
              {members.length} {members.length === 1 ? "user" : "users"}
              {isAdmin && " · Admin can add, edit, and deactivate"}
            </p>
          </div>
          {isAdmin && (
            <Button size="sm" onClick={() => setAddOpen(true)}>+ Add Team Member</Button>
          )}
        </CardHeader>
        <CardContent>
          {error && (
            <div className="p-2 bg-red-50 border border-red-200 rounded text-xs text-red-700 mb-3">
              {error}
            </div>
          )}
          {loading ? (
            <p className="text-sm text-gray-400">Loading…</p>
          ) : members.length === 0 ? (
            <p className="text-sm text-gray-400">No users yet.</p>
          ) : (
            <div className="space-y-2">
              {members.map((m) => (
                <div
                  key={m.id}
                  className={`flex items-center justify-between p-3 rounded-md border ${
                    m.is_active ? "bg-gray-50 border-gray-200" : "bg-gray-100 border-gray-300 opacity-60"
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-medium text-gray-900">{m.full_name}</p>
                      <Badge
                        variant="outline"
                        className={`text-[10px] py-0 px-1.5 ${ROLE_COLOR[m.role]}`}
                      >
                        {ROLE_LABEL[m.role]}
                      </Badge>
                      {m.is_active && (
                        <span
                          className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium"
                          style={
                            presence(m.last_login_at) === "active"
                              ? { background: "var(--brand-green-soft)", color: "var(--brand-green)" }
                              : { background: "var(--border-faint)", color: "var(--text-muted)" }
                          }
                        >
                          <span
                            className="inline-block w-1.5 h-1.5 rounded-full"
                            style={{
                              background:
                                presence(m.last_login_at) === "active"
                                  ? "var(--brand-green)"
                                  : "var(--text-muted)",
                            }}
                          />
                          {presence(m.last_login_at) === "active" ? "Active" : "Away"}
                        </span>
                      )}
                      {!m.is_active && (
                        <Badge variant="outline" className="text-[10px] py-0 px-1.5">Inactive</Badge>
                      )}
                      {m.id === currentUserId && (
                        <Badge variant="outline" className="text-[10px] py-0 px-1.5 bg-yellow-50">You</Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-3 mt-0.5">
                      <span className="text-xs text-gray-500">{m.email}</span>
                      <span className="text-xs text-gray-400">· Last login: {relativeLogin(m.last_login_at)}</span>
                    </div>
                  </div>
                  {isAdmin && (
                    <div className="flex gap-1">
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-xs h-7"
                        onClick={() => setEditingId(m.id)}
                      >
                        Edit
                      </Button>
                      {m.is_active ? (
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-xs h-7 text-red-600 hover:text-red-700"
                          disabled={m.id === currentUserId}
                          title={m.id === currentUserId ? "You cannot deactivate yourself" : "Deactivate"}
                          onClick={() => handleDeactivate(m)}
                        >
                          Deactivate
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-xs h-7 text-green-600"
                          onClick={() => handleActivate(m)}
                        >
                          Activate
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {addOpen && (
        <AddMemberModal
          onClose={() => setAddOpen(false)}
          onCreated={() => { setAddOpen(false); load(); }}
        />
      )}

      {editingMember && (
        <EditMemberModal
          member={editingMember}
          onClose={() => setEditingId(null)}
          onSaved={() => { setEditingId(null); load(); }}
        />
      )}
    </>
  );
}


// ================== Add Modal ==================

function AddMemberModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>("sdr");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCreate = async () => {
    if (!fullName || !email || !password) {
      setError("Full Name, Email, and Password are all required");
      return;
    }
    if (password.length < 6) {
      setError("Password must be at least 6 characters");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await usersApi.create({ email, password, full_name: fullName, role });
      onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create user");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={true} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add Team Member</DialogTitle>
        </DialogHeader>
        <div className="py-2 space-y-3">
          <div>
            <Label className="text-xs">Full Name</Label>
            <Input value={fullName} onChange={(e) => setFullName(e.target.value)} className="h-9" />
          </div>
          <div>
            <Label className="text-xs">Email</Label>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="h-9" />
          </div>
          <div>
            <Label className="text-xs">Password</Label>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="h-9"
              autoComplete="new-password"
              placeholder="At least 6 characters"
            />
          </div>
          <div>
            <Label className="text-xs">Role</Label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as Role)}
              className="w-full h-9 px-3 rounded-md border border-input bg-transparent text-sm"
            >
              <option value="sdr">SDR — Can only see their own contacts</option>
              <option value="manager">Manager — Can see all team contacts</option>
              <option value="admin">Admin — Full permissions</option>
            </select>
          </div>
          {error && (
            <div className="p-2 bg-red-50 border border-red-200 rounded text-xs text-red-700">
              {error}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleCreate} disabled={saving}>
            {saving ? "Creating..." : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}


// ================== Edit Modal ==================

function EditMemberModal({
  member,
  onClose,
  onSaved,
}: {
  member: TeamMember;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [fullName, setFullName] = useState(member.full_name);
  const [role, setRole] = useState<Role>(member.role);
  const [password, setPassword] = useState(""); // empty → leave password unchanged
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const payload: {
        full_name?: string;
        role?: Role;
        password?: string;
      } = {};
      if (fullName && fullName !== member.full_name) payload.full_name = fullName;
      if (role !== member.role) payload.role = role;
      if (password) {
        if (password.length < 6) {
          setError("Password must be at least 6 characters");
          setSaving(false);
          return;
        }
        payload.password = password;
      }
      if (Object.keys(payload).length === 0) {
        setError("No changes made");
        setSaving(false);
        return;
      }
      await usersApi.edit(member.id, payload);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={true} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Edit {member.full_name}</DialogTitle>
        </DialogHeader>
        <div className="py-2 space-y-3">
          <div>
            <Label className="text-xs">Email (read-only)</Label>
            <Input value={member.email} disabled className="h-9 bg-gray-50" />
          </div>
          <div>
            <Label className="text-xs">Full Name</Label>
            <Input value={fullName} onChange={(e) => setFullName(e.target.value)} className="h-9" />
          </div>
          <div>
            <Label className="text-xs">Role</Label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as Role)}
              className="w-full h-9 px-3 rounded-md border border-input bg-transparent text-sm"
            >
              <option value="sdr">SDR</option>
              <option value="manager">Manager</option>
              <option value="admin">Admin</option>
            </select>
          </div>
          <div>
            <Label className="text-xs">Reset Password (optional)</Label>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="h-9"
              autoComplete="new-password"
              placeholder="Leave blank to keep current password"
            />
          </div>
          {error && (
            <div className="p-2 bg-red-50 border border-red-200 rounded text-xs text-red-700">
              {error}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Saving..." : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
