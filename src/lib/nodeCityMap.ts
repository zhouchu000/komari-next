export interface MapNodeRef {
  uuid: string;
  name: string;
}

export type CityPinReason = "unconfigured" | "unknown" | "conflict" | "do_not_pin" | "invalid";

export interface CityMapNodeView {
  uuid: string;
  name: string;
  online: boolean;
}

export interface UnmappedCityNode extends CityMapNodeView {
  reason: CityPinReason;
}

export interface CityMapGroup {
  key: string;
  label: string;
  city: string | null;
  admin1: string | null;
  countryCode: string | null;
  latitude: number;
  longitude: number;
  confidence: "high" | "medium";
  total: number;
  online: number;
  offline: number;
  status: "online" | "offline" | "partial";
  nodes: CityMapNodeView[];
}

export interface CityMapView {
  configured: boolean;
  parseError: string | null;
  groups: CityMapGroup[];
  unmapped: UnmappedCityNode[];
  totalNodes: number;
  onlineNodes: number;
  offlineNodes: number;
}

interface CityEntry {
  uuid: string;
  name: string | null;
  city: string | null;
  cityZh: string | null;
  admin1: string | null;
  countryCode: string | null;
  latitude: number | null;
  longitude: number | null;
  coordinatePrecision: string | null;
  confidence: string | null;
  sameCityGroup: string | null;
  pinPolicy: string | null;
  conflict: boolean;
}

const PIN_CONFIDENCE = new Set(["high", "medium"]);
const BLOCKED_PRECISION = new Set(["unknown", "country", "country_centroid", "centroid"]);
const SENSITIVE_KEY = /(^|_)(ip|ipv4|ipv6|ip_address|public_ip|private_ip|host|hostname|secret|token|password|credential)s?$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function readText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function readCoord(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && /^-?\d+(\.\d+)?$/.test(value.trim())) {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function coordsValid(latitude: number | null, longitude: number | null): boolean {
  return (
    latitude !== null &&
    longitude !== null &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180
  );
}

function samePoint(left: CityEntry, right: CityEntry): boolean {
  if (left.latitude === null || left.longitude === null || right.latitude === null || right.longitude === null) {
    return left.latitude === right.latitude && left.longitude === right.longitude;
  }
  return Math.abs(left.latitude - right.latitude) < 1e-4 && Math.abs(left.longitude - right.longitude) < 1e-4;
}

function entriesConflict(left: CityEntry, right: CityEntry): boolean {
  return (
    left.pinPolicy !== right.pinPolicy ||
    left.confidence !== right.confidence ||
    left.coordinatePrecision !== right.coordinatePrecision ||
    left.sameCityGroup !== right.sameCityGroup ||
    left.city !== right.city ||
    left.cityZh !== right.cityZh ||
    left.countryCode !== right.countryCode ||
    !samePoint(left, right)
  );
}

function readEntry(raw: unknown, fallbackUuid?: string): CityEntry | null {
  if (!isRecord(raw)) return null;
  if (Object.keys(raw).some((key) => SENSITIVE_KEY.test(key))) {
    // Sensitive fields are ignored below; presence alone does not reject a city pin.
  }
  const uuid = readText(raw.uuid) ?? fallbackUuid ?? null;
  if (!uuid) return null;
  return {
    uuid,
    name: readText(raw.name),
    city: readText(raw.city),
    cityZh: readText(raw.city_zh ?? raw.cityZh),
    admin1: readText(raw.admin1),
    countryCode: readText(raw.country_code ?? raw.countryCode)?.toUpperCase() ?? null,
    latitude: readCoord(raw.latitude),
    longitude: readCoord(raw.longitude),
    coordinatePrecision: readText(raw.coordinate_precision ?? raw.coordinatePrecision)?.toLowerCase() ?? null,
    confidence: readText(raw.confidence)?.toLowerCase() ?? null,
    sameCityGroup: readText(raw.same_city_group ?? raw.sameCityGroup)?.toLowerCase() ?? null,
    pinPolicy: readText(raw.pin_policy ?? raw.pinPolicy)?.toLowerCase() ?? null,
    conflict: false,
  };
}

function collectRawEntries(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (!isRecord(value)) return [];
  if (Array.isArray(value.nodes)) return value.nodes;
  return Object.entries(value)
    .filter(([key]) => key !== "generated_at" && key !== "purpose" && key !== "sources_used")
    .map(([key, entry]) => (isRecord(entry) ? { ...entry, uuid: readText(entry.uuid) ?? key } : entry));
}

export function parseNodeCityMap(input: unknown): { entries: CityEntry[]; configured: boolean; parseError: string | null } {
  if (input == null) return { entries: [], configured: false, parseError: null };
  let value = input;
  if (typeof input === "string") {
    const trimmed = input.trim();
    if (!trimmed) return { entries: [], configured: false, parseError: null };
    try {
      value = JSON.parse(trimmed);
    } catch {
      return { entries: [], configured: false, parseError: "invalid_json" };
    }
  }

  const rawEntries = collectRawEntries(value);
  if (rawEntries.length === 0 && !Array.isArray(value) && !(isRecord(value) && Array.isArray(value.nodes))) {
    if (isRecord(value) && Object.keys(value).length === 0) {
      return { entries: [], configured: false, parseError: null };
    }
    if (!isRecord(value) && !Array.isArray(value)) {
      return { entries: [], configured: false, parseError: "invalid_shape" };
    }
  }

  const grouped = new Map<string, CityEntry[]>();
  for (const raw of rawEntries) {
    const entry = readEntry(raw);
    if (!entry) continue;
    const list = grouped.get(entry.uuid) ?? [];
    list.push(entry);
    grouped.set(entry.uuid, list);
  }

  const entries: CityEntry[] = [];
  for (const list of grouped.values()) {
    const [first] = list;
    const conflict = list.length > 1 && list.some((entry) => entriesConflict(first, entry));
    entries.push({ ...first, conflict });
  }

  return { entries, configured: entries.length > 0, parseError: null };
}

function pinBlockReason(entry: CityEntry): CityPinReason | null {
  if (entry.conflict) return "conflict";
  if (entry.pinPolicy === "do_not_pin") return "do_not_pin";
  if (entry.pinPolicy !== "pin_city") return "unknown";
  if (!PIN_CONFIDENCE.has(entry.confidence ?? "")) return "unknown";
  if (entry.coordinatePrecision && BLOCKED_PRECISION.has(entry.coordinatePrecision)) return "unknown";
  if (!coordsValid(entry.latitude, entry.longitude)) return "invalid";
  return null;
}

function canPin(entry: CityEntry): entry is CityEntry & { latitude: number; longitude: number; confidence: "high" | "medium" } {
  return pinBlockReason(entry) === null;
}

function groupKey(entry: CityEntry & { latitude: number; longitude: number }): string {
  if (entry.sameCityGroup) return `group:${entry.sameCityGroup}`;
  const city = (entry.cityZh || entry.city || "").toLowerCase();
  return `city:${city}:${entry.latitude.toFixed(3)}:${entry.longitude.toFixed(3)}`;
}

function regionStatus(online: number, offline: number): CityMapGroup["status"] {
  if (online === 0) return "offline";
  if (offline === 0) return "online";
  return "partial";
}

export function buildCityMapView(
  nodes: MapNodeRef[],
  onlineUuids: Iterable<string>,
  rawConfig: unknown,
): CityMapView {
  const online = new Set(onlineUuids);
  const parsed = parseNodeCityMap(rawConfig);
  const byUuid = new Map(parsed.entries.map((entry) => [entry.uuid, entry]));
  const groups = new Map<string, CityMapGroup>();
  const unmapped: UnmappedCityNode[] = [];
  const pinnedMembers = new Map<string, CityEntry[]>();

  const views = nodes
    .filter((node) => readText(node.uuid))
    .map((node) => ({
      uuid: node.uuid.trim(),
      name: readText(node.name) ?? "未命名节点",
      online: online.has(node.uuid.trim()),
      entry: byUuid.get(node.uuid.trim()),
    }));

  for (const node of views) {
    const entry = node.entry;
    if (!entry || !canPin(entry)) continue;
    const key = groupKey(entry);
    const list = pinnedMembers.get(key) ?? [];
    list.push(entry);
    pinnedMembers.set(key, list);
  }

  const conflictedGroups = new Set<string>();
  for (const [key, members] of pinnedMembers) {
    const [first] = members;
    if (members.some((member) => !samePoint(first, member))) {
      conflictedGroups.add(key);
    }
  }

  for (const node of views) {
    const entry = node.entry;
    const view = { uuid: node.uuid, name: node.name, online: node.online };
    if (!entry || !canPin(entry)) {
      unmapped.push({ ...view, reason: entry ? pinBlockReason(entry) ?? "unknown" : "unconfigured" });
      continue;
    }
    const key = groupKey(entry);
    if (conflictedGroups.has(key)) {
      unmapped.push({ ...view, reason: "conflict" });
      continue;
    }
    const existing = groups.get(key);
    if (existing) {
      existing.nodes.push(view);
      existing.total += 1;
      if (view.online) existing.online += 1;
      else existing.offline += 1;
      existing.status = regionStatus(existing.online, existing.offline);
      continue;
    }
    const label = entry.cityZh || entry.city || entry.sameCityGroup || "未命名城市";
    groups.set(key, {
      key,
      label,
      city: entry.cityZh || entry.city,
      admin1: entry.admin1,
      countryCode: entry.countryCode,
      latitude: entry.latitude,
      longitude: entry.longitude,
      confidence: entry.confidence,
      total: 1,
      online: view.online ? 1 : 0,
      offline: view.online ? 0 : 1,
      status: view.online ? "online" : "offline",
      nodes: [view],
    });
  }

  const ordered = [...groups.values()].sort((left, right) => {
    if (right.total !== left.total) return right.total - left.total;
    return left.label.localeCompare(right.label, "zh-CN");
  });
  for (const group of ordered) {
    group.nodes.sort((left, right) => left.name.localeCompare(right.name, "zh-CN"));
  }
  unmapped.sort((left, right) => left.name.localeCompare(right.name, "zh-CN"));

  const onlineNodes = views.filter((node) => node.online).length;
  return {
    configured: parsed.configured && !parsed.parseError,
    parseError: parsed.parseError,
    groups: ordered,
    unmapped,
    totalNodes: views.length,
    onlineNodes,
    offlineNodes: views.length - onlineNodes,
  };
}

export function cityMapContainsSensitiveKeys(value: unknown): boolean {
  if (Array.isArray(value)) return value.some((item) => cityMapContainsSensitiveKeys(item));
  if (!isRecord(value)) return false;
  return Object.entries(value).some(([key, child]) => SENSITIVE_KEY.test(key) || cityMapContainsSensitiveKeys(child));
}
