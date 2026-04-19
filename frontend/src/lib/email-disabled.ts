/**
 * Temporary kill-switch for all email-related UI actions.
 *
 * 把所有 email 按钮的 onClick 指向 notifyEmailDisabled() 即可临时停用。
 * 后端 API / 数据库 schema / UI 布局完全不动 —— 这是纯前端拦截。
 *
 * 恢复方式：把 onClick 改回原来的 handler，或直接删除本文件。
 */

export function notifyEmailDisabled(): void {
  if (typeof window === "undefined") return;
  alert("Email features are temporarily disabled.");
}
