import { useEffect, useMemo, useState } from "react";
import { useRPC2Call } from "@/contexts/RPC2Context";
import { fetchPingRecords, PING_RECORDS_AUTO_REFRESH_MS, type PingRecord, type PingTaskInfo } from "@/lib/pingRecords";
import {
  buildHomePerspectives,
  buildNodePingReport,
  parseHomeLatencyMap,
  type HomePerspective,
  type PingReport,
} from "@/lib/pingTargets";

export type { PingHistoryPoint, PingReport, PingTargetReport } from "@/lib/pingTargets";

export interface PingStats {
  report: PingReport;
  homePerspective: HomePerspective;
  homeState: "loading" | "unconfigured" | "unknown" | "ready";
  isSource: boolean;
  hasData: boolean;
  isLoaded: boolean;
  isLoading: boolean;
}

type RecordBundle = { records: PingRecord[]; tasks: PingTaskInfo[] };

const emptyReport: PingReport = { targets: [], role: "server", error: null };

function createStats(partial: Partial<PingStats> = {}): PingStats {
  return {
    report: emptyReport,
    homePerspective: { status: "unconfigured", targets: [] },
    homeState: "unconfigured",
    isSource: false,
    hasData: false,
    isLoaded: false,
    isLoading: false,
    ...partial,
  };
}

export function usePingStats(
  uuid: string,
  hours: number = 24,
  enabled: boolean = true,
  homeLatencyMap = "",
): PingStats {
  const { call } = useRPC2Call();
  const map = useMemo(() => parseHomeLatencyMap(homeLatencyMap), [homeLatencyMap]);
  const normalizedUuid = uuid.trim().toLowerCase();
  const isSource = Boolean(map.sourceUuid && map.sourceUuid === normalizedUuid);
  const sourceUuid = !isSource && map.configured ? map.sourceUuid : null;
  const [stats, setStats] = useState<PingStats>(() => createStats({ isSource }));

  useEffect(() => {
    if (!enabled) return;
    if (!normalizedUuid) {
      setStats(createStats({ isLoaded: true, isSource }));
      return;
    }

    let active = true;
    let own: RecordBundle | null = null;
    let source: RecordBundle | null = null;
    let ownLoaded = false;
    let sourceLoaded = sourceUuid == null;
    let sourceFailed = false;

    const publish = () => {
      if (!active) return;
      const report = buildNodePingReport(own?.records, own?.tasks, isSource ? "home" : "server", isSource ? map.routes : []);
      let homePerspective: HomePerspective = { status: "unconfigured", targets: [] };
      let homeState: PingStats["homeState"] = "unconfigured";
      if (isSource) {
        homePerspective = { status: "ready", targets: report.targets };
        homeState = "ready";
      } else if (!sourceLoaded) {
        homeState = "loading";
      } else if (!map.configured) {
        homeState = "unconfigured";
      } else if (sourceFailed) {
        homeState = "unknown";
      } else {
        homePerspective = buildHomePerspectives(normalizedUuid, map, source?.records, source?.tasks);
        homeState = homePerspective.status === "unconfigured" ? "unconfigured" : "ready";
      }
      setStats({
        report,
        homePerspective,
        homeState,
        isSource,
        hasData: report.targets.some((target) => target.successCount > 0 || target.failureCount > 0),
        isLoaded: ownLoaded,
        isLoading: !ownLoaded,
      });
    };

    const loadOwn = async (forceRefresh = false) => {
      try {
        const result = await fetchPingRecords(call, normalizedUuid, hours, { forceRefresh });
        own = { records: result.records, tasks: result.tasks };
      } catch {
        own = { records: [], tasks: [] };
      } finally {
        ownLoaded = true;
        publish();
      }
    };

    const loadSource = async (forceRefresh = false) => {
      if (!sourceUuid) return;
      try {
        const result = await fetchPingRecords(call, sourceUuid, hours, { forceRefresh });
        source = { records: result.records, tasks: result.tasks };
        sourceFailed = false;
      } catch {
        source = null;
        sourceFailed = true;
      } finally {
        sourceLoaded = true;
        publish();
      }
    };

    publish();
    void loadOwn();
    void loadSource();
    const timer = window.setInterval(() => {
      void loadOwn(true);
      void loadSource(true);
    }, PING_RECORDS_AUTO_REFRESH_MS);

    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [normalizedUuid, hours, enabled, call, isSource, map, sourceUuid]);

  return stats;
}
