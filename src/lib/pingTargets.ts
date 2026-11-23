import type { PingRecord, PingTaskInfo } from "./pingRecords";

export interface PingHistoryPoint {
  time: string;
  latency: number | null;
  loss: number | null;
  failed: boolean;
}

export interface PingSamplePoint {
  time: string;
  latency: number | null;
  failed: boolean;
}

export type PingAvailability = "ok" | "unavailable" | "unconfigured" | "unknown" | "empty";
export type ProbeRole = "server" | "home";
export type PingProtocol = "icmp" | "tcp" | "unknown";
export type LatestPingStatus = "success" | "failure" | "none";

export interface PingTargetReport {
  taskId: number;
  name: string;
  role: ProbeRole;
  protocol: PingProtocol;
  availability: PingAvailability;
  latestStatus: LatestPingStatus;
  latestLatencyMs: number | null;
  successAverageMs: number | null;
  lossPercent: number | null;
  volatility: number | null;
  history: PingHistoryPoint[];
  samples: PingSamplePoint[];
  successCount: number;
  failureCount: number;
  linkedServerUuid: string | null;
}

export interface HomeLatencyRoute {
  taskId: number;
  serverUuid: string;
  protocol: PingProtocol;
  label?: string;
}

export interface HomeLatencyMap {
  sourceUuid: string | null;
  routes: HomeLatencyRoute[];
  error: string | null;
  configured: boolean;
}

export interface PingReport {
  targets: PingTargetReport[];
  role: ProbeRole;
  error: string | null;
}

const HISTORY_BUCKET_COUNT = 28;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function isSuccessfulLatency(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function readLabel(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim().replace(/\s+/g, " ");
  if (!trimmed || trimmed.length > 80) return undefined;
  return trimmed;
}

function readTaskId(value: unknown): number | null {
  const id = typeof value === "number" ? value : typeof value === "string" && /^\d+$/.test(value.trim()) ? Number(value.trim()) : NaN;
  if (!Number.isInteger(id) || id < 0) return null;
  return id;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function normalizePingProtocol(value: unknown): PingProtocol | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === "icmp" || normalized === "tcp") return normalized;
  return null;
}

function readUuid(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().toLowerCase();
  return UUID_PATTERN.test(trimmed) ? trimmed : null;
}

export function parseHomeLatencyMap(input: unknown): HomeLatencyMap {
  const empty = { sourceUuid: null, routes: [], error: null, configured: false };
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
  if (!isRecord(value)) return { ...empty, error: "invalid_shape" };

  const sourceUuid = readUuid(value.source_uuid ?? value.sourceUuid ?? value.router_uuid ?? value.routerUuid);
  const rawRoutes = Array.isArray(value.routes)
    ? value.routes
    : Array.isArray(value.tasks)
      ? value.tasks
      : null;
  if (rawRoutes == null) return { ...empty, error: "invalid_shape" };
  if (!sourceUuid) {
    return rawRoutes.length === 0 ? empty : { ...empty, error: "missing_source" };
  }

  const routes: HomeLatencyRoute[] = [];
  const seen = new Set<string>();
  for (const item of rawRoutes) {
    if (!isRecord(item)) continue;
    const taskId = readTaskId(item.task_id ?? item.taskId ?? item.id);
    const serverUuid = readUuid(item.server_uuid ?? item.serverUuid);
    if (taskId == null || !serverUuid) continue;
    const key = `${taskId}:${serverUuid}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const label = readLabel(item.label ?? item.server_name ?? item.serverName);
    const routeProtocol = normalizePingProtocol(item.protocol);
    routes.push({
      taskId,
      serverUuid,
      protocol: routeProtocol ?? "unknown",
      ...(label ? { label } : {}),
    });
  }

  return {
    sourceUuid,
    routes,
    error: null,
    configured: true,
  };
}

export function resolvePingProtocol(routeProtocol: PingProtocol, taskType: unknown): PingProtocol {
  const fromTask = normalizePingProtocol(taskType);
  if (routeProtocol !== "unknown" && fromTask && fromTask !== routeProtocol) return "unknown";
  if (routeProtocol !== "unknown") return routeProtocol;
  return fromTask ?? "unknown";
}

function emptyTarget(
  taskId: number,
  name: string,
  role: ProbeRole,
  availability: PingAvailability,
  protocol: PingProtocol = "unknown",
  linkedServerUuid: string | null = null,
): PingTargetReport {
  return {
    taskId,
    name,
    role,
    protocol,
    availability,
    latestStatus: "none",
    latestLatencyMs: null,
    successAverageMs: null,
    lossPercent: null,
    volatility: null,
    history: [],
    samples: [],
    successCount: 0,
    failureCount: 0,
    linkedServerUuid,
  };
}

function summarizeTask(task: PingTaskInfo | undefined): { state: "ok"; ms: number } | { state: "unavailable" } | { state: "empty" } {
  if (!task) return { state: "empty" };
  const loss = typeof task.loss === "number" && Number.isFinite(task.loss) ? task.loss : null;
  const total = typeof task.total === "number" && Number.isFinite(task.total) ? task.total : null;
  const readings = [task.latest, task.value, task.avg, task.min, task.p50].filter(isSuccessfulLatency);
  if (loss !== null && loss >= 100) return { state: "unavailable" };
  if (total === 0) return { state: "empty" };
  if (readings.length === 0) {
    return loss !== null && loss > 0 ? { state: "unavailable" } : { state: "empty" };
  }
  if (loss === null && total === null && readings.every((value) => value === 0)) {
    return { state: "empty" };
  }
  return { state: "ok", ms: readings[0] };
}

function buildHistory(samples: Array<{ timestamp: number; value: number }>): PingHistoryPoint[] {
  if (samples.length === 0) return [];
  const firstTime = samples[0].timestamp;
  const lastTime = samples[samples.length - 1].timestamp;
  const bucketCount = Math.min(HISTORY_BUCKET_COUNT, samples.length);
  const bucketSize = Math.max(1, (lastTime - firstTime) / bucketCount);
  return Array.from({ length: bucketCount }, (_, index) => {
    const startTime = firstTime + bucketSize * index;
    const endTime = index === bucketCount - 1 ? lastTime + 1 : startTime + bucketSize;
    const bucket = samples.filter((sample) => sample.timestamp >= startTime && sample.timestamp < endTime);
    const successes = bucket.filter((sample) => isSuccessfulLatency(sample.value));
    const failed = bucket.length > 0 && successes.length === 0;
    return {
      time: new Date(startTime).toISOString(),
      latency: successes.length > 0 ? successes.reduce((sum, sample) => sum + sample.value, 0) / successes.length : null,
      loss: bucket.length > 0 ? ((bucket.length - successes.length) / bucket.length) * 100 : null,
      failed,
    };
  });
}

function buildTarget(
  taskId: number,
  role: ProbeRole,
  records: PingRecord[],
  task: PingTaskInfo | undefined,
  options: { label?: string; protocol?: PingProtocol; linkedServerUuid?: string | null; missing?: PingAvailability } = {},
): PingTargetReport {
  const name = options.label || task?.name || `任务 ${taskId}`;
  const protocol = resolvePingProtocol(options.protocol ?? "unknown", task?.type);
  const linkedServerUuid = options.linkedServerUuid ?? null;
  const samples = records
    .filter((record) => record.task_id === taskId && typeof record.time === "string")
    .map((record) => ({ timestamp: new Date(record.time).getTime(), value: record.value }))
    .filter((record) => Number.isFinite(record.timestamp))
    .sort((left, right) => left.timestamp - right.timestamp);

  if (samples.length === 0 && !task) {
    return emptyTarget(taskId, name, role, options.missing ?? "empty", protocol, linkedServerUuid);
  }

  const successes = samples.filter((sample) => isSuccessfulLatency(sample.value));
  const failureCount = samples.length - successes.length;
  let latestStatus: LatestPingStatus = "none";
  let latestLatencyMs: number | null = null;
  if (samples.length > 0) {
    const latest = samples[samples.length - 1];
    if (isSuccessfulLatency(latest.value)) {
      latestStatus = "success";
      latestLatencyMs = latest.value;
    } else {
      latestStatus = "failure";
    }
  }

  let successAverageMs = successes.length > 0
    ? successes.reduce((sum, sample) => sum + sample.value, 0) / successes.length
    : null;
  let lossPercent = samples.length > 0 ? (failureCount / samples.length) * 100 : null;
  const volatility = typeof task?.p99_p50_ratio === "number" && Number.isFinite(task.p99_p50_ratio) && task.p99_p50_ratio > 0
    ? task.p99_p50_ratio
    : null;
  let availability: PingAvailability;
  let successCount = successes.length;

  if (samples.length > 0) {
    availability = successCount === 0 ? "unavailable" : "ok";
  } else {
    const summary = summarizeTask(task);
    if (summary.state === "ok") {
      availability = "ok";
      latestStatus = "success";
      latestLatencyMs = summary.ms;
      successAverageMs = summary.ms;
      lossPercent = typeof task?.loss === "number" ? task.loss : 0;
      successCount = 1;
    } else if (summary.state === "unavailable") {
      availability = "unavailable";
      latestStatus = "failure";
      lossPercent = typeof task?.loss === "number" ? task.loss : 100;
    } else {
      availability = options.missing ?? "empty";
    }
  }

  return {
    taskId,
    name,
    role,
    protocol,
    availability,
    latestStatus,
    latestLatencyMs,
    successAverageMs,
    lossPercent,
    volatility,
    history: buildHistory(samples),
    samples: samples.map((sample) => ({
      time: new Date(sample.timestamp).toISOString(),
      latency: isSuccessfulLatency(sample.value) ? sample.value : null,
      failed: !isSuccessfulLatency(sample.value),
    })),
    successCount,
    failureCount,
    linkedServerUuid,
  };
}

function indexTasks(tasks: PingTaskInfo[]): Map<number, PingTaskInfo> {
  const taskById = new Map<number, PingTaskInfo>();
  for (const task of tasks) {
    if (typeof task?.id === "number" && Number.isInteger(task.id)) taskById.set(task.id, task);
  }
  return taskById;
}

export function buildNodePingReport(
  records: PingRecord[] | null | undefined,
  tasks: PingTaskInfo[] | null | undefined,
  role: ProbeRole,
  routes: HomeLatencyRoute[] = [],
): PingReport {
  const safeRecords = Array.isArray(records) ? records : [];
  const safeTasks = Array.isArray(tasks) ? tasks : [];
  const taskById = indexTasks(safeTasks);
  const ids = new Set<number>(taskById.keys());
  for (const record of safeRecords) {
    if (typeof record?.task_id === "number") ids.add(record.task_id);
  }
  const routeByTask = new Map<number, HomeLatencyRoute>();
  for (const route of routes) {
    if (!routeByTask.has(route.taskId)) routeByTask.set(route.taskId, route);
    ids.add(route.taskId);
  }

  const targets = [...ids]
    .sort((left, right) => left - right)
    .map((id) => {
      const route = routeByTask.get(id);
      return buildTarget(id, role, safeRecords, taskById.get(id), {
        label: route?.label,
        protocol: route?.protocol,
        linkedServerUuid: route?.serverUuid ?? null,
        missing: role === "home" ? "unknown" : "empty",
      });
    });

  return { targets, role, error: null };
}

export interface HomePerspective {
  status: "unconfigured" | "ready";
  targets: PingTargetReport[];
}

export function buildHomePerspectives(
  serverUuid: string,
  map: HomeLatencyMap,
  records: PingRecord[] | null | undefined,
  tasks: PingTaskInfo[] | null | undefined,
): HomePerspective {
  if (!map.configured || !map.sourceUuid || map.error) {
    return { status: "unconfigured", targets: [] };
  }
  const routes = map.routes.filter((route) => route.serverUuid === serverUuid.trim().toLowerCase());
  if (routes.length === 0) return { status: "unconfigured", targets: [] };
  const safeRecords = Array.isArray(records) ? records : [];
  const taskById = indexTasks(Array.isArray(tasks) ? tasks : []);
  return {
    status: "ready",
    targets: routes.map((route) => buildTarget(
      route.taskId,
      "home",
      safeRecords,
      taskById.get(route.taskId),
      {
        label: route.label,
        protocol: route.protocol,
        linkedServerUuid: route.serverUuid,
        missing: "unknown",
      },
    )),
  };
}

export type PingHeadline = "unconfigured" | "unknown" | "unavailable" | "empty" | { ms: number };

export function targetHeadline(target: PingTargetReport): PingHeadline {
  if (target.availability === "unconfigured") return "unconfigured";
  if (target.availability === "unknown") return "unknown";
  if (target.latestStatus === "success" && target.latestLatencyMs !== null) return { ms: target.latestLatencyMs };
  if (target.availability === "unavailable" || target.latestStatus === "failure") return "unavailable";
  if (target.successAverageMs !== null) return { ms: target.successAverageMs };
  return target.availability === "empty" ? "empty" : "unknown";
}
