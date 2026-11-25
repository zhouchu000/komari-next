import { geoCentroid, geoContains } from "d3-geo";
import { feature } from "topojson-client";

import worldCountries50m from "@/data/world-countries-50m.json" with { type: "json" };

export interface CountryAnchor {
  latitude: number;
  longitude: number;
}

/** ISO numeric ids checked against the bundled basemap. A missing id never invents a point. */
const ALPHA2_TO_NUMERIC: Record<string, string> = {
  AU: "036",
  CA: "124",
  CN: "156",
  DE: "276",
  FR: "250",
  GB: "826",
  HK: "344",
  JP: "392",
  KR: "410",
  NL: "528",
  SG: "702",
  TW: "158",
  US: "840",
};

const ALPHA2_ZH: Record<string, string> = {
  US: "美国",
};

let anchors: Map<string, CountryAnchor> | null = null;

function sameCountryId(featureId: unknown, numeric: string): boolean {
  return String(featureId) === numeric || String(Number(featureId)) === String(Number(numeric));
}

function loadAnchors(): Map<string, CountryAnchor> {
  if (anchors) return anchors;
  const topology = worldCountries50m as unknown as { objects: { countries: never } };
  const collection = feature(topology as never, topology.objects.countries) as unknown as {
    features: Array<{ id?: string | number }>;
  };
  const next = new Map<string, CountryAnchor>();
  for (const [code, numeric] of Object.entries(ALPHA2_TO_NUMERIC)) {
    const country = collection.features.find((item) => sameCountryId(item.id, numeric));
    if (!country) continue;
    const [longitude, latitude] = geoCentroid(country as never);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) continue;
    if (!geoContains(country as never, [longitude, latitude])) continue;
    next.set(code, { latitude, longitude });
  }
  anchors = next;
  return next;
}

/** Representative point of the country shape on this basemap. It is not a city or a datacenter. */
export function countrySchematicAnchor(countryCode: string): CountryAnchor | null {
  return loadAnchors().get(countryCode.trim().toUpperCase()) ?? null;
}

export function countrySchematicLabel(countryCode: string, countryName: string | null): string {
  const name = countryName?.trim() || ALPHA2_ZH[countryCode.trim().toUpperCase()] || countryCode.trim().toUpperCase();
  return `${name}（示意位置，城市待确认）`;
}
