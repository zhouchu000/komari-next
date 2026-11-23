import { formatBytes, stringToBytes } from "../utils/unitHelper";

export type TrafficQuotaState = "limited" | "unlimited" | "unknown" | "bandwidth";

export interface TrafficQuota {
  state: TrafficQuotaState;
  bytes: number;
  note: string | null;
}

export interface TrafficBillingNote {
  uuid: string;
  billing: "bandwidth" | "unlimited";
  label: string | null;
}

export interface TrafficBillingMap {
  notes: TrafficBillingNote[];
  error: string | null;
}

const UNLIMITED_EXACT = /^(unlimited|infinite|infinity|∞|无限|無限|不限|不限额|不限額|不限流量|流量不限|无限流量|無限流量|流量无限|流量無限)$/i;
const BANDWIDTH_EXACT = /^(按带宽不计流量|按頻寬不計流量|按带宽计费|按頻寬計費|带宽计费|頻寬計費)$/;
const QUANTITY = /^[\d\s.,*+eE-]+(?:\s*[a-zA-Z]+)?$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const BANDWIDTH_NOTE = "按带宽不计流量";

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

function asText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function statementKind(text: string): "bandwidth" | "unlimited" | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (trimmed === BANDWIDTH_NOTE || BANDWIDTH_EXACT.test(trimmed)) return "bandwidth";
  if (UNLIMITED_EXACT.test(trimmed)) return "unlimited";
  return null;
}

function collectStatements(statement: unknown): string[] {
  if (Array.isArray(statement)) {
    return statement.flatMap((item) => collectStatements(item));
  }
  const text = asText(statement);
  if (!text) return [];
  return text.split(/[;；]/).map((part) => part.trim()).filter(Boolean);
}

function withStatement(base: TrafficQuota, statements: string[]): TrafficQuota {
  if (base.state === "limited") return base;
  const bandwidth = statements.find((item) => statementKind(item) === "bandwidth");
  if (bandwidth) {
    const canonical = statements.find((item) => item === BANDWIDTH_NOTE);
    const label = canonical || (bandwidth.length <= 40 ? bandwidth : BANDWIDTH_NOTE);
    return { state: "bandwidth", bytes: 0, note: label };
  }
  if (statements.some((item) => statementKind(item) === "unlimited")) {
    return { state: "unlimited", bytes: 0, note: null };
  }
  return base;
}

export function classifyTrafficLimit(raw: unknown, statement?: unknown): TrafficQuota {
  const statements = collectStatements(statement);
  const unknown = { state: "unknown" as const, bytes: 0, note: null };
  if (raw == null) return withStatement(unknown, statements);

  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return withStatement(unknown, statements);
    const ownKind = statementKind(trimmed);
    if (ownKind === "bandwidth") return { state: "bandwidth", bytes: 0, note: trimmed.length <= 40 ? trimmed : BANDWIDTH_NOTE };
    if (ownKind === "unlimited") return { state: "unlimited", bytes: 0, note: null };
    if (!QUANTITY.test(trimmed)) return withStatement(unknown, statements);
    const bytes = normalizeTrafficLimit(trimmed);
    if (bytes > 0) return { state: "limited", bytes, note: null };
    return withStatement(unknown, statements);
  }

  if (typeof raw === "number") {
    if (!Number.isFinite(raw) || raw <= 0) return withStatement(unknown, statements);
    const bytes = normalizeTrafficLimit(raw);
    return bytes > 0 ? { state: "limited", bytes, note: null } : withStatement(unknown, statements);
  }

  return withStatement(unknown, statements);
}

function readUuid(value: unknown): string | null {
  const text = asText(value).toLowerCase();
  return UUID_PATTERN.test(text) ? text : null;
}

export function parseTrafficBilling(input: unknown): TrafficBillingMap {
  const empty = { notes: [] as TrafficBillingNote[], error: null };
  if (input == null) return empty;
  let value = input;
  if (typeof input === "string") {
    const trimmed = input.trim();
    if (!trimmed) return empty;
    try {
      value = JSON.parse(trimmed);
    } catch {
      return { notes: [], error: "invalid_json" };
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { notes: [], error: "invalid_shape" };
  }
  const record = value as Record<string, unknown>;
  const rawNotes = Array.isArray(record.nodes) ? record.nodes : Array.isArray(record.entries) ? record.entries : null;
  if (!rawNotes) return { notes: [], error: "invalid_shape" };

  const notes: TrafficBillingNote[] = [];
  const seen = new Set<string>();
  for (const item of rawNotes) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const entry = item as Record<string, unknown>;
    const uuid = readUuid(entry.uuid);
    const billingText = asText(entry.billing ?? entry.mode).toLowerCase();
    if (!uuid || seen.has(uuid)) continue;
    if (billingText !== "bandwidth" && billingText !== "unlimited") continue;
    seen.add(uuid);
    const label = asText(entry.label);
    notes.push({
      uuid,
      billing: billingText,
      label: label || null,
    });
  }
  return { notes, error: null };
}

export type TrafficQuotaPresentation =
  | { kind: "unknown" }
  | { kind: "bandwidth"; note: string }
  | { kind: "unlimited" }
  | { kind: "limited"; bytes: number };

/** 只有明确的不限额才出现 ∞。0、缺失和「配额未公开」都落在未知，并且不画配额进度。 */
export function presentTrafficQuota(quota: TrafficQuota): TrafficQuotaPresentation {
  if (quota.state === "limited" && quota.bytes > 0) return { kind: "limited", bytes: quota.bytes };
  if (quota.state === "bandwidth") return { kind: "bandwidth", note: quota.note || BANDWIDTH_NOTE };
  if (quota.state === "unlimited") return { kind: "unlimited" };
  return { kind: "unknown" };
}

export interface TrafficQuotaCopy {
  text: string;
  bar: number | null;
}

/** 未知配额只给标签。进度条只属于正配额，∞ 只属于明确不限额。 */
export function describeTrafficQuota(
  presentation: TrafficQuotaPresentation,
  usedBytes: number,
  unknownLabel = "未知配额",
): TrafficQuotaCopy {
  if (presentation.kind === "bandwidth") return { text: presentation.note, bar: null };
  if (presentation.kind === "unlimited") return { text: `${formatBytes(usedBytes)} / ∞`, bar: null };
  if (presentation.kind === "limited") {
    const ratio = usedBytes / presentation.bytes;
    return {
      text: `${formatBytes(usedBytes)} / ${formatBytes(presentation.bytes)}`,
      bar: Math.min(1, Math.max(0, ratio)),
    };
  }
  return { text: unknownLabel, bar: null };
}

export function trafficStatementsForNode(
  fields: unknown[],
  note: TrafficBillingNote | undefined,
): string[] {
  const statements = fields.flatMap((field) => collectStatements(field));
  if (!note) return statements;
  if (note.billing === "bandwidth") {
    statements.push(note.label && statementKind(note.label) === "bandwidth" ? note.label : BANDWIDTH_NOTE);
  } else if (note.billing === "unlimited") {
    statements.push(note.label && statementKind(note.label) === "unlimited" ? note.label : "不限流量");
  }
  return statements;
}
