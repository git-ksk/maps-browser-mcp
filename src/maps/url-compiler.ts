import {
  ROUTE_AVOID_OPTIONS,
  type MapsAction,
  type RouteAvoid,
  type TravelMode
} from "../types.js";

const MAPS_BASE = "https://www.google.com/maps";
const MAX_URL_LENGTH = 2048;
const MAX_WAYPOINTS = 3;
const ROUTE_AVOID_SET = new Set<string>(ROUTE_AVOID_OPTIONS);

function nonEmpty(value: string, name: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${name} must not be empty`);
  return trimmed;
}

function bounded(value: number, name: string, min: number, max: number): number {
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${name} must be between ${min} and ${max}`);
  }
  return value;
}

function integerBounded(value: number, name: string, min: number, max: number): number {
  const checked = bounded(value, name, min, max);
  if (!Number.isInteger(checked)) throw new Error(`${name} must be a whole integer`);
  return checked;
}

function normalizedWaypoints(values: readonly string[] | undefined): string[] | undefined {
  if (!values || values.length === 0) return undefined;
  if (values.length > MAX_WAYPOINTS) {
    throw new Error(`waypoints must contain at most ${MAX_WAYPOINTS} locations`);
  }
  return values.map((value, index) => nonEmpty(value, `waypoints[${index}]`));
}

function normalizedAvoid(values: readonly RouteAvoid[] | undefined): RouteAvoid[] | undefined {
  if (!values || values.length === 0) return undefined;
  const result: RouteAvoid[] = [];
  for (const value of values) {
    if (!ROUTE_AVOID_SET.has(value)) throw new Error(`Unsupported route avoidance option: ${value}`);
    if (!result.includes(value)) result.push(value);
  }
  return result.length > 0 ? result : undefined;
}

function finalize(url: URL): string {
  const result = url.toString();
  if (result.length > MAX_URL_LENGTH) {
    throw new Error(`Generated Google Maps URL exceeds ${MAX_URL_LENGTH} characters`);
  }
  return result;
}

export class MapsUrlCompiler {
  search(query: string): { url: string; action: MapsAction } {
    const cleanQuery = nonEmpty(query, "query");
    const url = new URL(`${MAPS_BASE}/search/`);
    url.searchParams.set("api", "1");
    url.searchParams.set("query", cleanQuery);
    return { url: finalize(url), action: { kind: "search", query: cleanQuery } };
  }

  directions(input: {
    origin?: string;
    destination: string;
    mode: TravelMode;
    waypoints?: readonly string[];
    avoid?: readonly RouteAvoid[];
  }): { url: string; action: MapsAction } {
    const destination = nonEmpty(input.destination, "destination");
    const origin = input.origin ? nonEmpty(input.origin, "origin") : undefined;
    const waypoints = normalizedWaypoints(input.waypoints);
    const avoid = normalizedAvoid(input.avoid);
    const url = new URL(`${MAPS_BASE}/dir/`);
    url.searchParams.set("api", "1");
    if (origin) url.searchParams.set("origin", origin);
    url.searchParams.set("destination", destination);
    url.searchParams.set("travelmode", input.mode);
    if (waypoints) url.searchParams.set("waypoints", waypoints.join("|"));
    if (avoid) url.searchParams.set("avoid", avoid.join(","));
    return {
      url: finalize(url),
      action: {
        kind: "directions",
        origin,
        destination,
        mode: input.mode,
        ...(waypoints ? { waypoints } : {}),
        ...(avoid ? { avoid } : {})
      }
    };
  }

  show(input: { latitude: number; longitude: number; zoom?: number }): {
    url: string;
    action: MapsAction;
  } {
    const latitude = bounded(input.latitude, "latitude", -90, 90);
    const longitude = bounded(input.longitude, "longitude", -180, 180);
    const zoom = input.zoom === undefined ? undefined : integerBounded(input.zoom, "zoom", 0, 21);
    const url = new URL(`${MAPS_BASE}/@`);
    url.searchParams.set("api", "1");
    url.searchParams.set("map_action", "map");
    url.searchParams.set("center", `${latitude},${longitude}`);
    if (zoom !== undefined) url.searchParams.set("zoom", String(zoom));
    return {
      url: finalize(url),
      action: { kind: "show", latitude, longitude, zoom }
    };
  }

  streetview(input: {
    latitude: number;
    longitude: number;
    heading?: number;
    pitch?: number;
    fov?: number;
  }): { url: string; action: MapsAction } {
    const latitude = bounded(input.latitude, "latitude", -90, 90);
    const longitude = bounded(input.longitude, "longitude", -180, 180);
    const heading = input.heading === undefined ? undefined : bounded(input.heading, "heading", 0, 360);
    const pitch = input.pitch === undefined ? undefined : bounded(input.pitch, "pitch", -90, 90);
    const fov = input.fov === undefined ? undefined : bounded(input.fov, "fov", 10, 100);
    const url = new URL(`${MAPS_BASE}/@`);
    url.searchParams.set("api", "1");
    url.searchParams.set("map_action", "pano");
    url.searchParams.set("viewpoint", `${latitude},${longitude}`);
    if (heading !== undefined) url.searchParams.set("heading", String(heading));
    if (pitch !== undefined) url.searchParams.set("pitch", String(pitch));
    if (fov !== undefined) url.searchParams.set("fov", String(fov));
    return {
      url: finalize(url),
      action: { kind: "streetview", latitude, longitude, heading, pitch, fov }
    };
  }
}
