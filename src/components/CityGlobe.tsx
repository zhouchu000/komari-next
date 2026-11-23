"use client";

import { useEffect, useRef } from "react";
import { geoGraticule10, geoOrthographic, geoPath, type GeoPermissibleObjects } from "d3-geo";
import { feature } from "topojson-client";

import worldCountries50m from "@/data/world-countries-50m.json";

export type GlobeCityStatus = "online" | "offline" | "partial";

export interface GlobeCity {
  key: string;
  label: string;
  longitude: number;
  latitude: number;
  total: number;
  status: GlobeCityStatus;
}

interface CityGlobeProps {
  cities: GlobeCity[];
  selectedKey: string | null;
  onSelect: (key: string | null) => void;
  onHover: (cityKey: string | null, point: { x: number; y: number } | null) => void;
}

interface ViewState {
  lng: number;
  lat: number;
  dragging: boolean;
  moved: boolean;
  auto: boolean;
  reduced: boolean;
  visible: boolean;
  hoverKey: string | null;
  focus: { lng: number; lat: number; fromLng: number; fromLat: number; started: number } | null;
}

const countryCollection = feature(
  worldCountries50m as never,
  (worldCountries50m as unknown as { objects: { countries: never } }).objects.countries,
) as unknown as GeoPermissibleObjects;
const graticule = geoGraticule10();

const STATUS_COLOR: Record<GlobeCityStatus, string> = {
  online: "#7ddec8",
  partial: "#e7c27a",
  offline: "#e7a3ad",
};

function wrapLng(value: number) {
  return ((value + 540) % 360) - 180;
}

function clampLat(value: number) {
  return Math.max(-55, Math.min(55, value));
}

function lerpAngle(from: number, to: number, t: number) {
  const delta = wrapLng(to - from);
  return from + delta * t;
}

function prefersStillMotion() {
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const saveData = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData === true;
  const lowCpu = (navigator.hardwareConcurrency || 4) <= 2;
  return reduced || saveData || lowCpu;
}

export function CityGlobe({ cities, selectedKey, onSelect, onHover }: CityGlobeProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const citiesRef = useRef(cities);
  const selectedRef = useRef(selectedKey);
  const onSelectRef = useRef(onSelect);
  const onHoverRef = useRef(onHover);
  const stateRef = useRef<ViewState>({
    lng: 175,
    lat: 8,
    dragging: false,
    moved: false,
    auto: true,
    reduced: false,
    visible: true,
    hoverKey: null,
    focus: null,
  });
  const paintRef = useRef<(() => void) | null>(null);
  const wakeRef = useRef<(() => void) | null>(null);

  citiesRef.current = cities;
  selectedRef.current = selectedKey;
  onSelectRef.current = onSelect;
  onHoverRef.current = onHover;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;

    const state = stateRef.current;
    state.reduced = prefersStillMotion();
    state.auto = !state.reduced && selectedRef.current == null;

    let frame = 0;
    let last = performance.now();
    let lastPaint = 0;
    let looping = false;
    let pixelWidth = 0;
    let pixelHeight = 0;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const width = Math.max(1, rect.width);
      const height = Math.max(1, rect.height);
      const dpr = Math.min(window.devicePixelRatio || 1, width < 720 ? 1.25 : 1.75);
      const nextWidth = Math.round(width * dpr);
      const nextHeight = Math.round(height * dpr);
      if (nextWidth !== pixelWidth || nextHeight !== pixelHeight) {
        pixelWidth = nextWidth;
        pixelHeight = nextHeight;
        canvas.width = nextWidth;
        canvas.height = nextHeight;
      }
      return { width, height, dpr };
    };

    const paint = () => {
      const { width, height, dpr } = resize();
      const radius = Math.min(width, height) * 0.4;
      const cx = width / 2;
      const cy = height * 0.48;
      const projection = geoOrthographic()
        .translate([cx, cy])
        .scale(radius)
        .rotate([-state.lng, -state.lat])
        .clipAngle(90)
        .precision(width < 720 ? 1.15 : 0.55);
      const path = geoPath(projection, context);

      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.clearRect(0, 0, width, height);

      const atmosphere = context.createRadialGradient(cx, cy, radius * 0.82, cx, cy, radius * 1.16);
      atmosphere.addColorStop(0, "rgba(120, 166, 214, 0)");
      atmosphere.addColorStop(0.74, "rgba(120, 166, 214, 0.02)");
      atmosphere.addColorStop(0.88, "rgba(154, 196, 232, 0.22)");
      atmosphere.addColorStop(1, "rgba(154, 196, 232, 0)");
      context.fillStyle = atmosphere;
      context.beginPath();
      context.arc(cx, cy, radius * 1.16, 0, Math.PI * 2);
      context.fill();

      context.save();
      context.beginPath();
      context.arc(cx, cy, radius, 0, Math.PI * 2);
      context.clip();

      const ocean = context.createRadialGradient(cx - radius * 0.28, cy - radius * 0.34, radius * 0.08, cx, cy, radius);
      ocean.addColorStop(0, "#24567a");
      ocean.addColorStop(0.46, "#14344d");
      ocean.addColorStop(1, "#071018");
      context.fillStyle = ocean;
      context.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);

      context.beginPath();
      path(countryCollection);
      context.fillStyle = "#31465c";
      context.fill();
      context.lineWidth = 0.7;
      context.strokeStyle = "rgba(214, 228, 240, 0.2)";
      context.stroke();

      context.beginPath();
      path(graticule);
      context.lineWidth = 0.45;
      context.strokeStyle = "rgba(214, 228, 240, 0.09)";
      context.stroke();

      const shade = context.createLinearGradient(cx - radius, cy - radius * 0.2, cx + radius, cy + radius * 0.15);
      shade.addColorStop(0, "rgba(255, 255, 255, 0.07)");
      shade.addColorStop(0.42, "rgba(255, 255, 255, 0)");
      shade.addColorStop(1, "rgba(2, 8, 16, 0.34)");
      context.fillStyle = shade;
      context.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);

      const highlight = context.createRadialGradient(
        cx - radius * 0.34,
        cy - radius * 0.38,
        radius * 0.02,
        cx - radius * 0.08,
        cy - radius * 0.08,
        radius * 0.92,
      );
      highlight.addColorStop(0, "rgba(255, 255, 255, 0.16)");
      highlight.addColorStop(0.28, "rgba(255, 255, 255, 0.05)");
      highlight.addColorStop(1, "rgba(255, 255, 255, 0)");
      context.fillStyle = highlight;
      context.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);
      context.restore();

      context.beginPath();
      context.arc(cx, cy, radius, 0, Math.PI * 2);
      context.lineWidth = 1.2;
      context.strokeStyle = "rgba(214, 230, 244, 0.42)";
      context.stroke();

      const activeKey = state.hoverKey || selectedRef.current;
      for (const city of citiesRef.current) {
        const point = projection([city.longitude, city.latitude]);
        if (!point) continue;
        const [x, y] = point;
        const color = STATUS_COLOR[city.status];
        const active = city.key === activeKey;
        context.beginPath();
        context.globalAlpha = active ? 0.28 : 0.18;
        context.fillStyle = color;
        context.arc(x, y, active ? 11 : 8, 0, Math.PI * 2);
        context.fill();
        context.globalAlpha = 1;
        context.beginPath();
        context.fillStyle = color;
        context.arc(x, y, active ? 3.6 : 2.8, 0, Math.PI * 2);
        context.fill();
        if (active) {
          context.beginPath();
          context.lineWidth = 1;
          context.strokeStyle = "rgba(236, 244, 250, 0.8)";
          context.arc(x, y, 6.5, 0, Math.PI * 2);
          context.stroke();
        }
        if (city.total > 1) {
          context.font = "600 11px ui-sans-serif, system-ui, sans-serif";
          context.fillStyle = "#e8eef6";
          context.textAlign = "left";
          context.textBaseline = "middle";
          context.fillText(String(city.total), x + 8, y - 8);
        }
      }
    };

    const wake = () => {
      if (looping) return;
      looping = true;
      last = performance.now();
      frame = requestAnimationFrame(loop);
    };

    const loop = (now: number) => {
      const minFrame = canvas.getBoundingClientRect().width < 720 ? 50 : 32;
      const due = state.dragging || now - lastPaint >= minFrame;
      if (state.visible && due) {
        const dt = Math.min(0.05, (now - last) / 1000);
        last = now;
        lastPaint = now;
        if (state.focus) {
          const progress = Math.min(1, (now - state.focus.started) / 880);
          const eased = 1 - (1 - progress) ** 3;
          state.lng = lerpAngle(state.focus.fromLng, state.focus.lng, eased);
          state.lat = state.focus.fromLat + (state.focus.lat - state.focus.fromLat) * eased;
          if (progress >= 1) state.focus = null;
        } else if (state.auto && !state.dragging && !state.hoverKey) {
          state.lng = wrapLng(state.lng + dt * 2.2);
        }
        paint();
      }
      const keepGoing = state.visible && (state.auto || state.dragging || state.focus != null) && !state.reduced;
      const focusing = state.focus != null;
      if (keepGoing || focusing || state.dragging) {
        frame = requestAnimationFrame(loop);
      } else {
        looping = false;
      }
    };

    paintRef.current = paint;
    wakeRef.current = wake;
    paint();
    if (!state.reduced) wake();

    const onMotion = () => {
      state.reduced = prefersStillMotion();
      state.auto = !state.reduced && selectedRef.current == null && !state.dragging;
      if (state.reduced) state.focus = null;
      wake();
    };
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    motion.addEventListener("change", onMotion);

    const visibility = new IntersectionObserver(([entry]) => {
      state.visible = entry.isIntersecting;
      if (entry.isIntersecting) wake();
    }, { threshold: 0.08 });
    visibility.observe(canvas);

    const resized = new ResizeObserver(() => paint());
    resized.observe(canvas);

    const hit = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const radius = Math.min(rect.width, rect.height) * 0.4;
      const projection = geoOrthographic()
        .translate([rect.width / 2, rect.height * 0.48])
        .scale(radius)
        .rotate([-state.lng, -state.lat])
        .clipAngle(90);
      let found: GlobeCity | null = null;
      let best = 18;
      for (const city of citiesRef.current) {
        const point = projection([city.longitude, city.latitude]);
        if (!point) continue;
        const distance = Math.hypot(point[0] - x, point[1] - y);
        if (distance < best) {
          best = distance;
          found = city;
        }
      }
      return { found, x, y };
    };

    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      state.dragging = true;
      state.moved = false;
      state.auto = false;
      canvas.setPointerCapture(event.pointerId);
      canvas.dataset.x = String(event.clientX);
      canvas.dataset.y = String(event.clientY);
      wake();
    };
    const onPointerMove = (event: PointerEvent) => {
      const previousX = Number(canvas.dataset.x ?? event.clientX);
      const previousY = Number(canvas.dataset.y ?? event.clientY);
      if (state.dragging) {
        const dx = event.clientX - previousX;
        const dy = event.clientY - previousY;
        if (Math.hypot(dx, dy) > 3) state.moved = true;
        state.lng = wrapLng(state.lng - dx * 0.32);
        state.lat = clampLat(state.lat + dy * 0.22);
        canvas.dataset.x = String(event.clientX);
        canvas.dataset.y = String(event.clientY);
        wake();
        return;
      }
      const { found, x, y } = hit(event);
      const nextKey = found?.key ?? null;
      if (nextKey !== state.hoverKey) {
        state.hoverKey = nextKey;
        onHoverRef.current(nextKey, nextKey ? { x, y } : null);
        paint();
      } else if (nextKey) {
        onHoverRef.current(nextKey, { x, y });
      }
    };
    const finishPointer = (event: PointerEvent) => {
      if (!state.dragging) return;
      state.dragging = false;
      if (!state.moved) {
        const { found } = hit(event);
        const nextKey = found && found.key !== selectedRef.current ? found.key : null;
        onSelectRef.current(nextKey);
        state.auto = !state.reduced && nextKey == null;
      } else {
        state.auto = !state.reduced && selectedRef.current == null;
      }
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    };
    const onPointerLeave = () => {
      if (state.dragging || state.hoverKey == null) return;
      state.hoverKey = null;
      onHoverRef.current(null, null);
      paint();
    };

    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", finishPointer);
    canvas.addEventListener("pointercancel", finishPointer);
    canvas.addEventListener("pointerleave", onPointerLeave);

    return () => {
      cancelAnimationFrame(frame);
      motion.removeEventListener("change", onMotion);
      visibility.disconnect();
      resized.disconnect();
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", finishPointer);
      canvas.removeEventListener("pointercancel", finishPointer);
      canvas.removeEventListener("pointerleave", onPointerLeave);
      paintRef.current = null;
      wakeRef.current = null;
    };
  }, []);

  useEffect(() => {
    const state = stateRef.current;
    const city = cities.find((item) => item.key === selectedKey);
    if (!city) {
      state.focus = null;
      state.auto = !state.reduced;
      wakeRef.current?.();
      paintRef.current?.();
      return;
    }
    state.auto = false;
    if (state.reduced) {
      state.lng = city.longitude;
      state.lat = clampLat(city.latitude);
      state.focus = null;
    } else {
      state.focus = {
        lng: city.longitude,
        lat: clampLat(city.latitude),
        fromLng: state.lng,
        fromLat: state.lat,
        started: performance.now(),
      };
    }
    wakeRef.current?.();
  }, [cities, selectedKey]);

  return (
    <canvas
      ref={canvasRef}
      className="node-map-view__globe"
      aria-label="城市级地球"
    />
  );
}
