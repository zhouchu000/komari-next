import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { describeExpiry } from "../src/lib/expiryDisplay.ts";
import { buildCityMapView } from "../src/lib/nodeCityMap.ts";
import {
  buildHomePerspectives,
  buildNodePingReport,
  parseHomeLatencyMap,
  targetHeadline,
} from "../src/lib/pingTargets.ts";
import { classifyTrafficLimit, parseTrafficBilling, trafficStatementsForNode, BANDWIDTH_NOTE } from "../src/lib/trafficQuota.ts";

const root = path.resolve(import.meta.dirname, "..");

test("missing expiry is unknown and does not claim long term", () => {
  assert.equal(describeExpiry("").kind, "unknown");
  assert.equal(describeExpiry(null).kind, "unknown");
  assert.equal(describeExpiry("not-a-date").kind, "invalid");
  const far = describeExpiry("2999-01-01T00:00:00Z", Date.parse("2026-01-01T00:00:00Z"));
  assert.equal(far.kind, "long_term");
  const soon = describeExpiry("2026-01-15T00:00:00Z", Date.parse("2026-01-01T00:00:00Z"));
  assert.equal(soon.kind, "remaining");
  assert.equal(soon.days, 14);
});

test("zero and missing quotas stay unknown unless a plan statement says otherwise", () => {
  for (const value of [null, "", 0, "0", -1, Number.NaN, "not-a-quota"]) {
    const quota = classifyTrafficLimit(value);
    assert.equal(quota.state, "unknown", String(value));
    assert.equal(quota.note, null);
    assert.equal(JSON.stringify(quota).includes("∞"), false);
  }
  assert.equal(classifyTrafficLimit("unlimited").state, "unlimited");
  assert.equal(classifyTrafficLimit("不限流量").state, "unlimited");
  assert.equal(classifyTrafficLimit(0, "不限流量").state, "unlimited");
  const bandwidth = classifyTrafficLimit(0, "按带宽不计流量");
  assert.equal(bandwidth.state, "bandwidth");
  assert.equal(bandwidth.note, "按带宽不计流量");
  assert.equal(JSON.stringify(bandwidth).includes("∞"), false);
  const stated = classifyTrafficLimit(0, trafficStatementsForNode([], {
    uuid: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    billing: "bandwidth",
    label: BANDWIDTH_NOTE,
  }));
  assert.equal(stated.state, "bandwidth");
  assert.equal(stated.note, BANDWIDTH_NOTE);
  const twoGigabytes = classifyTrafficLimit(2, "按带宽不计流量");
  assert.equal(twoGigabytes.state, "limited");
  assert.equal(twoGigabytes.bytes, 2 * 1024 ** 3);
  assert.equal(classifyTrafficLimit("1GB").bytes, 1024 ** 3);
  const billing = parseTrafficBilling({
    nodes: [
      { uuid: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", billing: "bandwidth", label: "按带宽不计流量" },
      { uuid: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", billing: "unknown" },
    ],
  });
  assert.equal(billing.notes.length, 1);
  assert.equal(billing.notes[0].billing, "bandwidth");
});

test("latency stays per target and failures are not zero milliseconds", () => {
  const records = [
    { client: "node", task_id: 1, time: "2026-01-01T00:00:00Z", value: 10 },
    { client: "node", task_id: 1, time: "2026-01-01T00:01:00Z", value: 30 },
    { client: "node", task_id: 2, time: "2026-01-01T00:00:00Z", value: 200 },
    { client: "node", task_id: 2, time: "2026-01-01T00:01:00Z", value: -1 },
    { client: "node", task_id: 3, time: "2026-01-01T00:00:00Z", value: -1 },
    { client: "node", task_id: 3, time: "2026-01-01T00:01:00Z", value: -1 },
    { client: "node", task_id: 4, time: "2026-01-01T00:00:00Z", value: 0 },
  ];
  const report = buildNodePingReport(records, [
    { id: 1, name: "国内", loss: 0 },
    { id: 2, name: "国际", loss: 50 },
    { id: 3, name: "失败", loss: 100 },
    { id: 4, name: "零延迟", loss: 0 },
  ], "server");
  const byId = new Map(report.targets.map((target) => [target.taskId, target]));
  assert.equal(byId.get(1)?.successAverageMs, 20);
  assert.equal(byId.get(2)?.successAverageMs, 200);
  assert.notEqual(byId.get(1)?.successAverageMs, 110);
  assert.equal(targetHeadline(byId.get(3)!), "unavailable");
  assert.equal(byId.get(3)?.latestLatencyMs, null);
  assert.equal(byId.get(3)?.successAverageMs, null);
  assert.deepEqual(targetHeadline(byId.get(4)!), { ms: 0 });
  assert.equal(byId.get(2)?.history.every((point) => point.latency === null || point.latency === 200), true);
});

test("home perspectives need an explicit route and do not borrow other samples", () => {
  const empty = parseHomeLatencyMap("");
  assert.equal(empty.configured, false);
  assert.equal(buildHomePerspectives("11111111-1111-1111-1111-111111111111", empty, [], []).status, "unconfigured");

  const map = parseHomeLatencyMap({
    source_uuid: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    routes: [
      { task_id: 3, server_uuid: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", protocol: "icmp" },
      { task_id: 11, server_uuid: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", protocol: "tcp" },
      { task_id: 12, server_uuid: "cccccccc-cccc-cccc-cccc-cccccccccccc", protocol: "tcp" },
    ],
  });
  const records = [
    { client: "router", task_id: 3, time: "2026-01-01T00:00:00Z", value: 15 },
    { client: "router", task_id: 11, time: "2026-01-01T00:00:00Z", value: 40 },
    { client: "router", task_id: 99, time: "2026-01-01T00:00:00Z", value: 1 },
  ];
  const perspective = buildHomePerspectives("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", map, records, [
    { id: 3, name: "icmp", type: "icmp" },
    { id: 11, name: "tcp", type: "tcp" },
  ]);
  assert.equal(perspective.status, "ready");
  assert.equal(perspective.targets.length, 2);
  assert.deepEqual(perspective.targets.map((target) => target.taskId), [3, 11]);
  assert.deepEqual(perspective.targets.map((target) => target.protocol), ["icmp", "tcp"]);
  assert.equal(perspective.targets.some((target) => target.successAverageMs === 1), false);
  const average = perspective.targets.reduce((sum, target) => sum + (target.successAverageMs ?? 0), 0) / perspective.targets.length;
  assert.notEqual(perspective.targets[0].successAverageMs, average);

  const missing = buildHomePerspectives("cccccccc-cccc-cccc-cccc-cccccccccccc", map, records, []);
  assert.equal(missing.targets[0].availability, "unknown");
  assert.equal(targetHeadline(missing.targets[0]), "unknown");

  const router = buildNodePingReport(records, [{ id: 3, name: "甲" }, { id: 11, name: "乙" }], "home", map.routes);
  assert.equal(router.targets.length >= 2, true);
  assert.notEqual(router.targets[0].successAverageMs, router.targets[1].successAverageMs);
});

test("official home probe export shape maps tasks without averaging", () => {
  const router = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const server = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const other = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const map = parseHomeLatencyMap({
    router_uuid: router,
    interval_seconds: 3600,
    tasks: [
      { id: 3, protocol: "icmp", server_uuid: server, server_name: "甲", ipv4: "203.0.113.10" },
      { id: 11, protocol: "tcp", server_uuid: server, server_name: "甲" },
      { id: 4, protocol: "icmp", server_uuid: other, server_name: "乙" },
    ],
  });
  assert.equal(map.configured, true);
  assert.equal(map.sourceUuid, router);
  assert.equal(map.routes.length, 3);
  assert.equal(JSON.stringify(map).includes("203.0.113.10"), false);
  const perspective = buildHomePerspectives(server, map, [
    { client: "router", task_id: 3, time: "2026-01-01T00:00:00Z", value: 12 },
    { client: "router", task_id: 11, time: "2026-01-01T00:00:00Z", value: 40 },
  ], []);
  assert.equal(perspective.targets.length, 2);
  assert.deepEqual(perspective.targets.map((target) => target.protocol), ["icmp", "tcp"]);
  assert.deepEqual(perspective.targets.map((target) => target.successAverageMs), [12, 40]);
});

test("conflicting protocol is unknown and placeholder maps are not configured", () => {
  const map = parseHomeLatencyMap({
    source_uuid: "REPLACE_WITH_ROUTER_UUID",
    routes: [{ task_id: 3, server_uuid: "REPLACE_WITH_SERVER_UUID", protocol: "icmp" }],
  });
  assert.equal(map.configured, false);
  const conflict = buildNodePingReport([], [{ id: 8, name: "目标", type: "tcp" }], "home", [
    { taskId: 8, serverUuid: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", protocol: "icmp" },
  ]);
  assert.equal(conflict.targets[0].protocol, "unknown");
});

test("city map aggregates a city and refuses unknown or conflicting coordinates", () => {
  const example = JSON.parse(fs.readFileSync(path.join(root, "examples/node-city-map.example.json"), "utf8"));
  const nodes = example.nodes.map((node: { uuid: string; name: string }) => ({ uuid: node.uuid, name: node.name }));
  const view = buildCityMapView(nodes, [nodes[0].uuid], example);
  const labels = view.groups.map((group) => group.label);
  assert.equal(labels.includes("圣何塞"), true);
  assert.equal(labels.includes("洛杉矶"), true);
  const sanJose = view.groups.find((group) => group.label === "圣何塞");
  assert.equal(sanJose?.nodes.length, 2);
  assert.equal(view.groups.some((group) => group.nodes.some((node) => node.name === "RakSmart 双 ISP")), false);
  assert.equal(view.unmapped.some((node) => node.name === "RakSmart 双 ISP" && node.reason === "do_not_pin"), true);
  assert.equal(JSON.stringify(view).includes("ipv4"), false);
});

test("public defaults do not embed the example node UUIDs", () => {
  const example = JSON.parse(fs.readFileSync(path.join(root, "examples/node-city-map.example.json"), "utf8"));
  const uuids: string[] = example.nodes.map((node: { uuid: string }) => node.uuid);
  const files = ["komari-theme.json", "src/lib/nodeCityMap.ts", "src/lib/pingTargets.ts", "src/contexts/ThemeContext.tsx"];
  for (const file of files) {
    const text = fs.readFileSync(path.join(root, file), "utf8");
    for (const uuid of uuids) {
      assert.equal(text.includes(uuid), false, `${file} contains ${uuid}`);
    }
  }
  const theme = JSON.parse(fs.readFileSync(path.join(root, "komari-theme.json"), "utf8"));
  const defaults = JSON.stringify(theme.configuration);
  assert.equal(defaults.includes("REPLACE_WITH_ROUTER_UUID"), false);
  assert.match(defaults, /"key":"homeLatencyMap"/);
  const billingDefaults: unknown[] = [];
  const visit = (value: unknown) => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!value || typeof value !== "object") return;
    const record = value as { key?: string; default?: unknown };
    if (record.key === "trafficBilling") billingDefaults.push(record.default);
    Object.values(record).forEach(visit);
  };
  visit(theme.configuration);
  assert.equal(billingDefaults.length >= 5, true);
  assert.equal(billingDefaults.every((value) => value === ""), true);
});
