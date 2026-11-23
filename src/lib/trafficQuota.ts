import { stringToBytes } from "../utils/unitHelper";

export type TrafficQuotaState = "limited" | "unlimited" | "unknown";

export interface TrafficQuota {
  state: TrafficQuotaState;
  bytes: number;
}

const UNLIMITED_TEXT = /^(unlimited|infinite|infinity|∞|无限|無限)$/i;

export function normalizeTrafficLimit(value: unknown): number {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return 0;
    if (/[a-zA-Z\s,*]/.test(trimmed)) {
      return stringToBytes(trimmed);
    }
    const numeric = Number(trimmed);
    if (!Number.isFinite(numeric) || numeric <= 0) return 0;
    if (numeric < 1024 ** 2) return numeric * 1024 ** 3;
    return numeric;
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value) || value <= 0) return 0;
    if (value < 1024 ** 2) return value * 1024 ** 3;
    return value;
  }

  return 0;
}

export function classifyTrafficLimit(raw: unknown): TrafficQuota {
  if (raw == null) return { state: "unknown", bytes: 0 };
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return { state: "unknown", bytes: 0 };
    if (UNLIMITED_TEXT.test(trimmed)) return { state: "unlimited", bytes: 0 };
    if (trimmed === "0") return { state: "unlimited", bytes: 0 };
    if (!/^[\d\s.,*+eE-]+(?:\s*[a-zA-Z]+)?$/.test(trimmed)) {
      return { state: "unknown", bytes: 0 };
    }
    const bytes = normalizeTrafficLimit(trimmed);
    return bytes > 0 ? { state: "limited", bytes } : { state: "unknown", bytes: 0 };
  }
  if (typeof raw === "number") {
    if (!Number.isFinite(raw)) return { state: "unknown", bytes: 0 };
    if (raw <= 0) return { state: "unlimited", bytes: 0 };
    const bytes = normalizeTrafficLimit(raw);
    return bytes > 0 ? { state: "limited", bytes } : { state: "unknown", bytes: 0 };
  }
  return { state: "unknown", bytes: 0 };
}
