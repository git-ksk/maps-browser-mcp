import { validateMapsShareUrl } from "./place-share.js";
import { BrowserRuntimeError, type MapsBrowserRuntime } from "./runtime.js";

const SHARE_BUTTON_LABELS = ["Share directions", "ルートを共有"] as const;
const SEND_LINK_TAB_LABELS = ["Send a link", "リンクを送信する"] as const;
const CLOSE_BUTTON_LABELS = ["Close", "閉じる"] as const;
const UI_SETTLE_TIMEOUT_MS = 3_500;
const POLL_INTERVAL_MS = 100;
const MAX_ENDPOINT_LENGTH = 300;

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

async function assertSelectedTransitRoute(
  runtime: MapsBrowserRuntime,
  expectedOrigin: string,
  expectedDestination: string
): Promise<void> {
  await runtime.assertDirectionsContext();
  if (runtime.getViewState() !== "route") {
    throw new BrowserRuntimeError(
      "UI_STATE_CHANGED",
      "A selected route detail view is not active. Read the current route candidates and select the intended route first."
    );
  }
  const last = runtime.getLastAction();
  if (
    !last ||
    last.kind !== "directions" ||
    last.mode !== "transit" ||
    last.origin === undefined ||
    (last.waypoints?.length ?? 0) !== 0 ||
    (last.avoid?.length ?? 0) !== 0 ||
    normalize(last.origin) !== normalize(expectedOrigin) ||
    normalize(last.destination) !== normalize(expectedDestination)
  ) {
    throw new BrowserRuntimeError(
      "UI_STATE_CHANGED",
      "The selected Google Maps route no longer matches the expected simple transit directions identity"
    );
  }
}

type PendingProbe = { state: "pending" };

export function parseRouteShareOpenProbe(value: unknown): "ready" | PendingProbe {
  const probe = value as { ok?: unknown; reason?: unknown; label?: unknown } | null | undefined;
  if (probe?.ok === true && typeof probe.label === "string") {
    const candidate = normalize(probe.label);
    if (!SHARE_BUTTON_LABELS.some((label) => normalize(label) === candidate)) {
      throw new BrowserRuntimeError("UI_STATE_CHANGED", "The Google Maps selected-route share control changed before activation");
    }
    return "ready";
  }
  if (probe?.reason === "pending") return { state: "pending" };
  if (probe?.reason === "ambiguous_share") {
    throw new BrowserRuntimeError("UI_STATE_CHANGED", "The selected-route share control became ambiguous; refusing to guess");
  }
  throw new BrowserRuntimeError("UI_ELEMENT_NOT_FOUND", "The verified Google Maps Share directions control was not found");
}

export function parseRouteShareLinkProbe(value: unknown): string | undefined {
  const probe = value as {
    ok?: unknown;
    reason?: unknown;
    url?: unknown;
    tabLabel?: unknown;
    tabSelected?: unknown;
  } | null | undefined;

  if (probe?.ok === true && probe.tabSelected !== true) {
    throw new BrowserRuntimeError(
      "UI_STATE_CHANGED",
      "The Google Maps route-share Send-link tab is not selected"
    );
  }

  if (
    probe?.ok === true &&
    typeof probe.url === "string" &&
    typeof probe.tabLabel === "string" &&
    probe.tabSelected === true
  ) {
    const candidate = normalize(probe.tabLabel);
    if (!SEND_LINK_TAB_LABELS.some((label) => normalize(label) === candidate)) {
      throw new BrowserRuntimeError("UI_STATE_CHANGED", "The Google Maps route-share dialog changed to an unobserved tab");
    }
    return validateMapsShareUrl(probe.url);
  }
  if (probe?.reason === "pending") return undefined;
  if (
    probe?.reason === "ambiguous_dialog" ||
    probe?.reason === "ambiguous_tab" ||
    probe?.reason === "wrong_tab" ||
    probe?.reason === "ambiguous_link"
  ) {
    throw new BrowserRuntimeError("UI_STATE_CHANGED", "The Google Maps route-share dialog became stale or ambiguous; refusing to guess");
  }
  return undefined;
}

export function parseRouteShareCloseProbe(value: unknown): "ready" | PendingProbe {
  const probe = value as { ok?: unknown; reason?: unknown; label?: unknown } | null | undefined;
  if (probe?.ok === true && typeof probe.label === "string") {
    const candidate = normalize(probe.label);
    if (!CLOSE_BUTTON_LABELS.some((label) => normalize(label) === candidate)) {
      throw new BrowserRuntimeError("UI_STATE_CHANGED", "The Google Maps route-share Close control changed before activation");
    }
    return "ready";
  }
  if (probe?.reason === "closed") return "ready";
  if (probe?.reason === "pending") return { state: "pending" };
  if (probe?.reason === "ambiguous_dialog" || probe?.reason === "ambiguous_close") {
    throw new BrowserRuntimeError("UI_STATE_CHANGED", "The Google Maps route-share dialog close target became ambiguous");
  }
  return { state: "pending" };
}

function openRouteShareExpression(): string {
  const labels = JSON.stringify(SHARE_BUTTON_LABELS.map(normalize));
  return `(() => {
    const visible = (el) => { const r=el.getBoundingClientRect(); const s=getComputedStyle(el); return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none'; };
    const clean = (value) => String(value || '').replace(/[\\uE000-\\uF8FF]/g, '').replace(/\\s+/g, ' ').trim();
    const normalize = (value) => clean(value).toLocaleLowerCase();
    const allowed = new Set(${labels});
    const buttons = Array.from(document.querySelectorAll('button, [role="button"]')).filter(visible).slice(0, 180)
      .filter((el) => allowed.has(normalize(el.getAttribute('aria-label') || el.textContent || '')));
    if (buttons.length === 0) return { ok:false, reason:'pending' };
    if (buttons.length !== 1) return { ok:false, reason:'ambiguous_share' };
    const label = clean(buttons[0].getAttribute('aria-label') || buttons[0].textContent || '').slice(0, 100);
    buttons[0].click();
    return { ok:true, label };
  })()`;
}

function readRouteShareExpression(): string {
  const tabLabels = JSON.stringify(SEND_LINK_TAB_LABELS.map(normalize));
  return `(() => {
    const visible = (el) => { const r=el.getBoundingClientRect(); const s=getComputedStyle(el); return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none'; };
    const clean = (value) => String(value || '').replace(/[\\uE000-\\uF8FF]/g, '').replace(/\\s+/g, ' ').trim();
    const normalize = (value) => clean(value).toLocaleLowerCase();
    const safe = (value) => {
      try {
        const url = new URL(value);
        return url.protocol === 'https:' && (
          url.hostname === 'maps.app.goo.gl' ||
          (url.hostname === 'www.google.com' && (url.pathname === '/maps' || url.pathname.startsWith('/maps/')))
        );
      } catch { return false; }
    };
    const dialogs = Array.from(document.querySelectorAll('[role="dialog"]')).filter(visible).slice(0, 8);
    if (dialogs.length === 0) return { ok:false, reason:'pending' };
    if (dialogs.length !== 1) return { ok:false, reason:'ambiguous_dialog' };
    const dialog = dialogs[0];
    const allowedTabs = new Set(${tabLabels});
    const tabs = Array.from(dialog.querySelectorAll('[role="tab"]')).filter(visible).slice(0, 12)
      .filter((el) => allowedTabs.has(normalize(el.getAttribute('aria-label') || el.textContent || '')));
    if (tabs.length === 0) return { ok:false, reason:'pending' };
    if (tabs.length !== 1) return { ok:false, reason:'ambiguous_tab' };
    const tabLabel = clean(tabs[0].getAttribute('aria-label') || tabs[0].textContent || '').slice(0, 100);
    if (tabs[0].getAttribute('aria-selected') !== 'true') return { ok:false, reason:'wrong_tab' };
    const fields = Array.from(dialog.querySelectorAll('input, textarea, [role="textbox"]')).filter(visible).slice(0, 16);
    const urls = [];
    const seen = new Set();
    for (const field of fields) {
      const value = String(field.value || field.textContent || '').trim().slice(0, 2048);
      if (!safe(value) || seen.has(value)) continue;
      seen.add(value);
      urls.push(value);
      if (urls.length > 1) return { ok:false, reason:'ambiguous_link' };
    }
    return urls.length === 1
      ? { ok:true, url:urls[0], tabLabel, tabSelected:true }
      : { ok:false, reason:'pending' };
  })()`;
}

function closeRouteShareExpression(): string {
  const labels = JSON.stringify(CLOSE_BUTTON_LABELS.map(normalize));
  return `(() => {
    const visible = (el) => { const r=el.getBoundingClientRect(); const s=getComputedStyle(el); return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none'; };
    const clean = (value) => String(value || '').replace(/[\\uE000-\\uF8FF]/g, '').replace(/\\s+/g, ' ').trim();
    const normalize = (value) => clean(value).toLocaleLowerCase();
    const dialogs = Array.from(document.querySelectorAll('[role="dialog"]')).filter(visible).slice(0, 8);
    if (dialogs.length === 0) return { ok:false, reason:'closed' };
    if (dialogs.length !== 1) return { ok:false, reason:'ambiguous_dialog' };
    const allowed = new Set(${labels});
    const buttons = Array.from(dialogs[0].querySelectorAll('button, [role="button"]')).filter(visible).slice(0, 60)
      .filter((el) => allowed.has(normalize(el.getAttribute('aria-label') || el.textContent || '')));
    if (buttons.length === 0) return { ok:false, reason:'pending' };
    if (buttons.length !== 1) return { ok:false, reason:'ambiguous_close' };
    const label = clean(buttons[0].getAttribute('aria-label') || buttons[0].textContent || '').slice(0, 100);
    buttons[0].click();
    return { ok:true, label };
  })()`;
}

async function closeRouteShareDialog(runtime: MapsBrowserRuntime): Promise<void> {
  const client = await runtime.getClient();
  const deadline = Date.now() + UI_SETTLE_TIMEOUT_MS;
  let clicked = false;
  while (Date.now() < deadline) {
    await runtime.assertDirectionsContext();
    const evaluated = await client.Runtime.evaluate({ expression: closeRouteShareExpression(), returnByValue: true, awaitPromise: true });
    const parsed = parseRouteShareCloseProbe(evaluated.result.value);
    if (parsed === "ready") {
      const raw = evaluated.result.value as { reason?: unknown } | undefined;
      if (raw?.reason === "closed") return;
      clicked = true;
    }
    if (clicked) {
      await sleep(POLL_INTERVAL_MS);
      const verify = await client.Runtime.evaluate({
        expression: `(() => { const visible=(el)=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none'}; return Array.from(document.querySelectorAll('[role="dialog"]')).filter(visible).length; })()`,
        returnByValue: true,
        awaitPromise: true
      });
      if (verify.result.value === 0) return;
    }
    await sleep(POLL_INTERVAL_MS);
  }
  throw new BrowserRuntimeError("UI_STATE_CHANGED", "Google Maps route-share dialog did not close cleanly");
}

export interface RouteShareLinkResult {
  origin: string;
  destination: string;
  mode: "transit";
  url: string;
  source: "google_maps_route_share_dialog";
}

export async function getVerifiedRouteShareLink(
  runtime: MapsBrowserRuntime,
  expectedOriginInput: string,
  expectedDestinationInput: string
): Promise<RouteShareLinkResult> {
  const expectedOrigin = expectedEndpoint(expectedOriginInput, "expectedOrigin");
  const expectedDestination = expectedEndpoint(expectedDestinationInput, "expectedDestination");
  await assertSelectedTransitRoute(runtime, expectedOrigin, expectedDestination);

  const client = await runtime.getClient();
  let opened = false;
  try {
    const openDeadline = Date.now() + UI_SETTLE_TIMEOUT_MS;
    while (Date.now() < openDeadline) {
      await assertSelectedTransitRoute(runtime, expectedOrigin, expectedDestination);
      const evaluated = await client.Runtime.evaluate({ expression: openRouteShareExpression(), returnByValue: true, awaitPromise: true });
      const raw = evaluated.result.value as { ok?: unknown } | undefined;
      if (raw?.ok === true) opened = true;
      const parsed = parseRouteShareOpenProbe(evaluated.result.value);
      if (parsed === "ready") break;
      await sleep(POLL_INTERVAL_MS);
    }
    if (!opened) {
      throw new BrowserRuntimeError("UI_ELEMENT_NOT_FOUND", "The verified Google Maps Share directions control did not become available");
    }

    const readDeadline = Date.now() + UI_SETTLE_TIMEOUT_MS;
    while (Date.now() < readDeadline) {
      await assertSelectedTransitRoute(runtime, expectedOrigin, expectedDestination);
      const evaluated = await client.Runtime.evaluate({ expression: readRouteShareExpression(), returnByValue: true, awaitPromise: true });
      const url = parseRouteShareLinkProbe(evaluated.result.value);
      if (url) {
        await closeRouteShareDialog(runtime);
        opened = false;
        await assertSelectedTransitRoute(runtime, expectedOrigin, expectedDestination);
        return {
          origin: expectedOrigin,
          destination: expectedDestination,
          mode: "transit",
          url,
          source: "google_maps_route_share_dialog"
        };
      }
      await sleep(POLL_INTERVAL_MS);
    }
    throw new BrowserRuntimeError("UI_ELEMENT_NOT_FOUND", "Google Maps did not expose a bounded share link for the verified selected transit route");
  } catch (error) {
    if (opened && !runtime.getActiveIntervention()) {
      try {
        await closeRouteShareDialog(runtime);
      } catch {
        runtime.invalidateSemanticContext();
      }
    }
    throw error;
  }
}
