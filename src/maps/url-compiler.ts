import type { MapsAction, TravelMode } from "../types.js";

const MAPS_BASE = "https://www.google.com/maps";
const MAX_URL_LENGTH = 2048;

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
  }): { url: string; action: MapsAction } {
    const destination = nonEmpty(input.destination, "destination");
    const origin = input.origin ? nonEmpty(input.origin, "origin") : undefined;
    const url = new URL(`${MAPS_BASE}/dir/`);
    url.searchParams.set("api", "1");
    if (origin) url.searchParams.set("origin", origin);
    url.searchParams.set("destination", destination);
    url.searchParams.set("travelmode", input.mode);
    return {
      url: finalize(url),
      action: { kind: "directions", origin, destination, mode: input.mode }
    };
  }

  show(input: { latitude: number; longitude: number; zoom?: number }): {
    url: string;
    action: MapsAction;
  } {
    const latitude = bounded(input.latitude, "latitude", -90, 90);
    const longitude = bounded(input.longitude, "longitude", -180, 180);
    const zoom = input.zoom === undefined ? undefined : bounded(input.zoom, "zoom", 0, 21);
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
