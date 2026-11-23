export type ExpiryKind = "unknown" | "invalid" | "expired" | "remaining" | "long_term";

export interface ExpiryDescription {
  kind: ExpiryKind;
  days: number | null;
}

const LONG_TERM_DAYS = 36500;
const DAY_MS = 24 * 60 * 60 * 1000;

export function describeExpiry(value: unknown, now = Date.now()): ExpiryDescription {
  if (value == null) return { kind: "unknown", days: null };
  if (typeof value === "string" && value.trim() === "") return { kind: "unknown", days: null };
  if (typeof value !== "string" && typeof value !== "number") return { kind: "invalid", days: null };

  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return { kind: "invalid", days: null };

  const days = Math.ceil((timestamp - now) / DAY_MS);
  if (days <= 0) return { kind: "expired", days };
  if (days > LONG_TERM_DAYS) return { kind: "long_term", days };
  return { kind: "remaining", days };
}
