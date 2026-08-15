import type { MapsAction } from "../types.js";
import { BrowserRuntimeError, type MapsBrowserRuntime } from "./runtime.js";

export const TRANSIT_TIME_MODES = ["depart_at", "arrive_by"] as const;
export type TransitTimeMode = (typeof TRANSIT_TIME_MODES)[number];

const INITIAL_TRIGGER_LABELS = ["Leave now", "すぐに出発"] as const;
const MODE_LABELS: Record<TransitTimeMode, readonly string[]> = {
  depart_at: ["Depart at", "出発時刻"],
  arrive_by: ["Arrive by", "到着時刻"]
};
const ROUTE_SETTLE_TIMEOUT_MS = 3_500;
const POSTCONDITION_TIMEOUT_MS = 4_000;
const POLL_INTERVAL_MS = 100;
const MAX_ENDPOINT_LENGTH = 300;
const MAX_RESOLVED_ENDPOINT_LENGTH = 500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalize(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLocaleLowerCase();
}

function normalizedEndpoint(value: string, name: string): string {
  const result = value.replace(/\s+/g, " ").trim();
  if (!result || result.length > MAX_ENDPOINT_LENGTH) {
    throw new BrowserRuntimeError("UI_STATE_CHANGED", `${name} is invalid or too long`);
  }
  return result;
}

export function normalizeTransitClockTime(value: string): string {
  const match = /^(\d{2}):(\d{2})$/.exec(value.trim());
  if (!match) {
    throw new BrowserRuntimeError("UI_STATE_CHANGED", "Transit time must use 24-hour HH:MM format");
  }
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) {
    throw new BrowserRuntimeError("UI_STATE_CHANGED", "Transit time must use a valid 24-hour HH:MM value");
  }
  return `${match[1]}:${match[2]}`;
}

export function formatTransitClockForObservedInput(requestedTime: string, observedValue: string): string {
  const normalizedTime = normalizeTransitClockTime(requestedTime);
  const [hourText, minuteText] = normalizedTime.split(":");
  const hour = Number(hourText);

  if (/^\d{1,2}:\d{2}$/.test(observedValue.trim())) return normalizedTime;
  if (/^\d{1,2}:\d{2}\s(?:AM|PM)$/i.test(observedValue.trim())) {
    const suffix = hour >= 12 ? "PM" : "AM";
    const twelveHour = hour % 12 || 12;
    return `${twelveHour}:${minuteText} ${suffix}`;
  }

  throw new BrowserRuntimeError(
    "UI_STATE_CHANGED",
    "Google Maps exposed an unrecognized transit-time input format; refusing to guess"
  );
}

export function isFreshTransitDirectionsUrl(
  value: string,
  expectedOrigin: string,
  expectedDestination: string
): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      ["www.google.com", "google.com", "maps.google.com"].includes(url.hostname) &&
      url.pathname === "/maps/dir/" &&
      url.searchParams.get("api") === "1" &&
      normalize(url.searchParams.get("origin") ?? "") === normalize(expectedOrigin) &&
      normalize(url.searchParams.get("destination") ?? "") === normalize(expectedDestination) &&
      url.searchParams.get("travelmode") === "transit";
  } catch {
    return false;
  }
}

function assertCanonicalTransitAction(
  action: MapsAction | undefined,
  expectedOrigin: string,
  expectedDestination: string
): void {
  if (
    action?.kind !== "directions" ||
    action.mode !== "transit" ||
    action.origin === undefined ||
    normalize(action.origin) !== normalize(expectedOrigin) ||
    normalize(action.destination) !== normalize(expectedDestination) ||
    (action.waypoints?.length ?? 0) !== 0 ||
    (action.avoid?.length ?? 0) !== 0
  ) {
    throw new BrowserRuntimeError(
      "UI_STATE_CHANGED",
      "The active directions request does not match the expected simple transit route"
    );
  }
}

async function assertFreshTransitRoute(
  runtime: MapsBrowserRuntime,
  expectedOrigin: string,
  expectedDestination: string
): Promise<void> {
  await runtime.assertDirectionsContext();
  assertCanonicalTransitAction(runtime.getLastAction(), expectedOrigin, expectedDestination);
  const currentUrl = await runtime.currentUrl();
  if (!isFreshTransitDirectionsUrl(currentUrl, expectedOrigin, expectedDestination)) {
    throw new BrowserRuntimeError(
      "UI_STATE_CHANGED",
      "Google Maps no longer exposes the fresh documented transit route identity. Run maps_directions again before setting a transit time."
    );
  }
}

function observedInitialTrigger(value: string): boolean {
  const candidate = normalize(value);
  return INITIAL_TRIGGER_LABELS.some((label) => normalize(label) === candidate);
}

function observedModeLabel(value: string, mode: TransitTimeMode): boolean {
  const candidate = normalize(value);
  return MODE_LABELS[mode].some((label) => normalize(label) === candidate);
}

export interface TransitRouteSnapshot {
  originValue: string;
  destinationValue: string;
}

type PendingProbe = { state: "pending" };

export function parseTransitTimeOpenProbe(value: unknown): TransitRouteSnapshot | PendingProbe {
  const probe = value as {
    ok?: unknown;
    reason?: unknown;
    triggerLabel?: unknown;
    originValue?: unknown;
    destinationValue?: unknown;
  } | null | undefined;

  if (
    probe?.ok === true &&
    typeof probe.triggerLabel === "string" &&
    typeof probe.originValue === "string" &&
    typeof probe.destinationValue === "string"
  ) {
    if (
      !observedInitialTrigger(probe.triggerLabel) ||
      !probe.originValue.trim() ||
      !probe.destinationValue.trim() ||
      probe.originValue.length > MAX_RESOLVED_ENDPOINT_LENGTH ||
      probe.destinationValue.length > MAX_RESOLVED_ENDPOINT_LENGTH
    ) {
      throw new BrowserRuntimeError("UI_STATE_CHANGED", "The visible transit route identity changed before the time action");
    }
    return { originValue: probe.originValue, destinationValue: probe.destinationValue };
  }

  if (probe?.reason === "pending") return { state: "pending" };
  if (probe?.reason === "missing_trigger") {
    throw new BrowserRuntimeError("UI_ELEMENT_NOT_FOUND", "The verified Google Maps Leave now control was not found");
  }
  if (
    probe?.reason === "ambiguous_trigger" ||
    probe?.reason === "ambiguous_origin" ||
    probe?.reason === "ambiguous_destination" ||
    probe?.reason === "stale_time_state"
  ) {
    throw new BrowserRuntimeError(
      "UI_STATE_CHANGED",
      "The Google Maps transit route or time control is stale or ambiguous; refusing to guess"
    );
  }
  throw new BrowserRuntimeError("UI_ELEMENT_NOT_FOUND", "The verified Google Maps transit-time control was not found");
}

export function parseTransitTimeMenuProbe(value: unknown, mode: TransitTimeMode): "ready" | PendingProbe {
  const probe = value as { ok?: unknown; reason?: unknown; targetLabel?: unknown } | null | undefined;
  if (probe?.ok === true && typeof probe.targetLabel === "string") {
    if (!observedModeLabel(probe.targetLabel, mode)) {
      throw new BrowserRuntimeError("UI_STATE_CHANGED", "The Google Maps transit time option changed before selection");
    }
    return "ready";
  }
  if (probe?.reason === "pending") return { state: "pending" };
  if (probe?.reason === "missing_option") {
    throw new BrowserRuntimeError("UI_ELEMENT_NOT_FOUND", "The requested Google Maps transit time option was not found");
  }
  if (probe?.reason === "ambiguous_option" || probe?.reason === "missing_base_option") {
    throw new BrowserRuntimeError("UI_STATE_CHANGED", "The Google Maps transit time menu is stale or ambiguous");
  }
  throw new BrowserRuntimeError("UI_ELEMENT_NOT_FOUND", "The requested Google Maps transit time option was not found");
}

export interface TransitTimeInputState {
  observedTime: string;
}

export function parseTransitTimeInputProbe(
  value: unknown,
  mode: TransitTimeMode,
  snapshot: TransitRouteSnapshot
): TransitTimeInputState | PendingProbe {
  const probe = value as {
    ok?: unknown;
    reason?: unknown;
    triggerLabel?: unknown;
    originValue?: unknown;
    destinationValue?: unknown;
    timeValue?: unknown;
  } | null | undefined;

  if (
    probe?.ok === true &&
    typeof probe.triggerLabel === "string" &&
    typeof probe.originValue === "string" &&
    typeof probe.destinationValue === "string" &&
    typeof probe.timeValue === "string"
  ) {
    if (
      !observedModeLabel(probe.triggerLabel, mode) ||
      probe.originValue !== snapshot.originValue ||
      probe.destinationValue !== snapshot.destinationValue
    ) {
      throw new BrowserRuntimeError("UI_STATE_CHANGED", "The visible transit route identity changed after choosing the time mode");
    }
    return { observedTime: probe.timeValue };
  }

  if (probe?.reason === "pending") return { state: "pending" };
  if (
    probe?.reason === "ambiguous_trigger" ||
    probe?.reason === "ambiguous_time" ||
    probe?.reason === "ambiguous_origin" ||
    probe?.reason === "ambiguous_destination" ||
    probe?.reason === "changed_route"
  ) {
    throw new BrowserRuntimeError("UI_STATE_CHANGED", "The Google Maps transit route or time input became stale or ambiguous");
  }
  throw new BrowserRuntimeError("UI_ELEMENT_NOT_FOUND", "The verified Google Maps transit-time input was not found");
}

export function parseTransitTimePostconditionProbe(
  value: unknown,
  mode: TransitTimeMode,
  snapshot: TransitRouteSnapshot,
  expectedDisplayTime: string
): "ready" | PendingProbe {
  const parsed = parseTransitTimeInputProbe(value, mode, snapshot);
  if ("state" in parsed) return parsed;
  if (parsed.observedTime === expectedDisplayTime) return "ready";
  return { state: "pending" };
}

function endpointPrelude(): string {
  return `
    const inputs = Array.from(document.querySelectorAll('input')).filter(visible).slice(0, 24);
    const origins = inputs.filter((el) => /^(Starting point |出発地 )/.test(el.getAttribute('aria-label') || ''));
    const destinations = inputs.filter((el) => /^(Destination |目的地 )/.test(el.getAttribute('aria-label') || ''));
    if (origins.length !== 1) return { ok: false, reason: origins.length === 0 ? 'pending' : 'ambiguous_origin' };
    if (destinations.length !== 1) return { ok: false, reason: destinations.length === 0 ? 'pending' : 'ambiguous_destination' };
  `;
}

function openTransitTimeExpression(): string {
  const labels = JSON.stringify(INITIAL_TRIGGER_LABELS.map(normalize));
  return `(() => {
    const visible = (el) => { const r=el.getBoundingClientRect(); const s=getComputedStyle(el); return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none'; };
    const clean = (value) => String(value || '').replace(/[\\uE000-\\uF8FF]/g, '').replace(/\\s+/g, ' ').trim();
    const normalize = (value) => clean(value).toLocaleLowerCase();
    ${endpointPrelude()}
    const timeInputs = inputs.filter((el) => el.getAttribute('name') === 'transit-time');
    if (timeInputs.length > 0) return { ok: false, reason: 'stale_time_state' };
    const allowed = new Set(${labels});
    const triggers = Array.from(document.querySelectorAll('button, [role="button"]')).filter(visible).slice(0, 180)
      .filter((el) => allowed.has(normalize(el.getAttribute('aria-label') || el.textContent || '')));
    if (triggers.length === 0) return { ok: false, reason: 'pending' };
    if (triggers.length !== 1) return { ok: false, reason: 'ambiguous_trigger' };
    const trigger = triggers[0];
    const result = {
      ok: true,
      triggerLabel: clean(trigger.getAttribute('aria-label') || trigger.textContent || '').slice(0, 80),
      originValue: clean(origins[0].value).slice(0, 500),
      destinationValue: clean(destinations[0].value).slice(0, 500)
    };
    trigger.click();
    return result;
  })()`;
}

function transitTimeMenuExpression(mode: TransitTimeMode): string {
  const targetLabels = JSON.stringify(MODE_LABELS[mode].map(normalize));
  const baseLabels = JSON.stringify(INITIAL_TRIGGER_LABELS.map(normalize));
  return `(() => {
    const visible = (el) => { const r=el.getBoundingClientRect(); const s=getComputedStyle(el); return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none'; };
    const clean = (value) => String(value || '').replace(/[\\uE000-\\uF8FF]/g, '').replace(/\\s+/g, ' ').trim();
    const normalize = (value) => clean(value).toLocaleLowerCase();
    const items = Array.from(document.querySelectorAll('[role="menuitemradio"]')).filter(visible).slice(0, 20);
    const baseAllowed = new Set(${baseLabels});
    const targetAllowed = new Set(${targetLabels});
    const bases = items.filter((el) => baseAllowed.has(normalize(el.getAttribute('aria-label') || el.textContent || '')));
    if (bases.length !== 1) return { ok: false, reason: bases.length === 0 ? 'pending' : 'missing_base_option' };
    const targets = items.filter((el) => targetAllowed.has(normalize(el.getAttribute('aria-label') || el.textContent || '')));
    if (targets.length === 0) return { ok: false, reason: 'pending' };
    if (targets.length !== 1) return { ok: false, reason: 'ambiguous_option' };
    const target = targets[0];
    const targetLabel = clean(target.getAttribute('aria-label') || target.textContent || '').slice(0, 80);
    target.click();
    return { ok: true, targetLabel };
  })()`;
}

function transitTimeInputExpression(
  mode: TransitTimeMode,
  snapshot: TransitRouteSnapshot,
  focus: boolean
): string {
  const labels = JSON.stringify(MODE_LABELS[mode].map(normalize));
  const origin = JSON.stringify(snapshot.originValue);
  const destination = JSON.stringify(snapshot.destinationValue);
  return `(() => {
    const visible = (el) => { const r=el.getBoundingClientRect(); const s=getComputedStyle(el); return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none'; };
    const clean = (value) => String(value || '').replace(/[\\uE000-\\uF8FF]/g, '').replace(/\\s+/g, ' ').trim();
    const normalize = (value) => clean(value).toLocaleLowerCase();
    ${endpointPrelude()}
    if (clean(origins[0].value) !== ${origin} || clean(destinations[0].value) !== ${destination}) {
      return { ok: false, reason: 'changed_route' };
    }
    const allowed = new Set(${labels});
    const triggers = Array.from(document.querySelectorAll('button, [role="button"]')).filter(visible).slice(0, 180)
      .filter((el) => allowed.has(normalize(el.getAttribute('aria-label') || el.textContent || '')));
    if (triggers.length === 0) return { ok: false, reason: 'pending' };
    if (triggers.length !== 1) return { ok: false, reason: 'ambiguous_trigger' };
    const timeInputs = inputs.filter((el) => el.getAttribute('name') === 'transit-time');
    if (timeInputs.length === 0) return { ok: false, reason: 'pending' };
    if (timeInputs.length !== 1) return { ok: false, reason: 'ambiguous_time' };
    const time = timeInputs[0];
    ${focus ? "time.focus(); if (typeof time.select === 'function') time.select();" : ""}
    return {
      ok: true,
      triggerLabel: clean(triggers[0].getAttribute('aria-label') || triggers[0].textContent || '').slice(0, 80),
      originValue: clean(origins[0].value).slice(0, 500),
      destinationValue: clean(destinations[0].value).slice(0, 500),
      timeValue: clean(time.value).slice(0, 40)
    };
  })()`;
}

async function waitForOpen(
  runtime: MapsBrowserRuntime,
  markUiMutated: () => void
): Promise<TransitRouteSnapshot> {
  const client = await runtime.getClient();
  const deadline = Date.now() + ROUTE_SETTLE_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await runtime.assertDirectionsContext();
    const evaluated = await client.Runtime.evaluate({ expression: openTransitTimeExpression(), returnByValue: true, awaitPromise: true });
    const raw = evaluated.result.value as { ok?: unknown } | undefined;
    if (raw?.ok === true) markUiMutated();
    const parsed = parseTransitTimeOpenProbe(evaluated.result.value);
    if (!("state" in parsed)) return parsed;
    await sleep(POLL_INTERVAL_MS);
  }
  throw new BrowserRuntimeError("UI_ELEMENT_NOT_FOUND", "The verified Google Maps Leave now control did not become available");
}

async function chooseMode(
  runtime: MapsBrowserRuntime,
  mode: TransitTimeMode
): Promise<void> {
  const client = await runtime.getClient();
  const deadline = Date.now() + ROUTE_SETTLE_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const evaluated = await client.Runtime.evaluate({ expression: transitTimeMenuExpression(mode), returnByValue: true, awaitPromise: true });
    const parsed = parseTransitTimeMenuProbe(evaluated.result.value, mode);
    if (parsed === "ready") return;
    await sleep(POLL_INTERVAL_MS);
  }
  throw new BrowserRuntimeError("UI_ELEMENT_NOT_FOUND", "The requested Google Maps transit time option did not become available");
}

async function prepareTimeInput(
  runtime: MapsBrowserRuntime,
  mode: TransitTimeMode,
  snapshot: TransitRouteSnapshot
): Promise<TransitTimeInputState> {
  const client = await runtime.getClient();
  const deadline = Date.now() + ROUTE_SETTLE_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const currentUrl = await runtime.assertMapsSurface();
    if (!new URL(currentUrl).pathname.startsWith("/maps/dir/")) {
      throw new BrowserRuntimeError("UI_STATE_CHANGED", "Google Maps left the directions view after selecting the transit time mode");
    }
    const evaluated = await client.Runtime.evaluate({ expression: transitTimeInputExpression(mode, snapshot, true), returnByValue: true, awaitPromise: true });
    const parsed = parseTransitTimeInputProbe(evaluated.result.value, mode, snapshot);
    if (!("state" in parsed)) return parsed;
    await sleep(POLL_INTERVAL_MS);
  }
  throw new BrowserRuntimeError("UI_ELEMENT_NOT_FOUND", "The verified Google Maps transit-time input did not become available");
}

async function waitForPostcondition(
  runtime: MapsBrowserRuntime,
  mode: TransitTimeMode,
  snapshot: TransitRouteSnapshot,
  expectedDisplayTime: string
): Promise<void> {
  const client = await runtime.getClient();
  const deadline = Date.now() + POSTCONDITION_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const currentUrl = await runtime.assertMapsSurface();
    if (!new URL(currentUrl).pathname.startsWith("/maps/dir/")) {
      throw new BrowserRuntimeError("UI_STATE_CHANGED", "Google Maps left the directions view after setting the transit time");
    }
    const evaluated = await client.Runtime.evaluate({ expression: transitTimeInputExpression(mode, snapshot, false), returnByValue: true, awaitPromise: true });
    const parsed = parseTransitTimePostconditionProbe(evaluated.result.value, mode, snapshot, expectedDisplayTime);
    if (parsed === "ready") return;
    await sleep(POLL_INTERVAL_MS);
  }
  throw new BrowserRuntimeError("UI_STATE_CHANGED", "Google Maps did not verify the requested transit time");
}

export interface TransitTimeResult {
  scheduled: true;
  origin: string;
  destination: string;
  mode: TransitTimeMode;
  time: string;
  source: "google_maps_transit_time";
}

export async function setVerifiedTransitTime(
  runtime: MapsBrowserRuntime,
  expectedOriginInput: string,
  expectedDestinationInput: string,
  mode: TransitTimeMode,
  requestedTimeInput: string
): Promise<TransitTimeResult> {
  const expectedOrigin = normalizedEndpoint(expectedOriginInput, "expectedOrigin");
  const expectedDestination = normalizedEndpoint(expectedDestinationInput, "expectedDestination");
  const requestedTime = normalizeTransitClockTime(requestedTimeInput);

  await assertFreshTransitRoute(runtime, expectedOrigin, expectedDestination);

  let uiMutated = false;
  try {
    const snapshot = await waitForOpen(runtime, () => {
      uiMutated = true;
    });

    await assertFreshTransitRoute(runtime, expectedOrigin, expectedDestination);
    await chooseMode(runtime, mode);

    const inputState = await prepareTimeInput(runtime, mode, snapshot);
    const displayTime = formatTransitClockForObservedInput(requestedTime, inputState.observedTime);
    const client = await runtime.getClient();
    await client.Input.insertText({ text: displayTime });
    await client.Input.dispatchKeyEvent({
      type: "keyDown",
      key: "Enter",
      code: "Enter",
      text: "\r",
      unmodifiedText: "\r",
      windowsVirtualKeyCode: 13,
      nativeVirtualKeyCode: 13
    });
    await client.Input.dispatchKeyEvent({
      type: "keyUp",
      key: "Enter",
      code: "Enter",
      windowsVirtualKeyCode: 13,
      nativeVirtualKeyCode: 13
    });

    await waitForPostcondition(runtime, mode, snapshot, displayTime);
    runtime.markSemanticMutationWithoutReplayAction();
    return {
      scheduled: true,
      origin: expectedOrigin,
      destination: expectedDestination,
      mode,
      time: requestedTime,
      source: "google_maps_transit_time"
    };
  } catch (error) {
    if (uiMutated && !runtime.getActiveIntervention()) runtime.invalidateSemanticContext();
    throw error;
  }
}
