import type { TFunction } from "i18next";
import type { PingHistoryPoint, PingStats } from "@/hooks/usePingStats";
import {
  deriveLatencyScale,
  explicitLatencyScale,
  gradeLatency,
  gradeLoss,
  latencyTextClass,
  latencyToneClass,
  LOSS_ELEVATED_MAX,
  LOSS_NORMAL_MAX,
  matchLatencyBand,
  parseLatencyQuality,
  type LatencyScale,
  type LatencyTone,
} from "@/lib/latencyQuality";
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

function toneLabel(t: TFunction, tone: LatencyTone): string {
  if (tone === "normal") return t("nodeCard.latencyNormal", { defaultValue: "正常" });
  if (tone === "elevated") return t("nodeCard.latencyElevated", { defaultValue: "偏高" });
  if (tone === "abnormal") return t("nodeCard.latencyAbnormal", { defaultValue: "明显异常" });
  if (tone === "unavailable") return t("nodeCard.pingUnavailable", { defaultValue: "不可用" });
  if (tone === "unrated") return t("nodeCard.latencyUnrated", { defaultValue: "样本不足，不判断异常" });
  return t("nodeCard.latencyNoSample", { defaultValue: "无样本" });
}

function bandText(t: TFunction, scale: LatencyScale): string {
  if (scale.source === "insufficient" || scale.greenMaxMs == null || scale.yellowMaxMs == null) {
    return t("nodeCard.latencyInsufficient", {
      count: scale.successSamples,
      min: scale.minSamples,
      defaultValue: "成功样本 {{count}}/{{min}}，样本不足，不把当前延迟判成异常",
    });
  }
  const green = Math.round(scale.greenMaxMs);
  const yellow = Math.round(scale.yellowMaxMs);
  if (scale.source === "explicit") {
    return t("nodeCard.latencyExplicitBand", {
      green,
      yellow,
      defaultValue: "已配置门槛：绿 ≤{{green}} ms，黄 ≤{{yellow}} ms",
    });
  }
  return t("nodeCard.latencyBaselineBand", {
    green,
    yellow,
    baseline: Math.round(scale.baselineMs ?? 0),
    count: scale.successSamples,
    defaultValue: "本线路基线 {{baseline}} ms（{{count}} 个成功样本）：绿 ≤{{green}} ms，黄 ≤{{yellow}} ms",
  });
}

function latencyTitle(t: TFunction, value: number | null, failed: boolean, scale: LatencyScale): string {
  const tone = gradeLatency(value, failed, scale);
  if (tone === "unavailable") return toneLabel(t, tone);
  if (tone === "none") return toneLabel(t, tone);
  return `${Math.round(value ?? 0)} ms · ${toneLabel(t, tone)} · ${bandText(t, scale)}`;
}

function HistoryStrip({
  points,
  scale,
  isLoaded,
  t,
}: {
  points: PingHistoryPoint[];
  scale: LatencyScale;
  isLoaded: boolean;
  t: TFunction;
}) {
  const visible = points.length > 0 ? points : PING_HISTORY_PLACEHOLDER_POINTS;
  return (
    <div className="flex h-5 gap-0.5" title={bandText(t, scale)} aria-hidden={points.length === 0}>
      {visible.map((point, index) => {
        const tone = points.length === 0 ? "none" : gradeLatency(point.latency, point.failed, scale);
        const title = !isLoaded || points.length === 0 ? "" : latencyTitle(t, point.latency, point.failed, scale);
        return <span key={`${point.time}-${index}`} title={title} className={`min-w-[2px] flex-1 rounded-[2px] ${latencyToneClass(tone)}`} />;
      })}
    </div>
  );
}

function TargetBlock({
  target,
  scale,
  t,
  isLoaded,
}: {
  target: PingTargetReport;
  scale: LatencyScale;
  t: TFunction;
  isLoaded: boolean;
}) {
  const lossTone = gradeLoss(target.lossPercent);
  const loss = target.lossPercent === null ? "--" : `${target.lossPercent.toFixed(1)}%`;
  const headlineTone = target.latestStatus === "failure"
    ? "unavailable"
    : gradeLatency(target.latestLatencyMs, false, scale);
  const lossTitle = t("nodeCard.lossBand", {
    normal: LOSS_NORMAL_MAX,
    elevated: LOSS_ELEVATED_MAX,
    defaultValue: "丢包单独着色：≤{{normal}}% 正常，≤{{elevated}}% 偏高，更高为明显异常",
  });
  return (
    <div className="space-y-1 rounded-md border border-border/45 bg-background/45 px-2 py-1.5" title={bandText(t, scale)}>
      <div className="flex items-center justify-between gap-2 text-[10px] leading-none">
        <span className="truncate text-muted-foreground" title={directionText(t, target)}>
          {directionText(t, target)}
        </span>
        <span className={`shrink-0 font-mono font-semibold ${latencyTextClass(headlineTone)}`}>{headlineText(t, target)}</span>
      </div>
      <div className="flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
        <span>
          {t("nodeCard.protocol", { defaultValue: "协议" })} {protocolLabel(t, target.protocol)}
        </span>
        <span className={latencyTextClass(lossTone)} title={lossTitle}>
          {loss} {t("chart.lossRate", { defaultValue: "丢包" })}
        </span>
      </div>
      <HistoryStrip points={target.history} scale={scale} isLoaded={isLoaded} t={t} />
    </div>
  );
}

function scaleFor(
  target: PingTargetReport,
  qualityText: string,
  sourceUuid: string | null,
): LatencyScale {
  const quality = parseLatencyQuality(qualityText);
  const successes = target.samples
    .filter((sample) => !sample.failed && sample.latency != null)
    .map((sample) => sample.latency as number);
  const band = matchLatencyBand(quality.routes, target, sourceUuid);
  if (band) return explicitLatencyScale(band, successes.length, quality.options.minSamples);
  return deriveLatencyScale(successes, quality.options);
}

export function PingTargetList({
  pingStats,
  t,
  serverNames,
  latencyQuality = "",
  serverUuid = null,
  homeSourceUuid = null,
}: {
  pingStats: PingStats;
  t: TFunction;
  serverNames?: Map<string, string>;
  latencyQuality?: string;
  serverUuid?: string | null;
  homeSourceUuid?: string | null;
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
        <TargetBlock
          key={`${target.role}-${target.taskId}-${target.linkedServerUuid ?? "self"}`}
          target={target}
          scale={scaleFor(target, latencyQuality, target.role === "home" ? homeSourceUuid : serverUuid)}
          t={t}
          isLoaded={pingStats.isLoaded}
        />
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
              <TargetBlock
                key={`home-${target.taskId}`}
                target={target}
                scale={scaleFor(target, latencyQuality, homeSourceUuid)}
                t={t}
                isLoaded
              />
            ))}
        </div>
      )}
    </div>
  );
}
