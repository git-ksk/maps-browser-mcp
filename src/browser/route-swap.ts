import type { MapsAction, RouteAvoid, TravelMode } from "../types.js";
import { BrowserRuntimeError, type MapsBrowserRuntime } from "./runtime.js";
import { MapsUrlCompiler } from "../maps/url-compiler.js";

function normalize(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLocaleLowerCase();
}

function expectedEndpoint(value: string, name: string): string {
  const result = value.replace(/\s+/g, " ").trim();
  if (!result || result.length > 300) {
    throw new BrowserRuntimeError("UI_STATE_CHANGED", `${name} is invalid or too long`);
  }
  return result;
}

function sameAvoid(actual: string | null, expected: readonly RouteAvoid[] | undefined): boolean {
  const expectedValue = expected && expected.length > 0 ? expected.join(",") : null;
  return actual === expectedValue;
}

export function isFreshSimpleDirectionsUrl(value: string, action: Extract<MapsAction, { kind: "directions" }>): boolean {
  if (!action.origin || (action.waypoints?.length ?? 0) > 0) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      ["www.google.com", "google.com", "maps.google.com"].includes(url.hostname) &&
      url.pathname === "/maps/dir/" &&
      url.searchParams.get("api") === "1" &&
      normalize(url.searchParams.get("origin") ?? "") === normalize(action.origin) &&
      normalize(url.searchParams.get("destination") ?? "") === normalize(action.destination) &&
      url.searchParams.get("travelmode") === action.mode &&
      sameAvoid(url.searchParams.get("avoid"), action.avoid);
  } catch {
    return false;
  }
}

export interface RouteSwapResult {
  swapped: true;
  origin: string;
  destination: string;
  mode: TravelMode;
  avoid?: RouteAvoid[];
  url: string;
  source: "google_maps_documented_directions_url";
}

export async function swapVerifiedRouteEndpoints(
  runtime: MapsBrowserRuntime,
  compiler: MapsUrlCompiler,
  expectedOriginInput: string,
  expectedDestinationInput: string
): Promise<RouteSwapResult> {
  const expectedOrigin = expectedEndpoint(expectedOriginInput, "expectedOrigin");
  const expectedDestination = expectedEndpoint(expectedDestinationInput, "expectedDestination");

  await runtime.assertDirectionsContext();
  const last = runtime.getLastAction();
  if (!last || last.kind !== "directions") {
    throw new BrowserRuntimeError("MAPS_NOT_OPEN", "No directions request is active. Call maps_directions first.");
  }
  if (!last.origin) {
    throw new BrowserRuntimeError(
      "UI_STATE_CHANGED",
      "The active directions request has no explicit origin, so its endpoints cannot be swapped safely"
    );
  }
  if ((last.waypoints?.length ?? 0) > 0) {
    throw new BrowserRuntimeError(
      "UI_STATE_CHANGED",
      "Endpoint swapping is restricted to simple two-endpoint routes; waypoint reversal semantics are not guessed"
    );
  }
  if (
    normalize(last.origin) !== normalize(expectedOrigin) ||
    normalize(last.destination) !== normalize(expectedDestination)
  ) {
    throw new BrowserRuntimeError(
      "UI_STATE_CHANGED",
      "The active directions identity no longer matches the expected origin and destination"
    );
  }

  const currentUrl = await runtime.currentUrl();
  if (!isFreshSimpleDirectionsUrl(currentUrl, last)) {
    throw new BrowserRuntimeError(
      "UI_STATE_CHANGED",
      "The active route is no longer the fresh documented directions request. Run maps_directions again before swapping endpoints."
    );
  }

  const compiled = compiler.directions({
    origin: last.destination,
    destination: last.origin,
    mode: last.mode,
    avoid: last.avoid
  });
  const navigated = await runtime.navigate(compiled.url, compiled.action);
  return {
    swapped: true,
    origin: last.destination,
    destination: last.origin,
    mode: last.mode,
    ...(last.avoid && last.avoid.length > 0 ? { avoid: last.avoid } : {}),
    url: navigated.url,
    source: "google_maps_documented_directions_url"
  };
}
