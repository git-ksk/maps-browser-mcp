import { validateMapsShareUrl } from "./place-share.js";
import { BrowserRuntimeError, type MapsBrowserRuntime } from "./runtime.js";

const SHARE_BUTTON_LABELS = ["Share", "共有"] as const;
const SEND_LINK_TAB_LABELS = ["Send a link", "リンクを送信する"] as const;
const CLOSE_BUTTON_LABELS = ["Close", "閉じる"] as const;
const UI_SETTLE_TIMEOUT_MS = 3_500;
const POLL_INTERVAL_MS = 100;
const MAX_QUERY_LENGTH = 500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalize(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLocaleLowerCase();
}

export function normalizeExpectedSearchQuery(value: string): string {
  const result = value.replace(/\s+/g, " ").trim();
  if (!result || result.length > MAX_QUERY_LENGTH) {
    throw new BrowserRuntimeError("UI_STATE_CHANGED", "expectedQuery must contain 1 to 500 characters");
  }
  return result;
}

async function assertActiveSearch(runtime: MapsBrowserRuntime, expectedQuery: string): Promise<void> {
  await runtime.assertReadableView("place");
  if (runtime.getViewState() !== "search") {
    throw new BrowserRuntimeError(
      "UI_STATE_CHANGED",
      "A Google Maps search result view is not active. Run maps_search again before sharing the search."
    );
  }
  const last = runtime.getLastAction();
  if (!last || last.kind !== "search" || normalize(last.query) !== normalize(expectedQuery)) {
    throw new BrowserRuntimeError(
      "UI_STATE_CHANGED",
      "The active Google Maps search no longer matches expectedQuery"
    );
  }
}

type PendingProbe = { state: "pending" };

export function parseSearchShareOpenProbe(value: unknown, expectedQuery: string): "ready" | PendingProbe {
  const probe = value as {
    ok?: unknown;
    reason?: unknown;
    query?: unknown;
    label?: unknown;
  } | null | undefined;
  if (probe?.ok === true && typeof probe.query === "string" && typeof probe.label === "string") {
    if (normalize(probe.query) !== normalize(expectedQuery)) {
      throw new BrowserRuntimeError("UI_STATE_CHANGED", "The visible Google Maps search query changed before sharing");
    }
    const candidate = normalize(probe.label);
    if (!SHARE_BUTTON_LABELS.some((label) => normalize(label) === candidate)) {
      throw new BrowserRuntimeError("UI_STATE_CHANGED", "The Google Maps search Share control changed before activation");
    }
    return "ready";
  }
  if (probe?.reason === "pending") return { state: "pending" };
  if (
    probe?.reason === "changed_query" ||
    probe?.reason === "ambiguous_query" ||
    probe?.reason === "ambiguous_share"
  ) {
    throw new BrowserRuntimeError("UI_STATE_CHANGED", "The Google Maps search/share target became stale or ambiguous");
  }
  throw new BrowserRuntimeError("UI_ELEMENT_NOT_FOUND", "The verified Google Maps search Share control was not found");
}

export function parseSearchShareLinkProbe(value: unknown): string | undefined {
  const probe = value as {
    ok?: unknown;
    reason?: unknown;
    url?: unknown;
    tabLabel?: unknown;
    tabSelected?: unknown;
  } | null | undefined;

  if (probe?.ok === true && probe.tabSelected !== true) {
    throw new BrowserRuntimeError("UI_STATE_CHANGED", "The Google Maps search-share Send-link tab is not selected");
  }
  if (
    probe?.ok === true &&
    typeof probe.url === "string" &&
    typeof probe.tabLabel === "string" &&
    probe.tabSelected === true
  ) {
    const candidate = normalize(probe.tabLabel);
    if (!SEND_LINK_TAB_LABELS.some((label) => normalize(label) === candidate)) {
      throw new BrowserRuntimeError("UI_STATE_CHANGED", "The Google Maps search-share dialog changed to an unobserved tab");
    }
    return validateMapsShareUrl(probe.url);
  }
  if (probe?.reason === "pending") return undefined;
  if (
    probe?.reason === "changed_query" ||
    probe?.reason === "ambiguous_query" ||
    probe?.reason === "ambiguous_dialog" ||
    probe?.reason === "ambiguous_tab" ||
    probe?.reason === "wrong_tab" ||
    probe?.reason === "ambiguous_link"
  ) {
    throw new BrowserRuntimeError("UI_STATE_CHANGED", "The Google Maps search-share dialog became stale or ambiguous");
  }
  return undefined;
}

export function parseSearchShareCloseProbe(value: unknown): "ready" | PendingProbe {
  const probe = value as { ok?: unknown; reason?: unknown; label?: unknown } | null | undefined;
  if (probe?.ok === true && typeof probe.label === "string") {
    const candidate = normalize(probe.label);
    if (!CLOSE_BUTTON_LABELS.some((label) => normalize(label) === candidate)) {
      throw new BrowserRuntimeError("UI_STATE_CHANGED", "The Google Maps search-share Close control changed before activation");
    }
    return "ready";
  }
  if (probe?.reason === "closed") return "ready";
  if (probe?.reason === "pending") return { state: "pending" };
  if (probe?.reason === "ambiguous_dialog" || probe?.reason === "ambiguous_close") {
    throw new BrowserRuntimeError("UI_STATE_CHANGED", "The Google Maps search-share close target became ambiguous");
  }
  return { state: "pending" };
}

function queryPrelude(expectedQuery: string): string {
  const expected = JSON.stringify(normalize(expectedQuery));
  return `
    const queryBoxes = Array.from(document.querySelectorAll('[role="combobox"]')).filter(visible).slice(0, 12);
    if (queryBoxes.length === 0) return { ok:false, reason:'pending' };
    if (queryBoxes.length !== 1) return { ok:false, reason:'ambiguous_query' };
    const query = clean(queryBoxes[0].value || queryBoxes[0].textContent || '').slice(0, 500);
    if (normalize(query) !== ${expected}) return { ok:false, reason:'changed_query' };
  `;
}

function openSearchShareExpression(expectedQuery: string): string {
  const labels = JSON.stringify(SHARE_BUTTON_LABELS.map(normalize));
  return `(() => {
    const visible=(el)=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none'};
    const clean=(value)=>String(value||'').replace(/[\\uE000-\\uF8FF]/g,'').replace(/\\s+/g,' ').trim();
    const normalize=(value)=>clean(value).toLocaleLowerCase();
    ${queryPrelude(expectedQuery)}
    const allowed=new Set(${labels});
    const shares=Array.from(document.querySelectorAll('button,[role="button"]')).filter(visible).slice(0,180)
      .filter((el)=>allowed.has(normalize(el.getAttribute('aria-label')||el.textContent||'')));
    if (shares.length===0) return {ok:false,reason:'pending'};
    if (shares.length!==1) return {ok:false,reason:'ambiguous_share'};
    const label=clean(shares[0].getAttribute('aria-label')||shares[0].textContent||'').slice(0,100);
    shares[0].click();
    return {ok:true,query,label};
  })()`;
}

function readSearchShareExpression(expectedQuery: string): string {
  const tabLabels = JSON.stringify(SEND_LINK_TAB_LABELS.map(normalize));
  return `(() => {
    const visible=(el)=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none'};
    const clean=(value)=>String(value||'').replace(/[\\uE000-\\uF8FF]/g,'').replace(/\\s+/g,' ').trim();
    const normalize=(value)=>clean(value).toLocaleLowerCase();
    ${queryPrelude(expectedQuery)}
    const safe=(value)=>{try{const u=new URL(value);return u.protocol==='https:'&&(u.hostname==='maps.app.goo.gl'||(u.hostname==='www.google.com'&&(u.pathname==='/maps'||u.pathname.startsWith('/maps/'))));}catch{return false;}};
    const dialogs=Array.from(document.querySelectorAll('[role="dialog"]')).filter(visible).slice(0,8);
    if (dialogs.length===0) return {ok:false,reason:'pending'};
    if (dialogs.length!==1) return {ok:false,reason:'ambiguous_dialog'};
    const dialog=dialogs[0];
    const allowedTabs=new Set(${tabLabels});
    const tabs=Array.from(dialog.querySelectorAll('[role="tab"]')).filter(visible).slice(0,12)
      .filter((el)=>allowedTabs.has(normalize(el.getAttribute('aria-label')||el.textContent||'')));
    if (tabs.length===0) return {ok:false,reason:'pending'};
    if (tabs.length!==1) return {ok:false,reason:'ambiguous_tab'};
    const tabLabel=clean(tabs[0].getAttribute('aria-label')||tabs[0].textContent||'').slice(0,100);
    if (tabs[0].getAttribute('aria-selected')!=='true') return {ok:false,reason:'wrong_tab'};
    const fields=Array.from(dialog.querySelectorAll('input,textarea,[role="textbox"]')).filter(visible).slice(0,16);
    const urls=[]; const seen=new Set();
    for (const field of fields) {
      const value=String(field.value||field.textContent||'').trim().slice(0,2048);
      if (!safe(value)||seen.has(value)) continue;
      seen.add(value); urls.push(value);
      if (urls.length>1) return {ok:false,reason:'ambiguous_link'};
    }
    return urls.length===1 ? {ok:true,url:urls[0],tabLabel,tabSelected:true} : {ok:false,reason:'pending'};
  })()`;
}

function closeSearchShareExpression(): string {
  const tabLabels = JSON.stringify(SEND_LINK_TAB_LABELS.map(normalize));
  const closeLabels = JSON.stringify(CLOSE_BUTTON_LABELS.map(normalize));
  return `(() => {
    const visible=(el)=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none'};
    const clean=(value)=>String(value||'').replace(/[\\uE000-\\uF8FF]/g,'').replace(/\\s+/g,' ').trim();
    const normalize=(value)=>clean(value).toLocaleLowerCase();
    const tabsAllowed=new Set(${tabLabels});
    const dialogs=Array.from(document.querySelectorAll('[role="dialog"]')).filter(visible).slice(0,8)
      .filter((dialog)=>Array.from(dialog.querySelectorAll('[role="tab"]')).filter(visible)
        .some((el)=>tabsAllowed.has(normalize(el.getAttribute('aria-label')||el.textContent||''))));
    if (dialogs.length===0) return {ok:false,reason:'closed'};
    if (dialogs.length!==1) return {ok:false,reason:'ambiguous_dialog'};
    const allowed=new Set(${closeLabels});
    const buttons=Array.from(dialogs[0].querySelectorAll('button,[role="button"]')).filter(visible).slice(0,60)
      .filter((el)=>allowed.has(normalize(el.getAttribute('aria-label')||el.textContent||'')));
    if (buttons.length===0) return {ok:false,reason:'pending'};
    if (buttons.length!==1) return {ok:false,reason:'ambiguous_close'};
    const label=clean(buttons[0].getAttribute('aria-label')||buttons[0].textContent||'').slice(0,100);
    buttons[0].click(); return {ok:true,label};
  })()`;
}

function searchShareDialogStateExpression(): string {
  const tabLabels = JSON.stringify(SEND_LINK_TAB_LABELS.map(normalize));
  return `(() => {
    const visible=(el)=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none'};
    const clean=(value)=>String(value||'').replace(/[\\uE000-\\uF8FF]/g,'').replace(/\\s+/g,' ').trim();
    const normalize=(value)=>clean(value).toLocaleLowerCase();
    const allowed=new Set(${tabLabels});
    const dialogs=Array.from(document.querySelectorAll('[role="dialog"]')).filter(visible).slice(0,8)
      .filter((dialog)=>Array.from(dialog.querySelectorAll('[role="tab"]')).filter(visible)
        .some((el)=>allowed.has(normalize(el.getAttribute('aria-label')||el.textContent||''))));
    return { count: dialogs.length };
  })()`;
}

async function closeSearchShareDialog(runtime: MapsBrowserRuntime, expectedQuery: string): Promise<void> {
  const client = await runtime.getClient();
  const deadline = Date.now() + UI_SETTLE_TIMEOUT_MS;
  let clicked = false;
  while (Date.now() < deadline) {
    await assertActiveSearch(runtime, expectedQuery);
    if (!clicked) {
      const evaluated = await client.Runtime.evaluate({ expression: closeSearchShareExpression(), returnByValue: true, awaitPromise: true });
      const parsed = parseSearchShareCloseProbe(evaluated.result.value);
      const raw = evaluated.result.value as { reason?: unknown } | undefined;
      if (raw?.reason === "closed") return;
      if (parsed === "ready") clicked = true;
    } else {
      const verify = await client.Runtime.evaluate({ expression: searchShareDialogStateExpression(), returnByValue: true, awaitPromise: true });
      const state = verify.result.value as { count?: unknown } | undefined;
      if (state?.count === 0) return;
      if (typeof state?.count === "number" && state.count > 1) {
        throw new BrowserRuntimeError("UI_STATE_CHANGED", "Google Maps search-share dialog close verification became ambiguous");
      }
    }
    await sleep(POLL_INTERVAL_MS);
  }
  throw new BrowserRuntimeError("UI_STATE_CHANGED", "Google Maps search-share dialog did not close cleanly");
}

export interface SearchShareLinkResult {
  query: string;
  url: string;
  source: "google_maps_search_share_dialog";
}

export async function getVerifiedSearchShareLink(
  runtime: MapsBrowserRuntime,
  expectedQueryInput: string
): Promise<SearchShareLinkResult> {
  const expectedQuery = normalizeExpectedSearchQuery(expectedQueryInput);
  await assertActiveSearch(runtime, expectedQuery);
  const client = await runtime.getClient();
  let opened = false;
  try {
    const openDeadline = Date.now() + UI_SETTLE_TIMEOUT_MS;
    while (Date.now() < openDeadline) {
      await assertActiveSearch(runtime, expectedQuery);
      const evaluated = await client.Runtime.evaluate({ expression: openSearchShareExpression(expectedQuery), returnByValue: true, awaitPromise: true });
      const raw = evaluated.result.value as { ok?: unknown } | undefined;
      if (raw?.ok === true) opened = true;
      const parsed = parseSearchShareOpenProbe(evaluated.result.value, expectedQuery);
      if (parsed === "ready") break;
      await sleep(POLL_INTERVAL_MS);
    }
    if (!opened) {
      throw new BrowserRuntimeError("UI_ELEMENT_NOT_FOUND", "The verified Google Maps search Share control did not become available");
    }

    const readDeadline = Date.now() + UI_SETTLE_TIMEOUT_MS;
    while (Date.now() < readDeadline) {
      await assertActiveSearch(runtime, expectedQuery);
      const evaluated = await client.Runtime.evaluate({ expression: readSearchShareExpression(expectedQuery), returnByValue: true, awaitPromise: true });
      const url = parseSearchShareLinkProbe(evaluated.result.value);
      if (url) {
        await closeSearchShareDialog(runtime, expectedQuery);
        opened = false;
        await assertActiveSearch(runtime, expectedQuery);
        return { query: expectedQuery, url, source: "google_maps_search_share_dialog" };
      }
      await sleep(POLL_INTERVAL_MS);
    }
    throw new BrowserRuntimeError("UI_ELEMENT_NOT_FOUND", "Google Maps did not expose a bounded share link for the verified search result view");
  } catch (error) {
    if (opened && !runtime.getActiveIntervention()) {
      try {
        await closeSearchShareDialog(runtime, expectedQuery);
      } catch {
        runtime.invalidateSemanticContext();
      }
    }
    throw error;
  }
}
