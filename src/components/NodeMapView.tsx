"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, PointerEvent } from "react";
import { geoGraticule10, geoNaturalEarth1, geoPath } from "d3-geo";
import { MapPinned } from "lucide-react";
import { feature } from "topojson-client";
import { useTranslation } from "react-i18next";

import type { NodeBasicInfo } from "@/contexts/NodeListContext";
import type { LiveData } from "@/types/LiveData";
import worldCountries50m from "@/data/world-countries-50m.json";
import { buildCityMapView, type CityMapGroup, type CityPinReason } from "@/lib/nodeCityMap";
import { useTheme } from "@/contexts/ThemeContext";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import Flag from "@/components/Flag";
import SpaLink from "@/components/SpaLink";

import "./NodeMapView.css";

interface NodeMapViewProps {
  nodes: NodeBasicInfo[];
  liveData: LiveData;
  mapOnly?: boolean;
  cityMapConfig?: string;
  initialSelectedKey?: string | null;
}

type TranslateFn = (key: string, options?: Record<string, unknown>) => string;
type HoveredCity = {
  cityKey: string;
  x: number;
  y: number;
  horizontal: "left" | "right";
  vertical: "above" | "below";
};

const SVG_WIDTH = 1000;
const SVG_HEIGHT = 560;
const MAP_HORIZONTAL_PADDING = 28;
const MAP_TOP_PADDING = 42;
const MAP_BOTTOM_INSET = 42;
const HOVER_CARD_GAP = 12;
const HOVER_CARD_MAX_WIDTH = 320;
const HOVER_CARD_FALLBACK_HEIGHT = 180;
const HOVER_CARD_EDGE_PADDING = 8;

function statusText(t: TranslateFn, status: CityMapGroup["status"]) {
  if (status === "online") return t("mapView.status.online", { defaultValue: "在线" });
  if (status === "offline") return t("mapView.status.offline", { defaultValue: "离线" });
  return t("mapView.status.partial", { defaultValue: "部分在线" });
}

function reasonText(t: TranslateFn, reason: CityPinReason) {
  return t(`mapView.reason.${reason}`, {
    defaultValue:
      reason === "conflict"
        ? "坐标冲突"
        : reason === "do_not_pin"
          ? "不定位"
          : reason === "invalid"
            ? "映射无效"
            : reason === "unknown"
              ? "坐标未知"
              : "未配置坐标",
  });
}

function statusBadgeClass(status: CityMapGroup["status"]) {
  if (status === "online") return "bg-emerald-500/12 text-emerald-700 dark:bg-emerald-500/18 dark:text-emerald-300";
  if (status === "offline") return "bg-rose-500/12 text-rose-700 dark:bg-rose-500/18 dark:text-rose-300";
  return "bg-amber-500/14 text-amber-700 dark:bg-amber-500/18 dark:text-amber-300";
}

export function NodeMapView({ nodes, liveData, mapOnly = false, cityMapConfig, initialSelectedKey = null }: NodeMapViewProps) {
  const { t } = useTranslation();
  const { nodeCityMap } = useTheme();
  const summary = useMemo(
    () => buildCityMapView(
      nodes.map((node) => ({ uuid: node.uuid, name: node.name })),
      liveData?.online ?? [],
      cityMapConfig ?? nodeCityMap,
    ),
    [nodes, liveData, cityMapConfig, nodeCityMap],
  );
  const [hoveredCity, setHoveredCity] = useState<HoveredCity | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(initialSelectedKey);
  const mapSurfaceRef = useRef<HTMLDivElement | null>(null);
  const hoverCardRef = useRef<HTMLDivElement | null>(null);
  const hoverFrameRef = useRef<number | null>(null);
  const pendingHoverPositionRef = useRef<Omit<HoveredCity, "cityKey"> | null>(null);
  const hoverGroup = summary.groups.find((group) => group.key === hoveredCity?.cityKey) ?? null;
  const selectedGroup = summary.groups.find((group) => group.key === selectedKey) ?? hoverGroup;
  const hoverPosition = hoveredCity ? pendingHoverPositionRef.current ?? hoveredCity : null;

  const projectedMap = useMemo(() => {
    const countriesGeo = feature(
      worldCountries50m as never,
      (worldCountries50m as unknown as { objects: { countries: never } }).objects.countries,
    ) as unknown as { features: Array<{ id?: string; properties?: { name?: string } }> };
    const projection = geoNaturalEarth1().fitExtent(
      [
        [MAP_HORIZONTAL_PADDING, MAP_TOP_PADDING],
        [SVG_WIDTH - MAP_HORIZONTAL_PADDING, SVG_HEIGHT - MAP_BOTTOM_INSET],
      ],
      countriesGeo as never,
    );
    const pathGenerator = geoPath(projection);
    const countries = countriesGeo.features
      .map((country) => ({
        name: country.properties?.name ?? String(country.id ?? "unknown"),
        pathData: pathGenerator(country as never) ?? "",
      }))
      .filter((country) => country.pathData);
    const cities = summary.groups.flatMap((group) => {
      const projected = projection([group.longitude, group.latitude]);
      if (!projected || !Number.isFinite(projected[0]) || !Number.isFinite(projected[1])) return [];
      return [{ group, x: projected[0], y: projected[1] }];
    });
    return {
      spherePath: pathGenerator({ type: "Sphere" }) ?? "",
      graticulePath: pathGenerator(geoGraticule10()) ?? "",
      countries,
      cities,
    };
  }, [summary.groups]);

  const getHoverPosition = useCallback((event: PointerEvent<SVGElement>) => {
    const surfaceRect = mapSurfaceRef.current?.getBoundingClientRect();
    const boundsWidth = surfaceRect?.width ?? window.innerWidth;
    const boundsHeight = surfaceRect?.height ?? window.innerHeight;
    const x = surfaceRect ? event.clientX - surfaceRect.left : event.clientX;
    const y = surfaceRect ? event.clientY - surfaceRect.top : event.clientY;
    const hoverCard = hoverCardRef.current;
    const cardWidth = hoverCard?.offsetWidth ?? Math.min(HOVER_CARD_MAX_WIDTH, Math.max(0, boundsWidth - HOVER_CARD_EDGE_PADDING * 2));
    const cardHeight = hoverCard?.offsetHeight ?? HOVER_CARD_FALLBACK_HEIGHT;
    const spaceRight = boundsWidth - x - HOVER_CARD_GAP;
    const spaceLeft = x - HOVER_CARD_GAP;
    const spaceBelow = boundsHeight - y - HOVER_CARD_GAP;
    const spaceAbove = y - HOVER_CARD_GAP;
    return {
      x,
      y,
      horizontal: spaceRight >= cardWidth || spaceRight >= spaceLeft ? "right" : "left",
      vertical: spaceBelow >= cardHeight || spaceBelow >= spaceAbove ? "below" : "above",
    } satisfies Omit<HoveredCity, "cityKey">;
  }, []);

  const applyHoverPosition = useCallback((position: Omit<HoveredCity, "cityKey">) => {
    const hoverCard = hoverCardRef.current;
    if (!hoverCard) return;
    hoverCard.style.setProperty("--node-map-hover-x", `${position.x}px`);
    hoverCard.style.setProperty("--node-map-hover-y", `${position.y}px`);
    hoverCard.dataset.horizontal = position.horizontal;
    hoverCard.dataset.vertical = position.vertical;
  }, []);

  const queueHoverPosition = useCallback((position: Omit<HoveredCity, "cityKey">) => {
    pendingHoverPositionRef.current = position;
    if (hoverFrameRef.current !== null) return;
    hoverFrameRef.current = window.requestAnimationFrame(() => {
      hoverFrameRef.current = null;
      const nextPosition = pendingHoverPositionRef.current;
      if (nextPosition) applyHoverPosition(nextPosition);
    });
  }, [applyHoverPosition]);

  const updateHoveredCity = useCallback((event: PointerEvent<SVGElement>, group: CityMapGroup) => {
    const position = getHoverPosition(event);
    setHoveredCity({ cityKey: group.key, ...position });
    queueHoverPosition(position);
  }, [getHoverPosition, queueHoverPosition]);

  const clearHoveredCity = useCallback(() => {
    setHoveredCity(null);
    pendingHoverPositionRef.current = null;
    if (hoverFrameRef.current !== null) {
      window.cancelAnimationFrame(hoverFrameRef.current);
      hoverFrameRef.current = null;
    }
  }, []);

  useEffect(() => () => {
    if (hoverFrameRef.current !== null) window.cancelAnimationFrame(hoverFrameRef.current);
  }, []);

  if (!summary.totalNodes) {
    return (
      <Card className="overflow-hidden rounded-[28px] border-border/70 bg-card/95 shadow-sm">
        <CardContent>
          <div className="rounded-3xl border border-dashed border-border/70 bg-muted/40 px-6 py-12 text-center text-sm text-muted-foreground">
            {t("nodes.empty", { defaultValue: "没有节点数据" })}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={mapOnly ? "node-map-view overflow-visible rounded-none border-0 bg-transparent shadow-none" : "node-map-view overflow-hidden rounded-[28px] border-border/70 bg-card/95 shadow-sm"}>
      {!mapOnly && (
        <CardHeader className="space-y-4 border-b border-border/70 pb-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="space-y-2">
              <div className="inline-flex items-center gap-2 rounded-full bg-sky-500/10 px-3 py-1 text-xs font-medium text-sky-700 dark:bg-sky-500/14 dark:text-sky-300">
                <MapPinned className="h-3.5 w-3.5" />
                {t("common.map", { defaultValue: "地图" })}
              </div>
              <CardTitle className="text-2xl tracking-tight">{t("mapView.cityTitle", { defaultValue: "城市分布" })}</CardTitle>
              <p className="text-sm text-muted-foreground">
                {t("mapView.cityCount", { count: summary.groups.length, defaultValue: "{{count}} 个城市" })}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge variant="secondary" className="rounded-full bg-muted px-3 py-1 text-muted-foreground">
                {t("mapView.servers", { count: summary.totalNodes, defaultValue: "{{count}} 台节点" })}
              </Badge>
              <Badge variant="secondary" className="rounded-full bg-emerald-500/12 px-3 py-1 text-emerald-700 dark:bg-emerald-500/18 dark:text-emerald-300">
                {t("mapView.online", { count: summary.onlineNodes, defaultValue: "{{count}} 台在线" })}
              </Badge>
            </div>
          </div>
        </CardHeader>
      )}
      <CardContent className={mapOnly ? "p-0" : "p-5 lg:p-6"}>
        <div className={mapOnly ? "node-map-view__layout node-map-view__layout--map-only" : "node-map-view__layout"}>
          <div ref={mapSurfaceRef} className="node-map-view__surface">
            <svg viewBox={`0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`} className="node-map-view__svg" role="img" aria-label={t("mapView.ariaLabel", { defaultValue: "城市级节点分布地图" })}>
              <path d={projectedMap.spherePath} className="node-map-view__ocean" />
              <path d={projectedMap.graticulePath} className="node-map-view__graticule" />
              <g className="node-map-view__country-layer">
                {projectedMap.countries.map((country) => (
                  <path key={country.name} d={country.pathData} className="node-map-view__country" />
                ))}
              </g>
              <g className="node-map-view__marker-layer">
                {projectedMap.cities.map(({ group, x, y }) => {
                  const isSelected = hoveredCity?.cityKey === group.key || selectedKey === group.key;
                  return (
                    <g
                      key={group.key}
                      className={`node-map-view__marker status-${group.status}${isSelected ? " is-selected" : ""}`}
                      role="button"
                      tabIndex={0}
                      aria-label={`${group.label} ${group.total}`}
                      onPointerEnter={(event) => updateHoveredCity(event, group)}
                      onPointerMove={(event) => queueHoverPosition(getHoverPosition(event))}
                      onPointerLeave={clearHoveredCity}
                      onClick={() => setSelectedKey((current) => current === group.key ? null : group.key)}
                    >
                      <circle cx={x} cy={y} r="9" className="node-map-view__marker-halo" />
                      <circle cx={x} cy={y} r="4.2" className="node-map-view__marker-dot" />
                      {group.total > 1 && (
                        <text x={x + 8} y={y - 8} className="fill-current text-[11px] font-semibold">
                          {group.total}
                        </text>
                      )}
                    </g>
                  );
                })}
              </g>
            </svg>
            <div className="node-map-view__legend node-map-view__legend--inset">
              <div className="node-map-view__legend-card node-map-view__legend-card--status">
                <div className="text-[11px] leading-snug text-muted-foreground">
                  {!summary.configured || summary.parseError
                    ? t("mapView.configMissing", { defaultValue: "未配置城市映射，不会用国家中心点代替。" })
                    : t("mapView.cityPrecision", { defaultValue: "城市级近似，同城节点聚合在同一点。" })}
                </div>
              </div>
              {summary.unmapped.length > 0 && (
                <div className="node-map-view__legend-card node-map-view__legend-card--stacked">
                  <div className="node-map-view__legend-unmapped-header">
                    <span className="text-xs font-semibold text-foreground">{t("mapView.unmappedNodes", { defaultValue: "未定位节点" })}</span>
                    <Badge variant="secondary" className="rounded-full bg-amber-500/12 px-2.5 py-0.5 text-[11px] font-medium text-amber-700 dark:bg-amber-500/18 dark:text-amber-300">
                      {summary.unmapped.length}
                    </Badge>
                  </div>
                  <div className="node-map-view__legend-unmapped-list">
                    {summary.unmapped.map((node) => (
                      <div key={node.uuid} className="node-map-view__legend-unmapped-item">
                        <span className="node-map-view__legend-unmapped-node">{node.name}</span>
                        <span className="node-map-view__legend-unmapped-region">{reasonText(t, node.reason)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
            {hoverGroup && hoverPosition && (
              <div
                ref={hoverCardRef}
                className="node-map-view__hover-card"
                data-horizontal={hoverPosition.horizontal}
                data-vertical={hoverPosition.vertical}
                style={{ "--node-map-hover-x": `${hoverPosition.x}px`, "--node-map-hover-y": `${hoverPosition.y}px` } as CSSProperties}
              >
                <div className="node-map-view__detail-header node-map-view__hover-header">
                  <div className="node-map-view__detail-heading">
                    {hoverGroup.countryCode && (
                      <span className="node-map-view__detail-flag" aria-hidden="true">
                        <Flag flag={hoverGroup.countryCode} />
                      </span>
                    )}
                    <div className="min-w-0 space-y-1">
                      <h3 className="truncate text-lg font-semibold tracking-tight text-foreground">{hoverGroup.label}</h3>
                      <div className="text-xs text-muted-foreground">
                        {hoverGroup.total} {t("mapView.stats.nodes", { defaultValue: "节点" })} · {statusText(t, hoverGroup.status)}
                      </div>
                    </div>
                  </div>
                  <Badge variant="secondary" className={`shrink-0 rounded-full ${statusBadgeClass(hoverGroup.status)}`}>
                    {t("mapView.nodeList", { defaultValue: "同城节点" })}
                  </Badge>
                </div>
                <div className="node-map-view__node-list">
                  {hoverGroup.nodes.map((node) => (
                    <div key={node.uuid} className="flex items-center justify-between gap-2 text-sm">
                      <span className="truncate">{node.name}</span>
                      <span className={node.online ? "text-emerald-600 dark:text-emerald-300" : "text-rose-600 dark:text-rose-300"}>
                        {node.online ? t("nodeCard.online", { defaultValue: "在线" }) : t("nodeCard.offline", { defaultValue: "离线" })}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
          {selectedGroup && (
            <div className="rounded-2xl border border-border/70 bg-card/80 p-4">
              <div className="mb-2 text-sm font-semibold">{selectedGroup.label}</div>
              <div className="space-y-1">
                {selectedGroup.nodes.map((node) => (
                  <SpaLink key={node.uuid} href={`/instance/${node.uuid}`} className="flex items-center justify-between gap-3 rounded-md px-2 py-1 text-sm hover:bg-muted/60">
                    <span className="truncate">{node.name}</span>
                    <span className={node.online ? "text-emerald-600 dark:text-emerald-300" : "text-rose-600 dark:text-rose-300"}>
                      {node.online ? t("nodeCard.online", { defaultValue: "在线" }) : t("nodeCard.offline", { defaultValue: "离线" })}
                    </span>
                  </SpaLink>
                ))}
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
