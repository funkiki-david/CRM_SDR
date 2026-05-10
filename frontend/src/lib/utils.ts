import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

interface PersonNameFields {
  first_name?: string | null
  last_name?: string | null
  name?: string | null
}

/**
 * Resolve a person's full display name.
 *
 * Priority: first_name + last_name → name → "(Unnamed)".
 *
 * Apollo's `name` field has been observed to return a single token
 * (e.g. "Mike") even when first_name + last_name are populated. So we
 * prefer the explicit pair and only fall back to the bare `name` when
 * both first and last are missing.
 */
export function formatFullName(person: PersonNameFields): string {
  const first = (person.first_name || "").trim()
  const last = (person.last_name || "").trim()
  const joined = [first, last].filter(Boolean).join(" ")
  if (joined) return joined
  const bareName = (person.name || "").trim()
  return bareName || "(Unnamed)"
}

/**
 * 2-character avatar initials from first + last, falling back to the
 * first two characters of `name` when only that exists.
 */
export function getInitials(person: PersonNameFields): string {
  const first = (person.first_name || "").trim()
  const last = (person.last_name || "").trim()
  if (first && last) return `${first[0]}${last[0]}`.toUpperCase()
  if (first) return first.slice(0, 2).toUpperCase()
  if (last) return last.slice(0, 2).toUpperCase()
  const bareName = (person.name || "").trim()
  if (bareName) return bareName.slice(0, 2).toUpperCase()
  return "??"
}
