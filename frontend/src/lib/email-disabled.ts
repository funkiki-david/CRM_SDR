/**
 * Temporary kill-switch for all email-related UI actions.
 *
 * Point every email button's onClick to `notifyEmailDisabled()` to soft-disable
 * sending. Backend API / DB schema / UI layout stay intact — this is purely a
 * front-end intercept.
 *
 * To restore: revert the onClick handlers, or delete this file.
 */

export function notifyEmailDisabled(): void {
  if (typeof window === "undefined") return;
  alert("Email features are temporarily disabled.");
}
