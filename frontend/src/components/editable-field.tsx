/**
 * EditableField — inline edit with pencil icon, Enter to save, Esc to cancel.
 *
 * 用法:
 *   <EditableField
 *     value={contact.first_name}
 *     onSave={(v) => contactsApi.update(id, { first_name: v })}
 *     placeholder="First name"
 *   />
 *
 * UX:
 *   - 默认显示文字 + hover 时浮现 ✏️ 图标
 *   - 点击文字或图标 → 变输入框（autoFocus）
 *   - Enter / blur → 保存（调 onSave）
 *   - Esc → 取消
 *   - 保存成功：绿色 ✓ Saved 提示 2 秒
 *   - 保存失败：红边框 + 错误文字
 */
"use client";

import { useEffect, useRef, useState } from "react";

interface EditableFieldProps {
  value: string | null;
  onSave: (newValue: string) => Promise<void> | void;
  placeholder?: string;
  emptyLabel?: string;          // 显示文字为空时的占位 "Not set"
  multiline?: boolean;          // 用 <textarea> 代替 <input>
  className?: string;           // 外层 span 样式
  inputClassName?: string;
  maxLength?: number;
  type?: "text" | "email" | "url";
  validate?: (v: string) => string | null;  // 返回错误消息；null 即合法
}

export function EditableField({
  value,
  onSave,
  placeholder,
  emptyLabel = "Not set",
  multiline = false,
  className = "",
  inputClassName = "",
  maxLength = 500,
  type = "text",
  validate,
}: EditableFieldProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");
  const [saving, setSaving] = useState(false);
  const [showSaved, setShowSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);

  // 父级 value 变化时同步 draft（例如 Enrich 后刷新）
  useEffect(() => {
    if (!editing) setDraft(value ?? "");
  }, [value, editing]);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select?.();
    }
  }, [editing]);

  const commit = async () => {
    const trimmed = draft.trim();
    const original = (value ?? "").trim();
    if (trimmed === original) {
      setEditing(false);
      return;
    }
    if (validate) {
      const err = validate(trimmed);
      if (err) { setError(err); return; }
    }
    setSaving(true);
    setError(null);
    try {
      await onSave(trimmed);
      setEditing(false);
      setShowSaved(true);
      setTimeout(() => setShowSaved(false), 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const cancel = () => {
    setDraft(value ?? "");
    setError(null);
    setEditing(false);
  };

  const keyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      cancel();
    } else if (e.key === "Enter" && !multiline) {
      e.preventDefault();
      commit();
    }
  };

  if (editing) {
    const InputTag = multiline ? "textarea" : "input";
    return (
      <span className={`inline-block w-full ${className}`}>
        <InputTag
          ref={inputRef as React.RefObject<HTMLInputElement & HTMLTextAreaElement>}
          type={multiline ? undefined : type}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={keyDown}
          disabled={saving}
          maxLength={maxLength}
          placeholder={placeholder}
          rows={multiline ? 3 : undefined}
          className={`inline-block px-1.5 py-0.5 border rounded text-sm
            ${error ? "border-red-400 bg-red-50" : "border-blue-400"}
            focus:outline-none focus:ring-1 focus:ring-blue-400
            ${multiline ? "w-full" : "min-w-[8rem]"}
            ${inputClassName}`}
        />
        {error && <span className="ml-2 text-xs text-red-600">{error}</span>}
        {saving && <span className="ml-2 text-xs text-gray-400">saving…</span>}
      </span>
    );
  }

  return (
    <span
      onClick={() => setEditing(true)}
      className={`group relative cursor-text hover:bg-blue-50 rounded px-1 -mx-1 ${className}`}
      title="Click to edit"
    >
      <span className={(value || "").length === 0 ? "text-gray-300 italic" : ""}>
        {value || emptyLabel}
      </span>
      <span className="opacity-0 group-hover:opacity-60 ml-1 text-xs">✏️</span>
      {showSaved && (
        <span className="ml-2 text-xs text-green-600 animate-pulse">✓ Saved</span>
      )}
    </span>
  );
}
