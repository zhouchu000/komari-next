import type { TFunction } from "i18next";
import type { PingHistoryPoint, PingStats } from "@/hooks/usePingStats";
import { targetHeadline, type PingProtocol, type PingTargetReport } from "@/lib/pingTargets";

const PING_HISTORY_PLACEHOLDER_POINTS: PingHistoryPoint[] = Array.from({ length: 12 }, (_, index) => ({
  time: `placeholder-${index}`,
  latency: null,
  loss: null,
  failed: false,
}));

function formatLatency(ms: number): string {
  return `${Math.round(ms)} ms`;
}

function protocolLabel(t: TFunction, protocol: PingProtocol): string {
  if (protocol === "icmp") return t("nodeCard.protocolIcmp", { defaultValue: "ICMP" });
  if (protocol === "tcp") return t("nodeCard.protocolTcp", { defaultValue: "TCP" });
  return t("nodeCard.protocolUnknown", { defaultValue: "未知" });
}

function headlineText(t: TFunction, target: PingTargetReport): string {
  const headline = targetHeadline(target);
  if (headline === "unconfigured") return t("nodeCard.pingUnconfigured", { defaultValue: "未配置" });
  if (headline === "unknown") return t("nodeCard.pingUnknown", { defaultValue: "未知" });
  if (headline === "unavailable") return t("nodeCard.pingUnavailable", { defaultValue: "不可用" });
  if (headline === "empty") return t("nodeCard.pingEmpty", { defaultValue: "无延迟数据" });
  return formatLatency(headline.ms);
}

function directionText(t: TFunction, target: PingTargetReport): string {
  const key = target.role === "home" ? "nodeCard.directionHome" : "nodeCard.directionServer";
  const fallback = target.role === "home" ? "家宽 → {{target}}" : "服务器 → {{target}}";
  return t(key, { target: target.name, defaultValue: fallback });
}

function HistoryStrip({
  points,
  metric,
  isLoaded,
}: {
  points: PingHistoryPoint[];
  metric: "latency" | "loss";
  isLoaded: boolean;
}) {
  const visible = points.length > 0 ? points : PING_HISTORY_PLACEHOLDER_POINTS;
  return (
    <div className="flex h-5 gap-0.5" aria-hidden={points.length === 0}>
      {visible.map((point, index) => {
        const metricValue = point[metric];
        const failed = point.failed && metric === "latency";
        const tone = failed
          ? "bg-rose-500/80"
          : metricValue === null
            ? "bg-muted-foreground/18"
            : metric === "latency"
              ? metricValue <= 80
                ? "bg-emerald-500"
                : metricValue <= 180
                  ? "bg-amber-500"
                  : "bg-rose-500"
              : metricValue <= 1
                ? "bg-emerald-500"
                : metricValue <= 5
                  ? "bg-amber-500"
                  : "bg-rose-500";
        const title = !isLoaded
          ? ""
          : failed
            ? "不可用"
            : metricValue === null
              ? "无样本"
              : metric === "latency"
                ? `${Math.round(metricValue)} ms`
                : `${metricValue.toFixed(1)}%`;
        return <span key={`${point.time}-${index}`} title={title} className={`min-w-[2px] flex-1 rounded-[2px] ${tone}`} />;
      })}
    </div>
  );
}

function TargetBlock({ target, t, isLoaded }: { target: PingTargetReport; t: TFunction; isLoaded: boolean }) {
  const loss = target.lossPercent === null ? "--" : `${target.lossPercent.toFixed(1)}%`;
  return (
    <div className="space-y-1 rounded-md border border-border/45 bg-background/45 px-2 py-1.5">
      <div className="flex items-center justify-between gap-2 text-[10px] leading-none">
        <span className="truncate text-muted-foreground" title={directionText(t, target)}>
          {directionText(t, target)}
        </span>
        <span className="shrink-0 font-mono font-semibold text-foreground/80">{headlineText(t, target)}</span>
      </div>
      <div className="flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
        <span>
          {t("nodeCard.protocol", { defaultValue: "协议" })} {protocolLabel(t, target.protocol)}
        </span>
        <span>
          {loss} {t("chart.lossRate", { defaultValue: "丢包" })}
        </span>
      </div>
      <HistoryStrip points={target.history} metric="latency" isLoaded={isLoaded} />
    </div>
  );
}

export function PingTargetList({
  pingStats,
  t,
  serverNames,
}: {
  pingStats: PingStats;
  t: TFunction;
  serverNames?: Map<string, string>;
}) {
  const ownTargets = pingStats.report.targets.map((target) => {
    if (!target.linkedServerUuid) return target;
    const linkedName = serverNames?.get(target.linkedServerUuid);
    if (!linkedName || target.name !== `任务 ${target.taskId}`) return target;
    return { ...target, name: linkedName };
  });

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="text-muted-foreground">
          {pingStats.isSource
            ? t("nodeCard.homeMeasurements", { defaultValue: "家宽测量" })
            : t("nodeCard.pingStats", { defaultValue: "延迟统计（24h）" })}
        </span>
        {!pingStats.isLoaded && <span className="font-mono text-[11px] text-muted-foreground">--</span>}
      </div>
      {pingStats.isSource && (
        <p className="text-[10px] leading-snug text-muted-foreground">
          {t("nodeCard.homeSourceNote", { defaultValue: "来自家庭路由的分目标样本，多个目标不会合并平均。" })}
        </p>
      )}
      {!pingStats.isSource && (
        <p className="text-[10px] leading-snug text-muted-foreground">
          {t("nodeCard.serverDirectionNote", { defaultValue: "方向是服务器测到目标，不是家庭到服务器。" })}
        </p>
      )}
      {ownTargets.length === 0 && pingStats.isLoaded && (
        <div className="text-xs text-muted-foreground">{t("nodeCard.noPingData", { defaultValue: "无延迟数据" })}</div>
      )}
      {ownTargets.map((target) => (
        <TargetBlock key={`${target.role}-${target.taskId}-${target.linkedServerUuid ?? "self"}`} target={target} t={t} isLoaded={pingStats.isLoaded} />
      ))}
      {!pingStats.isSource && (
        <div className="space-y-1 border-t border-border/40 pt-2">
          <div className="text-[10px] font-medium text-muted-foreground">
            {t("nodeCard.homePerspective", { defaultValue: "家宽视角" })}
          </div>
          {pingStats.homeState === "loading" && <div className="text-[10px] text-muted-foreground">--</div>}
          {pingStats.homeState === "unconfigured" && (
            <div className="text-[10px] text-muted-foreground">
              {t("nodeCard.homePerspectiveUnconfigured", { defaultValue: "未配置" })}
            </div>
          )}
          {pingStats.homeState === "unknown" && (
            <div className="text-[10px] text-muted-foreground">{t("nodeCard.pingUnknown", { defaultValue: "未知" })}</div>
          )}
          {pingStats.homeState === "ready" &&
            pingStats.homePerspective.targets.map((target) => (
              <TargetBlock key={`home-${target.taskId}`} target={target} t={t} isLoaded />
            ))}
        </div>
      )}
    </div>
  );
}
