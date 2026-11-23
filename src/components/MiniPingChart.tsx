import { useEffect, useMemo, useState, useCallback } from "react";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import Loading from "@/components/loading";
import {
  ChartContainer,
  ChartTooltip,
  ChartLegend,
  ChartLegendContent,
} from "@/components/ui/chart";
import { LineChart, Line, XAxis, YAxis, CartesianGrid } from "recharts";
import { useTranslation } from "react-i18next";
import { cutPeakValues } from "@/utils/RecordHelper";
import Tips from "./ui/tips";
import { useRPC2Call } from "@/contexts/RPC2Context";
import { fetchPingRecords, PING_RECORDS_AUTO_REFRESH_MS, type PingRecord, type PingTaskInfo } from "@/lib/pingRecords";
// 移除旧 REST 类型，改用 RPC2 返回结构

//const MAX_POINTS = 1000;
const colors = [
  "#F38181",
  "#347433",
  "#898AC4",
  "#03A6A1",
  "#7AD6F0",
  "#B388FF",
  "#FF8A65",
  "#FFD600",
];

interface MiniPingChartProps {
  uuid: string;
  width?: string | number;
  height?: string | number;
  hours?: number; // Add hours as an optional prop
}

const MiniPingChart = ({
  uuid,
  width = "100%",
  height = 300,
  hours = 12,
}: MiniPingChartProps) => {
  const [remoteData, setRemoteData] = useState<PingRecord[] | null>(null);
  const [tasks, setTasks] = useState<PingTaskInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [t] = useTranslation();
  const [cutPeak, setCutPeak] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState<number | null>(null);
  const { call } = useRPC2Call();
  useEffect(() => {
    if (!uuid.trim()) {
      setRemoteData(null);
      setTasks([]);
      setError(null);
      setLoading(false);
      return;
    }

    let active = true;
    let hasReceivedResponse = false;
    setLoading(true);
    setError(null);
    const fetchChartData = async (forceRefresh = false) => {
      try {
        const result = await fetchPingRecords(call, uuid, hours, { forceRefresh });
        if (!active) return;
        hasReceivedResponse = true;
        setRemoteData(result.records);
        setTasks(result?.tasks || []);
        setError(null);
        setLoading(false);
      } catch (err: any) {
        if (!active) return;
        if (!hasReceivedResponse) {
          setError(err?.message || "Error");
        }
        setLoading(false);
      }
    };

    void fetchChartData();
    const refreshTimer = window.setInterval(() => {
      void fetchChartData(true);
    }, PING_RECORDS_AUTO_REFRESH_MS);

    return () => {
      active = false;
      window.clearInterval(refreshTimer);
    };
  }, [uuid, hours, call]);

  const chartData = useMemo(() => {
    // 思路：仅保留真实采样时间点（各任务原始时间点的并集），
    // 不再用最小间隔对整段时间做补点，否则长间隔任务会被大量 null 分割成若干段。
    const data = remoteData || [];
    if (!data.length) return [];

    // 动态匹配容差：取各任务最小 interval * 0.4（秒）转换为 ms，范围 [800ms, 1500ms]
    const validIntervals = tasks
      .map((t) => t.interval)
      .filter((v): v is number => typeof v === "number" && v > 0);
    const minTaskInterval = validIntervals.length
      ? Math.min(...validIntervals)
      : 60;
    const toleranceMs = Math.min(
      1500,
      Math.max(800, (minTaskInterval * 1000 * 0.4) | 0)
    );

    const grouped: Record<string, any> = {}; // key: anchor timestamp(ms)
    const anchors: number[] = [];

    const activeTaskId = selectedTaskId ?? tasks[0]?.id ?? null;
    for (const rec of data) {
      if (activeTaskId != null && rec.task_id !== activeTaskId) continue;
      const ts = new Date(rec.time).getTime();
      let anchor: number | null = null;
      // 线性扫描量通常较小（点数有限），后续如需优化可改为二分。
      for (const a of anchors) {
        if (Math.abs(a - ts) <= toleranceMs) {
          anchor = a;
          break;
        }
      }
      const use = anchor ?? ts;
      if (!grouped[use]) {
        grouped[use] = { time: new Date(use).toISOString() };
        if (anchor === null) anchors.push(use);
      }
      grouped[use].latency = rec.value < 0 ? null : rec.value;
    }

    let rows = Object.values(grouped).sort(
      (a: any, b: any) => new Date(a.time).getTime() - new Date(b.time).getTime()
    );

    if (cutPeak && rows.length > 0) {
      rows = cutPeakValues(rows, ["latency"]);
    }

    return rows;
  }, [remoteData, cutPeak, tasks, selectedTaskId]);

  const timeFormatter = (value: any, index: number) => {
    if (!chartData.length) return "";
    if (index === 0 || index === chartData.length - 1) {
      return new Date(value).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      });
    }
    return "";
  };

  const chartConfig = useMemo(() => {
    const config: Record<string, any> = {};
    tasks.forEach((task, idx) => {
      config[task.id] = {
        label: task.name,
        color: colors[idx % colors.length],
      };
    });
    return config;
  }, [tasks]);

  const CustomTooltip = useCallback(({ active, payload, label }: any) => {
    if (!active || !payload || !payload.length) return null;

    const date = new Date(label);
    const formattedDate = date.toLocaleString([], {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });

    return (
      <div className="pointer-events-auto max-h-[min(60dvh,22rem)] min-w-[12rem] max-w-[min(22rem,calc(100vw-2rem))] overflow-y-auto overscroll-contain rounded-lg border bg-background p-2 shadow-sm touch-pan-y">
        <div className="text-xs text-muted-foreground mb-2">{formattedDate}</div>
        <div className="grid gap-1">
          {payload.map((entry: any, index: number) => {
            const task = tasks.find((item) => item.id === (selectedTaskId ?? tasks[0]?.id));
            if (!task) return null;
            if (entry.value === null || entry.dataKey !== "latency") {
              return (
                <div key={index} className="text-xs text-muted-foreground">
                  {task.name} · {t("nodeCard.pingUnavailable", { defaultValue: "不可用" })}
                </div>
              );
            }

            const lossText = typeof task.loss === 'number' ? `${task.loss.toFixed(1)}%` : 'N/A';
            const volText = typeof task.p99_p50_ratio === 'number' ? task.p99_p50_ratio.toFixed(1) : 'N/A';

            return (
              <div key={index} className="flex flex-col gap-0.5">
                <div className="flex min-w-0 items-center gap-2">
                  <div
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: entry.color }}
                  />
                  <span className="min-w-0 truncate text-sm font-medium" title={task.name}>{task.name}</span>
                </div>
                <div className="ml-4 text-xs">
                  <div>{Math.round(entry.value)} ms</div>
                  <div className="text-muted-foreground">
                    {lossText} {t('chart.lossRate')} / {volText} {t('chart.volatility')}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }, [tasks, t, selectedTaskId]);

  return (
    <Card
      style={{ width, maxWidth: "100%", height: 'auto', minHeight: height }}
      className="flex w-full min-w-0 max-w-full flex-col gap-2 overflow-visible p-3"
    >
      {loading && (
        <div
          className="w-full flex-grow flex items-center justify-center"
          style={{ minHeight: typeof height === 'number' ? `${height - 100}px` : '200px' }}
        >
          <Loading />
        </div>
      )}
      {error && (
        <div
          className="w-full flex-grow flex items-center justify-center text-destructive"
          style={{ minHeight: typeof height === 'number' ? `${height - 100}px` : '200px' }}
        >
          {error}
        </div>
      )}
      {!loading && !error && chartData.length === 0 ? (
        <div className="w-full flex items-center justify-center text-muted-foreground" style={{ minHeight: typeof height === 'number' ? `${height - 100}px` : '200px' }}>
          {t("nodeCard.noPingData")}
        </div>
      ) : (
        !loading &&
        !error && (
          <ChartContainer
            config={chartConfig}
            className="w-full min-w-0 max-w-full overflow-visible"
            style={{ height: typeof height === 'number' ? `${height - 80}px` : '220px' }}
          >
            <LineChart
              data={chartData}
              accessibilityLayer
              margin={{ top: 10, right: 20, bottom: 10, left: 10 }}
            >
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey="time"
                tickLine={false}
                axisLine={false}
                tickFormatter={timeFormatter}
                interval="preserveStartEnd" // Preserve start and end ticks
                minTickGap={30} // Minimum gap between ticks to prevent overlap
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                unit="ms"
                allowDecimals={false}
                orientation="left"
                type="number"
                tick={{ dx: -10 }}
                mirror={true}
              />
              <ChartTooltip
                cursor={false}
                content={<CustomTooltip />}
                allowEscapeViewBox={{ x: true, y: true }}
                wrapperStyle={{ pointerEvents: "auto", zIndex: 20 }}
              />
              <ChartLegend
                content={
                  <ChartLegendContent className="flex-wrap justify-start gap-x-3 gap-y-2 text-xs" />
                }
              />
              <Line
                dataKey="latency"
                name={(tasks.find((task) => task.id === (selectedTaskId ?? tasks[0]?.id))?.name) || t("nodeCard.ping", { defaultValue: "延迟" })}
                stroke={colors[0]}
                dot={false}
                isAnimationActive={false}
                strokeWidth={2}
                connectNulls={false}
                type={cutPeak ? "basisOpen" : "linear"}
              />
            </LineChart>
          </ChartContainer>
        )
      )}
      {tasks.length > 1 && (
        <div className="flex flex-wrap gap-1">
          {tasks.map((task) => (
            <button
              key={task.id}
              type="button"
              className={`rounded-full border px-2 py-0.5 text-[11px] ${(selectedTaskId ?? tasks[0]?.id) === task.id ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
              onClick={() => setSelectedTaskId(task.id)}
            >
              {task.name}
            </button>
          ))}
        </div>
      )}
      <div className="flex items-center gap-2 pt-1" style={{ display: loading ? "none" : "flex" }}>
        <Switch id="cut-peak" checked={cutPeak} onCheckedChange={setCutPeak} />
        <label htmlFor="cut-peak" className="text-sm font-medium flex items-center gap-1 flex-row cursor-pointer">
          {t("chart.cutPeak")}
          <Tips mode="popup" side="top"><span dangerouslySetInnerHTML={{ __html: t("chart.cutPeak_tips") }} /></Tips>
        </label>

      </div>
    </Card>
  );
};

export default MiniPingChart;
