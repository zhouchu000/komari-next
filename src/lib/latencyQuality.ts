import type { PingProtocol, ProbeRole } from "./pingTargets";

export type LatencyTone = "none" | "unrated" | "normal" | "elevated" | "abnormal" | "unavailable";
export type LatencyScaleSource = "explicit" | "baseline" | "insufficient";

export interface LatencyQualityOptions {
  minSamples: number;
  greenRatio: number;
  yellowRatio: number;
  greenSlackMs: number;
  yellowSlackMs: number;
}

export interface LatencyRouteBand {
  source: string;
  taskId: number | null;
  serverUuid: string | null;
  protocol: "icmp" | "tcp" | null;
  greenMaxMs: number;
  yellowMaxMs: number;
}

export interface LatencyQualityConfig {
  options: LatencyQualityOptions;
  routes: LatencyRouteBand[];
  error: string | null;
}

export interface LatencyScale {
  source: LatencyScaleSource;
  baselineMs: number | null;
  greenMaxMs: number | null;
  yellowMaxMs: number | null;
  successSamples: number;
  minSamples: number;
}

export interface LatencyRouteIdentity {
  role: ProbeRole;
  taskId: number;
  protocol: PingProtocol;
  linkedServerUuid: string | null;
}

export const DEFAULT_LATENCY_QUALITY: LatencyQualityOptions = {
  minSamples: 8,
  greenRatio: 1.25,
  yellowRatio: 1.85,
  greenSlackMs: 12,
  yellowSlackMs: 30,
};

export const LOSS_NORMAL_MAX = 1;
export const LOSS_ELEVATED_MAX = 5;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function asText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readPositive(value: unknown): number | null {
  const numeric = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  if (!Number.isFinite(numeric) || numeric < 0) return null;
  return numeric;
}

function percentile(sorted: number[], ratio: number): number {
  if (sorted.length === 0) return 0;
  const index = (sorted.length - 1) * ratio;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

export function emptyLatencyQuality(): LatencyQualityConfig {
  return { options: { ...DEFAULT_LATENCY_QUALITY }, routes: [], error: null };
}

export function parseLatencyQuality(input: unknown): LatencyQualityConfig {
  const empty = emptyLatencyQuality();
  if (input == null) return empty;
  let value = input;
  if (typeof input === "string") {
    const trimmed = input.trim();
    if (!trimmed) return empty;
    try {
      value = JSON.parse(trimmed);
    } catch {
      return { ...empty, error: "invalid_json" };
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ...empty, error: "invalid_shape" };
  }
  const record = value as Record<string, unknown>;
  const minSamples = readPositive(record.min_samples ?? record.minSamples);
  const greenRatio = readPositive(record.green_ratio ?? record.greenRatio);
  const yellowRatio = readPositive(record.yellow_ratio ?? record.yellowRatio);
  const greenSlackMs = readPositive(record.green_slack_ms ?? record.greenSlackMs);
  const yellowSlackMs = readPositive(record.yellow_slack_ms ?? record.yellowSlackMs);
  const options: LatencyQualityOptions = {
    minSamples: minSamples == null ? DEFAULT_LATENCY_QUALITY.minSamples : Math.round(clamp(minSamples, 4, 48)),
    greenRatio: greenRatio == null ? DEFAULT_LATENCY_QUALITY.greenRatio : clamp(greenRatio, 1.05, 2),
    yellowRatio: yellowRatio == null ? DEFAULT_LATENCY_QUALITY.yellowRatio : clamp(yellowRatio, 1.2, 4),
    greenSlackMs: greenSlackMs == null ? DEFAULT_LATENCY_QUALITY.greenSlackMs : clamp(greenSlackMs, 0, 80),
    yellowSlackMs: yellowSlackMs == null ? DEFAULT_LATENCY_QUALITY.yellowSlackMs : clamp(yellowSlackMs, 0, 120),
  };
  if (options.yellowRatio <= options.greenRatio) options.yellowRatio = Math.min(4, options.greenRatio + 0.2);

  const rawRoutes = Array.isArray(record.routes) ? record.routes : Array.isArray(record.bands) ? record.bands : [];
  const routes: LatencyRouteBand[] = [];
  for (const item of rawRoutes) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const entry = item as Record<string, unknown>;
    const sourceText = asText(entry.source ?? entry.source_uuid ?? entry.sourceUuid).toLowerCase();
    const source = sourceText === "server" || sourceText === "home"
      ? sourceText
      : UUID_PATTERN.test(sourceText) ? sourceText : null;
    const taskId = readPositive(entry.task_id ?? entry.taskId);
    const serverText = asText(entry.server_uuid ?? entry.serverUuid ?? entry.target_uuid ?? entry.targetUuid).toLowerCase();
    const serverUuid = UUID_PATTERN.test(serverText) ? serverText : null;
    const protocolText = asText(entry.protocol).toLowerCase();
    const protocol = protocolText === "icmp" || protocolText === "tcp" ? protocolText : null;
    const greenMaxMs = readPositive(entry.green_max_ms ?? entry.greenMaxMs);
    const yellowMaxMs = readPositive(entry.yellow_max_ms ?? entry.yellowMaxMs);
    if (!source || (taskId == null && !serverUuid) || greenMaxMs == null || yellowMaxMs == null) continue;
    if (greenMaxMs <= 0 || yellowMaxMs < greenMaxMs) continue;
    routes.push({
      source,
      taskId: taskId == null ? null : Math.round(taskId),
      serverUuid,
      protocol,
      greenMaxMs,
      yellowMaxMs,
    });
  }
  return { options, routes, error: null };
}

function sourceMatches(band: LatencyRouteBand, target: LatencyRouteIdentity, sourceUuid: string | null): boolean {
  if (band.source === "server") return target.role === "server";
  if (band.source === "home") return target.role === "home";
  return sourceUuid != null && band.source === sourceUuid.trim().toLowerCase();
}

export function matchLatencyBand(
  routes: LatencyRouteBand[],
  target: LatencyRouteIdentity,
  sourceUuid: string | null,
): LatencyRouteBand | null {
  let best: LatencyRouteBand | null = null;
  let bestScore = -1;
  for (const band of routes) {
    if (!sourceMatches(band, target, sourceUuid)) continue;
    if (band.taskId != null && band.taskId !== target.taskId) continue;
    if (band.serverUuid && band.serverUuid !== (target.linkedServerUuid ?? "").toLowerCase()) continue;
    if (band.protocol && band.protocol !== target.protocol) continue;
    const score = (band.taskId != null ? 4 : 0) + (band.serverUuid ? 2 : 0) + (band.protocol ? 1 : 0);
    if (score > bestScore) {
      best = band;
      bestScore = score;
    }
  }
  return best;
}

function limitsFor(baselineMs: number, options: LatencyQualityOptions): { greenMaxMs: number; yellowMaxMs: number } {
  const greenMaxMs = baselineMs * options.greenRatio + options.greenSlackMs;
  const yellowMaxMs = Math.max(greenMaxMs, baselineMs * options.yellowRatio + options.yellowSlackMs);
  return { greenMaxMs, yellowMaxMs };
}

function healthyCluster(sorted: number[], minSamples: number): number[] | null {
  let splitAt = -1;
  for (let index = 0; index < sorted.length - 1; index += 1) {
    const current = sorted[index];
    const next = sorted[index + 1];
    if (next > current * 1.8 + 30 && index + 1 >= Math.min(4, minSamples)) {
      splitAt = index;
      break;
    }
  }
  if (splitAt < 0) return sorted.length >= minSamples ? sorted : null;
  const lower = sorted.slice(0, splitAt + 1);
  return lower.length >= minSamples ? lower : null;
}

/** This route's own healthier successes. A steady 180 ms route stays near 180; a higher outage cluster does not become the baseline. */
export function deriveLatencyScale(successLatencies: number[], options: LatencyQualityOptions = DEFAULT_LATENCY_QUALITY): LatencyScale {
  const clean = successLatencies.filter((value) => Number.isFinite(value) && value >= 0).sort((left, right) => left - right);
  const base = {
    baselineMs: null,
    greenMaxMs: null,
    yellowMaxMs: null,
    successSamples: clean.length,
    minSamples: options.minSamples,
  };
  const cluster = healthyCluster(clean, options.minSamples);
  if (!cluster) return { ...base, source: "insufficient" };
  const baselineMs = percentile(cluster, 0.4);
  const limits = limitsFor(baselineMs, options);
  return { source: "baseline", ...base, baselineMs, ...limits };
}

export function explicitLatencyScale(band: LatencyRouteBand, successSamples: number, minSamples: number): LatencyScale {
  return {
    source: "explicit",
    baselineMs: null,
    greenMaxMs: band.greenMaxMs,
    yellowMaxMs: band.yellowMaxMs,
    successSamples,
    minSamples,
  };
}

export function gradeLatency(value: number | null, failed: boolean, scale: LatencyScale): LatencyTone {
  if (failed) return "unavailable";
  if (value == null || !Number.isFinite(value)) return "none";
  if (scale.greenMaxMs == null || scale.yellowMaxMs == null) return "unrated";
  if (value <= scale.greenMaxMs) return "normal";
  if (value <= scale.yellowMaxMs) return "elevated";
  return "abnormal";
}

export function gradeLoss(lossPercent: number | null): LatencyTone {
  if (lossPercent == null || !Number.isFinite(lossPercent)) return "none";
  if (lossPercent <= LOSS_NORMAL_MAX) return "normal";
  if (lossPercent <= LOSS_ELEVATED_MAX) return "elevated";
  return "abnormal";
}

export function latencyToneClass(tone: LatencyTone): string {
  if (tone === "normal") return "bg-emerald-500";
  if (tone === "elevated") return "bg-amber-500";
  if (tone === "abnormal") return "bg-rose-500";
  if (tone === "unavailable") return "bg-rose-500/80";
  if (tone === "unrated") return "bg-slate-400/50";
  return "bg-muted-foreground/18";
}

export function latencyTextClass(tone: LatencyTone): string {
  if (tone === "normal") return "text-emerald-600 dark:text-emerald-300";
  if (tone === "elevated") return "text-amber-600 dark:text-amber-300";
  if (tone === "abnormal" || tone === "unavailable") return "text-rose-600 dark:text-rose-300";
  return "text-foreground/80";
}
