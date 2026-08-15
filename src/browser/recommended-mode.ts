import { BrowserRuntimeError, type MapsBrowserRuntime } from "./runtime.js";
import { isFreshSimpleDirectionsUrl } from "./route-swap.js";

const RECOMMENDED_LABELS = ["Best", "おすすめ"] as const;
const UI_SETTLE_TIMEOUT_MS = 3_500;
const POLL_INTERVAL_MS = 100;
const MAX_ENDPOINT_LENGTH = 300;
const MAX_RESOLVED_ENDPOINT_LENGTH = 500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalize(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLocaleLowerCase();
}

function expectedEndpoint(value: string, name: string): string {
  const result = value.replace(/\s+/g, " ").trim();
  if (!result || result.length > MAX_ENDPOINT_LENGTH) {
    throw new BrowserRuntimeError("UI_STATE_CHANGED", `${name} is invalid or too long`);
  }
  return result;
}

async function assertFreshSimpleTransitRoute(
  runtime: MapsBrowserRuntime,
  expectedOrigin: string,
  expectedDestination: string
): Promise<void> {
  await runtime.assertDirectionsContext();
  const last = runtime.getLastAction();
  if (
    !last ||
    last.kind !== "directions" ||
    last.mode !== "transit" ||
    last.origin === undefined ||
    normalize(last.origin) !== normalize(expectedOrigin) ||
    normalize(last.destination) !== normalize(expectedDestination) ||
    (last.waypoints?.length ?? 0) !== 0 ||
    (last.avoid?.length ?? 0) !== 0
  ) {
    throw new BrowserRuntimeError(
      "UI_STATE_CHANGED",
      "The active directions request does not match the expected fresh simple transit route"
    );
  }
  const currentUrl = await runtime.currentUrl();
  if (!isFreshSimpleDirectionsUrl(currentUrl, last)) {
    throw new BrowserRuntimeError(
      "UI_STATE_CHANGED",
      "Google Maps no longer exposes the fresh documented transit route identity. Run maps_directions again before selecting Recommended."
    );
  }
}

export interface RecommendedModeSnapshot {
  originValue: string;
  destinationValue: string;
}

type PendingProbe = { state: "pending" };

export function parseRecommendedModeProbe(
  value: unknown,
  snapshot?: RecommendedModeSnapshot
): { snapshot: RecommendedModeSnapshot; checked: boolean; clicked: boolean } | PendingProbe {
  const probe = value as {
    ok?: unknown;
    reason?: unknown;
    label?: unknown;
    checked?: unknown;
    clicked?: unknown;
    originValue?: unknown;
    destinationValue?: unknown;
  } | null | undefined;
  if (
    probe?.ok === true &&
    typeof probe.label === "string" &&
    typeof probe.checked === "boolean" &&
    typeof probe.clicked === "boolean" &&
    typeof probe.originValue === "string" &&
    typeof probe.destinationValue === "string"
  ) {
    const candidate = normalize(probe.label);
    if (!RECOMMENDED_LABELS.some((label) => normalize(label) === candidate)) {
      throw new BrowserRuntimeError("UI_STATE_CHANGED", "The Google Maps Recommended travel-mode control changed");
    }
    if (
      !probe.originValue.trim() ||
      !probe.destinationValue.trim() ||
      probe.originValue.length > MAX_RESOLVED_ENDPOINT_LENGTH ||
      probe.destinationValue.length > MAX_RESOLVED_ENDPOINT_LENGTH
    ) {
      throw new BrowserRuntimeError("UI_STATE_CHANGED", "The visible route endpoints became invalid or ambiguous");
    }
    if (snapshot && (probe.originValue !== snapshot.originValue || probe.destinationValue !== snapshot.destinationValue)) {
      throw new BrowserRuntimeError("UI_STATE_CHANGED", "The visible route endpoints changed during Recommended-mode selection");
    }
    return {
      snapshot: { originValue: probe.originValue, destinationValue: probe.destinationValue },
      checked: probe.checked,
      clicked: probe.clicked
    };
  }
  if (probe?.reason === "pending") return { state: "pending" };
  if (
    probe?.reason === "ambiguous_recommended" ||
    probe?.reason === "ambiguous_origin" ||
    probe?.reason === "ambiguous_destination"
  ) {
    throw new BrowserRuntimeError("UI_STATE_CHANGED", "The Google Maps Recommended travel-mode target became ambiguous");
  }
  throw new BrowserRuntimeError("UI_ELEMENT_NOT_FOUND", "The verified Google Maps Recommended travel-mode control was not found");
}

function recommendedModeExpression(click: boolean): string {
  const labels = JSON.stringify(RECOMMENDED_LABELS.map(normalize));
  return `(() => {
    const visible=(el)=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none'};
    const clean=(value)=>String(value||'').replace(/[\\uE000-\\uF8FF]/g,'').replace(/\\s+/g,' ').trim();
    const normalize=(value)=>clean(value).toLocaleLowerCase();
    const inputs=Array.from(document.querySelectorAll('input')).filter(visible).slice(0,24);
    const origins=inputs.filter((el)=>/^(Starting point |出発地 )/.test(el.getAttribute('aria-label')||''));
    const destinations=inputs.filter((el)=>/^(Destination |目的地 )/.test(el.getAttribute('aria-label')||''));
    if (origins.length!==1) return {ok:false,reason:origins.length===0?'pending':'ambiguous_origin'};
    if (destinations.length!==1) return {ok:false,reason:destinations.length===0?'pending':'ambiguous_destination'};
    const allowed=new Set(${labels});
    const radios=Array.from(document.querySelectorAll('[role="radio"]')).filter(visible).slice(0,24)
      .filter((el)=>allowed.has(normalize(el.getAttribute('aria-label')||el.textContent||'')));
    if (radios.length===0) return {ok:false,reason:'pending'};
    if (radios.length!==1) return {ok:false,reason:'ambiguous_recommended'};
    const radio=radios[0];
    const checked=radio.getAttribute('aria-checked')==='true';
    const clicked=${click ? "!checked" : "false"};
    if (clicked) radio.click();
    return {
      ok:true,
      label:clean(radio.getAttribute('aria-label')||radio.textContent||'').slice(0,100),
      checked,
      clicked,
      originValue:clean(origins[0].value).slice(0,500),
      destinationValue:clean(destinations[0].value).slice(0,500)
    };
  })()`;
}

export interface RecommendedTravelModeResult {
  selected: true;
  origin: string;
  destination: string;
  source: "google_maps_recommended_travel_mode";
}

export async function selectVerifiedRecommendedTravelMode(
  runtime: MapsBrowserRuntime,
  expectedOriginInput: string,
  expectedDestinationInput: string
): Promise<RecommendedTravelModeResult> {
  const expectedOrigin = expectedEndpoint(expectedOriginInput, "expectedOrigin");
  const expectedDestination = expectedEndpoint(expectedDestinationInput, "expectedDestination");
  await assertFreshSimpleTransitRoute(runtime, expectedOrigin, expectedDestination);

  const client = await runtime.getClient();
  let uiMutated = false;
  try {
    let snapshot: RecommendedModeSnapshot | undefined;
    const actionDeadline = Date.now() + UI_SETTLE_TIMEOUT_MS;
    while (Date.now() < actionDeadline) {
      await assertFreshSimpleTransitRoute(runtime, expectedOrigin, expectedDestination);
      const evaluated = await client.Runtime.evaluate({ expression: recommendedModeExpression(true), returnByValue: true, awaitPromise: true });
      const rawAction = evaluated.result.value as { clicked?: unknown } | undefined;
      if (rawAction?.clicked === true) uiMutated = true;
      const parsed = parseRecommendedModeProbe(evaluated.result.value);
      if (!("state" in parsed)) {
        snapshot = parsed.snapshot;
        if (parsed.clicked) uiMutated = true;
        if (parsed.checked || parsed.clicked) break;
      }
      await sleep(POLL_INTERVAL_MS);
    }
    if (!snapshot) {
      throw new BrowserRuntimeError("UI_ELEMENT_NOT_FOUND", "The verified Google Maps Recommended travel-mode control did not become available");
    }

    const postDeadline = Date.now() + UI_SETTLE_TIMEOUT_MS;
    while (Date.now() < postDeadline) {
      const currentUrl = await runtime.assertMapsSurface();
      if (!new URL(currentUrl).pathname.startsWith("/maps/dir/")) {
        throw new BrowserRuntimeError("UI_STATE_CHANGED", "Google Maps left the directions view after selecting Recommended travel mode");
      }
      const evaluated = await client.Runtime.evaluate({ expression: recommendedModeExpression(false), returnByValue: true, awaitPromise: true });
      const parsed = parseRecommendedModeProbe(evaluated.result.value, snapshot);
      if (!("state" in parsed) && parsed.checked) {
        runtime.markSemanticMutationWithoutReplayAction();
        return {
          selected: true,
          origin: expectedOrigin,
          destination: expectedDestination,
          source: "google_maps_recommended_travel_mode"
        };
      }
      await sleep(POLL_INTERVAL_MS);
    }
    throw new BrowserRuntimeError("UI_STATE_CHANGED", "Google Maps did not verify Recommended travel mode as selected");
  } catch (error) {
    if (uiMutated && !runtime.getActiveIntervention()) runtime.invalidateSemanticContext();
    throw error;
  }
}
