import { BrowserRuntimeError, type MapsBrowserRuntime } from "./runtime.js";
import { normalizeExpectedSearchQuery } from "./search-rating-filter.js";

export const SEARCH_ZOOM_DIRECTIONS = ["in", "out"] as const;
export type SearchZoomDirection = (typeof SEARCH_ZOOM_DIRECTIONS)[number];

const UI_SETTLE_TIMEOUT_MS = 3_500;
const POLL_INTERVAL_MS = 100;
const ZOOM_EPSILON = 1e-6;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function assertActiveSearch(runtime: MapsBrowserRuntime): Promise<void> {
  const state = await runtime.assertReadableView("place");
  if (state !== "search" || runtime.getViewState() !== "search") {
    if (!runtime.getActiveIntervention()) runtime.invalidateSemanticContext();
    throw new BrowserRuntimeError(
      "UI_STATE_CHANGED",
      "The browser no longer matches the active Google Maps search-result state. Run maps_search again."
    );
  }
}

function normalize(value: string): string {
  return value
    .replace(/[\uE000-\uF8FF]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase();
}

function labelsForDirection(direction: SearchZoomDirection): readonly string[] {
  return direction === "in"
    ? ["Zoom in", "ズームイン"]
    : ["Zoom out", "ズームアウト"];
}

function observedDirectionLabel(value: string, direction: SearchZoomDirection): boolean {
  const expected = new Set(labelsForDirection(direction).map(normalize));
  return expected.has(normalize(value));
}

export function parseSearchZoomLevelFromPath(path: string): number | undefined {
  if (!path.startsWith("/maps/search/")) return undefined;
  const match = path.match(/@-?\d+(?:\.\d+)?,-?\d+(?:\.\d+)?,(\d+(?:\.\d+)?)z(?:\/|$)/);
  if (!match) return undefined;
  const value = Number(match[1]);
  return Number.isFinite(value) && value >= 0 && value <= 21 ? value : undefined;
}

type PendingProbe = { state: "pending" };

export type SearchZoomActionState = {
  state: "ready";
  beforeZoom: number;
  controlLabel: string;
};

export function parseSearchZoomActionProbe(
  value: unknown,
  expectedQuery: string,
  direction: SearchZoomDirection
): SearchZoomActionState | PendingProbe {
  const probe = value as {
    ok?: unknown;
    reason?: unknown;
    queryValue?: unknown;
    controlLabel?: unknown;
    beforeZoom?: unknown;
    path?: unknown;
  } | null | undefined;

  if (
    probe?.ok === true &&
    typeof probe.queryValue === "string" &&
    typeof probe.controlLabel === "string" &&
    typeof probe.beforeZoom === "number" &&
    typeof probe.path === "string"
  ) {
    const parsedZoom = parseSearchZoomLevelFromPath(probe.path);
    if (
      normalize(probe.queryValue) !== normalize(expectedQuery) ||
      !observedDirectionLabel(probe.controlLabel, direction) ||
      !Number.isInteger(probe.beforeZoom) ||
      parsedZoom !== probe.beforeZoom
    ) {
      throw new BrowserRuntimeError(
        "UI_STATE_CHANGED",
        "The Google Maps search query, viewport, or requested zoom control changed immediately before the action"
      );
    }
    return { state: "ready", beforeZoom: probe.beforeZoom, controlLabel: probe.controlLabel };
  }

  if (probe?.reason === "pending") return { state: "pending" };
  if (probe?.reason === "disabled") {
    throw new BrowserRuntimeError(
      "UI_ELEMENT_NOT_FOUND",
      `Google Maps cannot zoom ${direction} further at the current search viewport`
    );
  }
  if (probe?.reason === "missing_zoom") {
    throw new BrowserRuntimeError(
      "UI_ELEMENT_NOT_FOUND",
      `The verified Google Maps zoom-${direction} control was not found`
    );
  }
  if (
    probe?.reason === "changed_query" ||
    probe?.reason === "ambiguous_query" ||
    probe?.reason === "ambiguous_zoom" ||
    probe?.reason === "changed_zoom"
  ) {
    throw new BrowserRuntimeError(
      "UI_STATE_CHANGED",
      "The Google Maps search query or zoom control became stale or ambiguous; refusing to guess"
    );
  }

  throw new BrowserRuntimeError(
    "UI_ELEMENT_NOT_FOUND",
    `The verified Google Maps zoom-${direction} control was not found`
  );
}

export function parseSearchZoomPostconditionProbe(
  value: unknown,
  expectedQuery: string,
  direction: SearchZoomDirection,
  beforeZoom: number
): "ready" | "pending" {
  const probe = value as {
    ok?: unknown;
    reason?: unknown;
    queryValue?: unknown;
    controlLabel?: unknown;
    currentZoom?: unknown;
    path?: unknown;
  } | null | undefined;

  if (
    probe?.ok === true &&
    typeof probe.queryValue === "string" &&
    typeof probe.controlLabel === "string" &&
    typeof probe.currentZoom === "number" &&
    typeof probe.path === "string"
  ) {
    const parsedZoom = parseSearchZoomLevelFromPath(probe.path);
    if (
      normalize(probe.queryValue) !== normalize(expectedQuery) ||
      !observedDirectionLabel(probe.controlLabel, direction) ||
      parsedZoom === undefined ||
      Math.abs(parsedZoom - probe.currentZoom) > ZOOM_EPSILON
    ) {
      throw new BrowserRuntimeError(
        "UI_STATE_CHANGED",
        "The Google Maps search query or zoom viewport changed unexpectedly after the action"
      );
    }

    const targetZoom = direction === "in" ? beforeZoom + 1 : beforeZoom - 1;
    if (Math.abs(probe.currentZoom - targetZoom) <= ZOOM_EPSILON) return "ready";
    if (Math.abs(probe.currentZoom - beforeZoom) <= ZOOM_EPSILON) return "pending";

    const movingTowardTarget = direction === "in"
      ? probe.currentZoom > beforeZoom && probe.currentZoom < targetZoom
      : probe.currentZoom < beforeZoom && probe.currentZoom > targetZoom;
    if (movingTowardTarget) return "pending";

    throw new BrowserRuntimeError(
      "UI_STATE_CHANGED",
      `Google Maps changed the search zoom by an unexpected amount (before ${beforeZoom}, observed ${probe.currentZoom})`
    );
  }

  if (probe?.reason === "pending") return "pending";
  if (
    probe?.reason === "changed_query" ||
    probe?.reason === "ambiguous_query" ||
    probe?.reason === "ambiguous_zoom" ||
    probe?.reason === "changed_zoom"
  ) {
    throw new BrowserRuntimeError(
      "UI_STATE_CHANGED",
      "The Google Maps search query or zoom control became stale or ambiguous after the action"
    );
  }

  return "pending";
}

function queryIdentityPrelude(expectedQuery: string): string {
  const expected = JSON.stringify(normalize(expectedQuery));
  return `
    const inputs = Array.from(document.querySelectorAll('input, [role="combobox"]')).filter(visible).slice(0, 24);
    const exactQueries = inputs.filter((el) => normalize(el.value) === ${expected});
    const nonEmptyQueries = inputs.filter((el) => clean(el.value).length > 0);
    if (exactQueries.length > 1) return { ok: false, reason: 'ambiguous_query' };
    if (exactQueries.length === 0) return { ok: false, reason: nonEmptyQueries.length > 0 ? 'changed_query' : 'pending' };
  `;
}

function zoomActionExpression(expectedQuery: string, direction: SearchZoomDirection): string {
  const labels = JSON.stringify(labelsForDirection(direction).map(normalize));
  return `(() => {
    const visible = (el) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
    };
    const clean = (value) => String(value || '').replace(/[\\uE000-\\uF8FF]/g, '').replace(/\\s+/g, ' ').trim();
    const normalize = (value) => clean(value).toLocaleLowerCase();
    ${queryIdentityPrelude(expectedQuery)}
    const allowedLabels = new Set(${labels});
    const controls = Array.from(document.querySelectorAll('button, [role="button"]')).filter(visible).slice(0, 220)
      .filter((el) => allowedLabels.has(normalize(el.getAttribute('aria-label') || el.textContent || '')));
    if (controls.length === 0) return { ok: false, reason: 'pending' };
    if (controls.length !== 1) return { ok: false, reason: 'ambiguous_zoom' };
    const control = controls[0];
    if (control.tagName !== 'BUTTON' && control.getAttribute('role') !== 'button') {
      return { ok: false, reason: 'changed_zoom' };
    }
    if (control.disabled === true || control.getAttribute('aria-disabled') === 'true') {
      return { ok: false, reason: 'disabled' };
    }

    const match = location.pathname.match(/@-?\\d+(?:\\.\\d+)?,-?\\d+(?:\\.\\d+)?,(\\d+)z(?:\\/|$)/);
    if (!match) return { ok: false, reason: 'pending' };
    const beforeZoom = Number(match[1]);
    if (!Number.isInteger(beforeZoom) || beforeZoom < 0 || beforeZoom > 21) {
      return { ok: false, reason: 'changed_zoom' };
    }

    const queryValue = clean(exactQueries[0].value).slice(0, 500);
    const controlLabel = clean(control.getAttribute('aria-label') || control.textContent || '').slice(0, 80);
    const path = location.pathname.slice(0, 800);
    control.click();
    return { ok: true, queryValue, controlLabel, beforeZoom, path };
  })()`;
}

function zoomPostconditionExpression(expectedQuery: string, direction: SearchZoomDirection): string {
  const labels = JSON.stringify(labelsForDirection(direction).map(normalize));
  return `(() => {
    const visible = (el) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
    };
    const clean = (value) => String(value || '').replace(/[\\uE000-\\uF8FF]/g, '').replace(/\\s+/g, ' ').trim();
    const normalize = (value) => clean(value).toLocaleLowerCase();
    ${queryIdentityPrelude(expectedQuery)}
    const allowedLabels = new Set(${labels});
    const controls = Array.from(document.querySelectorAll('button, [role="button"]')).filter(visible).slice(0, 220)
      .filter((el) => allowedLabels.has(normalize(el.getAttribute('aria-label') || el.textContent || '')));
    if (controls.length === 0) return { ok: false, reason: 'pending' };
    if (controls.length !== 1) return { ok: false, reason: 'ambiguous_zoom' };
    const control = controls[0];
    if (control.tagName !== 'BUTTON' && control.getAttribute('role') !== 'button') {
      return { ok: false, reason: 'changed_zoom' };
    }

    const match = location.pathname.match(/@-?\\d+(?:\\.\\d+)?,-?\\d+(?:\\.\\d+)?,(\\d+(?:\\.\\d+)?)z(?:\\/|$)/);
    if (!match) return { ok: false, reason: 'pending' };
    const currentZoom = Number(match[1]);
    if (!Number.isFinite(currentZoom) || currentZoom < 0 || currentZoom > 21) {
      return { ok: false, reason: 'changed_zoom' };
    }
    return {
      ok: true,
      queryValue: clean(exactQueries[0].value).slice(0, 500),
      controlLabel: clean(control.getAttribute('aria-label') || control.textContent || '').slice(0, 80),
      currentZoom,
      path: location.pathname.slice(0, 800)
    };
  })()`;
}

async function waitForZoomAction(
  runtime: MapsBrowserRuntime,
  expectedQuery: string,
  direction: SearchZoomDirection,
  markUiMutated: () => void
): Promise<SearchZoomActionState> {
  const client = await runtime.getClient();
  const deadline = Date.now() + UI_SETTLE_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await assertActiveSearch(runtime);
    const evaluated = await client.Runtime.evaluate({
      expression: zoomActionExpression(expectedQuery, direction),
      returnByValue: true,
      awaitPromise: true
    });
    const raw = evaluated.result.value as { ok?: unknown } | undefined;
    if (raw?.ok === true) markUiMutated();
    const parsed = parseSearchZoomActionProbe(evaluated.result.value, expectedQuery, direction);
    if (parsed.state === "ready") return parsed;
    await sleep(POLL_INTERVAL_MS);
  }
  throw new BrowserRuntimeError(
    "UI_ELEMENT_NOT_FOUND",
    `The verified Google Maps zoom-${direction} control did not become available in a settled search viewport`
  );
}

async function waitForZoomPostcondition(
  runtime: MapsBrowserRuntime,
  expectedQuery: string,
  direction: SearchZoomDirection,
  beforeZoom: number
): Promise<number> {
  const client = await runtime.getClient();
  const deadline = Date.now() + UI_SETTLE_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await assertActiveSearch(runtime);
    const evaluated = await client.Runtime.evaluate({
      expression: zoomPostconditionExpression(expectedQuery, direction),
      returnByValue: true,
      awaitPromise: true
    });
    const parsed = parseSearchZoomPostconditionProbe(
      evaluated.result.value,
      expectedQuery,
      direction,
      beforeZoom
    );
    if (parsed === "ready") return direction === "in" ? beforeZoom + 1 : beforeZoom - 1;
    await sleep(POLL_INTERVAL_MS);
  }
  throw new BrowserRuntimeError(
    "UI_STATE_CHANGED",
    `Google Maps did not verify the requested zoom-${direction} transition in the active search viewport`
  );
}

export interface SearchZoomResult {
  zoomed: true;
  query: string;
  direction: SearchZoomDirection;
  beforeZoom: number;
  afterZoom: number;
  source: "google_maps_search_zoom";
}

export async function zoomVerifiedSearch(
  runtime: MapsBrowserRuntime,
  expectedQueryInput: string,
  direction: SearchZoomDirection
): Promise<SearchZoomResult> {
  const expectedQuery = normalizeExpectedSearchQuery(expectedQueryInput);
  await assertActiveSearch(runtime);

  let uiMutated = false;
  try {
    const action = await waitForZoomAction(runtime, expectedQuery, direction, () => {
      uiMutated = true;
    });
    const afterZoom = await waitForZoomPostcondition(runtime, expectedQuery, direction, action.beforeZoom);
    runtime.markSemanticMutation();
    return {
      zoomed: true,
      query: expectedQuery,
      direction,
      beforeZoom: action.beforeZoom,
      afterZoom,
      source: "google_maps_search_zoom"
    };
  } catch (error) {
    if (uiMutated && !runtime.getActiveIntervention()) runtime.invalidateSemanticContext();
    throw error;
  }
}
