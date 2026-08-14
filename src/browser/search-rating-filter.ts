import { BrowserRuntimeError, type MapsBrowserRuntime } from "./runtime.js";

export const SEARCH_RATING_OPTIONS = ["2.0", "2.5", "3.0", "3.5", "4.0", "4.5"] as const;
export type SearchRating = (typeof SEARCH_RATING_OPTIONS)[number];

const RATING_FILTER_LABELS = ["Rating", "評価"] as const;
const UI_SETTLE_TIMEOUT_MS = 3_500;
const POLL_INTERVAL_MS = 100;

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

export function normalizeExpectedSearchQuery(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized || normalized.length > 500) {
    throw new BrowserRuntimeError("UI_STATE_CHANGED", "Expected search query is invalid or too long");
  }
  return normalized;
}

function requestedChipLabel(rating: SearchRating): string {
  return `${rating}+`;
}

function observedTriggerLabels(): string[] {
  return [
    ...RATING_FILTER_LABELS,
    ...SEARCH_RATING_OPTIONS.map((rating) => requestedChipLabel(rating))
  ];
}

function observedTriggerLabel(value: string): boolean {
  const normalized = normalize(value);
  return observedTriggerLabels().some((label) => normalize(label) === normalized);
}

function observedMenuLabel(value: string): boolean {
  const normalized = normalize(value);
  return RATING_FILTER_LABELS.some((label) => normalize(label) === normalized);
}

type PendingProbe = { state: "pending" };

export type RatingTriggerAction = {
  state: "ready";
  triggerLabel: string;
  alreadyApplied: boolean;
};

export function parseRatingTriggerActionProbe(
  value: unknown,
  expectedQuery: string,
  rating: SearchRating
): RatingTriggerAction | PendingProbe {
  const probe = value as {
    ok?: unknown;
    reason?: unknown;
    queryValue?: unknown;
    triggerLabel?: unknown;
    alreadyApplied?: unknown;
  } | null | undefined;

  if (
    probe?.ok === true &&
    typeof probe.queryValue === "string" &&
    typeof probe.triggerLabel === "string" &&
    typeof probe.alreadyApplied === "boolean"
  ) {
    const shouldBeApplied = normalize(probe.triggerLabel) === normalize(requestedChipLabel(rating));
    if (
      normalize(probe.queryValue) !== normalize(expectedQuery) ||
      !observedTriggerLabel(probe.triggerLabel) ||
      probe.alreadyApplied !== shouldBeApplied
    ) {
      throw new BrowserRuntimeError(
        "UI_STATE_CHANGED",
        "The Google Maps search query or Rating filter changed immediately before the action"
      );
    }
    return {
      state: "ready",
      triggerLabel: probe.triggerLabel,
      alreadyApplied: probe.alreadyApplied
    };
  }

  if (probe?.reason === "pending") return { state: "pending" };
  if (
    probe?.reason === "ambiguous_query" ||
    probe?.reason === "ambiguous_filter" ||
    probe?.reason === "ambiguous_menu" ||
    probe?.reason === "menu_open" ||
    probe?.reason === "changed_query" ||
    probe?.reason === "changed_filter"
  ) {
    throw new BrowserRuntimeError(
      "UI_STATE_CHANGED",
      "The Google Maps search query or Rating filter became stale or ambiguous; refusing to guess"
    );
  }

  throw new BrowserRuntimeError("UI_ELEMENT_NOT_FOUND", "The verified Google Maps Rating filter was not found");
}

export type RatingMenuState = {
  state: "ready";
  requestedChecked: boolean;
  checkedCount: number;
};

export function parseRatingMenuProbe(
  value: unknown,
  expectedQuery: string,
  rating: SearchRating
): RatingMenuState | PendingProbe {
  const probe = value as {
    ok?: unknown;
    reason?: unknown;
    queryValue?: unknown;
    menuLabel?: unknown;
    optionLabel?: unknown;
    requestedChecked?: unknown;
    checkedCount?: unknown;
  } | null | undefined;

  if (
    probe?.ok === true &&
    typeof probe.queryValue === "string" &&
    typeof probe.menuLabel === "string" &&
    typeof probe.optionLabel === "string" &&
    typeof probe.requestedChecked === "boolean" &&
    typeof probe.checkedCount === "number"
  ) {
    if (
      normalize(probe.queryValue) !== normalize(expectedQuery) ||
      !observedMenuLabel(probe.menuLabel) ||
      probe.optionLabel !== rating ||
      !Number.isInteger(probe.checkedCount) ||
      probe.checkedCount < 0 ||
      probe.checkedCount > 1
    ) {
      throw new BrowserRuntimeError("UI_STATE_CHANGED", "The Google Maps Rating menu changed or became ambiguous");
    }
    return {
      state: "ready",
      requestedChecked: probe.requestedChecked,
      checkedCount: probe.checkedCount
    };
  }

  if (probe?.reason === "pending") return { state: "pending" };
  if (probe?.reason === "missing_option") {
    throw new BrowserRuntimeError("UI_ELEMENT_NOT_FOUND", `The observed Google Maps rating option ${rating} was not found`);
  }
  if (
    probe?.reason === "changed_query" ||
    probe?.reason === "ambiguous_query" ||
    probe?.reason === "ambiguous_menu" ||
    probe?.reason === "ambiguous_option" ||
    probe?.reason === "changed_menu"
  ) {
    throw new BrowserRuntimeError("UI_STATE_CHANGED", "The Google Maps search query or Rating menu became stale or ambiguous");
  }

  throw new BrowserRuntimeError("UI_ELEMENT_NOT_FOUND", "The verified Google Maps Rating menu was not found");
}

export function parseRatingOptionActionProbe(
  value: unknown,
  expectedQuery: string,
  rating: SearchRating
): { state: "ready" } | PendingProbe {
  const probe = value as {
    ok?: unknown;
    reason?: unknown;
    queryValue?: unknown;
    menuLabel?: unknown;
    optionLabel?: unknown;
  } | null | undefined;

  if (
    probe?.ok === true &&
    typeof probe.queryValue === "string" &&
    typeof probe.menuLabel === "string" &&
    typeof probe.optionLabel === "string"
  ) {
    if (
      normalize(probe.queryValue) !== normalize(expectedQuery) ||
      !observedMenuLabel(probe.menuLabel) ||
      probe.optionLabel !== rating
    ) {
      throw new BrowserRuntimeError("UI_STATE_CHANGED", "The Google Maps Rating target changed before selection");
    }
    return { state: "ready" };
  }

  if (probe?.reason === "pending") return { state: "pending" };
  if (probe?.reason === "missing_option") {
    throw new BrowserRuntimeError("UI_ELEMENT_NOT_FOUND", `The observed Google Maps rating option ${rating} was not found`);
  }
  throw new BrowserRuntimeError(
    "UI_STATE_CHANGED",
    "The Google Maps search query, Rating menu, or rating option changed before selection"
  );
}

export function parseRatingAppliedChipProbe(
  value: unknown,
  expectedQuery: string,
  rating: SearchRating
): boolean {
  const probe = value as {
    ok?: unknown;
    reason?: unknown;
    queryValue?: unknown;
    triggerLabel?: unknown;
    menuCount?: unknown;
  } | null | undefined;

  if (
    probe?.ok === true &&
    typeof probe.queryValue === "string" &&
    typeof probe.triggerLabel === "string" &&
    typeof probe.menuCount === "number"
  ) {
    if (
      normalize(probe.queryValue) !== normalize(expectedQuery) ||
      !observedTriggerLabel(probe.triggerLabel) ||
      !Number.isInteger(probe.menuCount) ||
      probe.menuCount < 0 ||
      probe.menuCount > 1
    ) {
      throw new BrowserRuntimeError("UI_STATE_CHANGED", "The Google Maps search/Rating postcondition became ambiguous");
    }
    return normalize(probe.triggerLabel) === normalize(requestedChipLabel(rating)) && probe.menuCount === 0;
  }

  if (probe?.reason === "pending") return false;
  if (
    probe?.reason === "changed_query" ||
    probe?.reason === "ambiguous_query" ||
    probe?.reason === "ambiguous_filter" ||
    probe?.reason === "changed_filter" ||
    probe?.reason === "ambiguous_menu"
  ) {
    throw new BrowserRuntimeError("UI_STATE_CHANGED", "The Google Maps search/Rating postcondition became stale or ambiguous");
  }
  return false;
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

function ratingTriggerActionExpression(expectedQuery: string, rating: SearchRating): string {
  const labels = JSON.stringify(observedTriggerLabels().map(normalize));
  const requested = JSON.stringify(normalize(requestedChipLabel(rating)));
  return `(() => {
    const visible = (el) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
    };
    const clean = (value) => String(value || '').replace(/[\\uE000-\\uF8FF]/g, '').replace(/\\s+/g, ' ').trim();
    const normalize = (value) => clean(value).toLocaleLowerCase();
    ${queryIdentityPrelude(expectedQuery)}
    const menuLabels = new Set(${JSON.stringify(RATING_FILTER_LABELS.map(normalize))});
    const activeMenus = Array.from(document.querySelectorAll('[role="menu"]')).filter(visible).slice(0, 8)
      .filter((el) => menuLabels.has(normalize(el.getAttribute('aria-label') || '')));
    if (activeMenus.length === 1) return { ok: false, reason: 'menu_open' };
    if (activeMenus.length > 1) return { ok: false, reason: 'ambiguous_menu' };

    const triggerLabels = new Set(${labels});
    const buttons = Array.from(document.querySelectorAll('button, [role="button"]')).filter(visible).slice(0, 180);
    const candidates = buttons.filter((el) => triggerLabels.has(normalize(el.getAttribute('aria-label') || el.textContent || '')));
    if (candidates.length === 0) return { ok: false, reason: 'pending' };
    if (candidates.length !== 1) return { ok: false, reason: 'ambiguous_filter' };
    if (candidates[0].getAttribute('aria-haspopup') !== 'menu') return { ok: false, reason: 'changed_filter' };

    const triggerLabel = clean(candidates[0].getAttribute('aria-label') || candidates[0].textContent || '').slice(0, 80);
    const alreadyApplied = normalize(triggerLabel) === ${requested};
    if (!alreadyApplied) candidates[0].click();
    return {
      ok: true,
      queryValue: clean(exactQueries[0].value).slice(0, 500),
      triggerLabel,
      alreadyApplied
    };
  })()`;
}

function ratingMenuProbeExpression(expectedQuery: string, rating: SearchRating): string {
  const labels = JSON.stringify(RATING_FILTER_LABELS.map(normalize));
  const requested = JSON.stringify(rating);
  return `(() => {
    const visible = (el) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
    };
    const clean = (value) => String(value || '').replace(/[\\uE000-\\uF8FF]/g, '').replace(/\\s+/g, ' ').trim();
    const normalize = (value) => clean(value).toLocaleLowerCase();
    ${queryIdentityPrelude(expectedQuery)}
    const ratingLabels = new Set(${labels});
    const menus = Array.from(document.querySelectorAll('[role="menu"]')).filter(visible).slice(0, 8)
      .filter((el) => ratingLabels.has(normalize(el.getAttribute('aria-label') || '')));
    if (menus.length === 0) return { ok: false, reason: 'pending' };
    if (menus.length !== 1) return { ok: false, reason: 'ambiguous_menu' };
    const menuLabel = clean(menus[0].getAttribute('aria-label') || '').slice(0, 80);
    if (!ratingLabels.has(normalize(menuLabel))) return { ok: false, reason: 'changed_menu' };

    const options = Array.from(menus[0].querySelectorAll('[role="menuitemradio"]')).filter(visible).slice(0, 16);
    const requestedOptions = options.filter((el) => clean(el.getAttribute('aria-label') || el.textContent || '') === ${requested});
    if (requestedOptions.length === 0) return { ok: false, reason: options.length > 0 ? 'missing_option' : 'pending' };
    if (requestedOptions.length !== 1) return { ok: false, reason: 'ambiguous_option' };
    const checkedCount = options.filter((el) => el.getAttribute('aria-checked') === 'true').length;
    return {
      ok: true,
      queryValue: clean(exactQueries[0].value).slice(0, 500),
      menuLabel,
      optionLabel: clean(requestedOptions[0].getAttribute('aria-label') || requestedOptions[0].textContent || '').slice(0, 16),
      requestedChecked: requestedOptions[0].getAttribute('aria-checked') === 'true',
      checkedCount
    };
  })()`;
}

function ratingOptionActionExpression(expectedQuery: string, rating: SearchRating): string {
  const labels = JSON.stringify(RATING_FILTER_LABELS.map(normalize));
  const requested = JSON.stringify(rating);
  return `(() => {
    const visible = (el) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
    };
    const clean = (value) => String(value || '').replace(/[\\uE000-\\uF8FF]/g, '').replace(/\\s+/g, ' ').trim();
    const normalize = (value) => clean(value).toLocaleLowerCase();
    ${queryIdentityPrelude(expectedQuery)}
    const ratingLabels = new Set(${labels});
    const menus = Array.from(document.querySelectorAll('[role="menu"]')).filter(visible).slice(0, 8)
      .filter((el) => ratingLabels.has(normalize(el.getAttribute('aria-label') || '')));
    if (menus.length === 0) return { ok: false, reason: 'pending' };
    if (menus.length !== 1) return { ok: false, reason: 'ambiguous_menu' };

    const options = Array.from(menus[0].querySelectorAll('[role="menuitemradio"]')).filter(visible).slice(0, 16);
    const candidates = options.filter((el) => clean(el.getAttribute('aria-label') || el.textContent || '') === ${requested});
    if (candidates.length === 0) return { ok: false, reason: options.length > 0 ? 'missing_option' : 'pending' };
    if (candidates.length !== 1) return { ok: false, reason: 'ambiguous_option' };

    const queryValue = clean(exactQueries[0].value).slice(0, 500);
    const menuLabel = clean(menus[0].getAttribute('aria-label') || '').slice(0, 80);
    const optionLabel = clean(candidates[0].getAttribute('aria-label') || candidates[0].textContent || '').slice(0, 16);
    candidates[0].click();
    return { ok: true, queryValue, menuLabel, optionLabel };
  })()`;
}

function ratingAppliedChipExpression(expectedQuery: string): string {
  const triggerLabels = JSON.stringify(observedTriggerLabels().map(normalize));
  const menuLabels = JSON.stringify(RATING_FILTER_LABELS.map(normalize));
  return `(() => {
    const visible = (el) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
    };
    const clean = (value) => String(value || '').replace(/[\\uE000-\\uF8FF]/g, '').replace(/\\s+/g, ' ').trim();
    const normalize = (value) => clean(value).toLocaleLowerCase();
    ${queryIdentityPrelude(expectedQuery)}
    const allowedTriggers = new Set(${triggerLabels});
    const buttons = Array.from(document.querySelectorAll('button, [role="button"]')).filter(visible).slice(0, 180);
    const candidates = buttons.filter((el) => allowedTriggers.has(normalize(el.getAttribute('aria-label') || el.textContent || '')));
    if (candidates.length === 0) return { ok: false, reason: 'pending' };
    if (candidates.length !== 1) return { ok: false, reason: 'ambiguous_filter' };
    if (candidates[0].getAttribute('aria-haspopup') !== 'menu') return { ok: false, reason: 'changed_filter' };
    const allowedMenus = new Set(${menuLabels});
    const menus = Array.from(document.querySelectorAll('[role="menu"]')).filter(visible).slice(0, 8)
      .filter((el) => allowedMenus.has(normalize(el.getAttribute('aria-label') || '')));
    if (menus.length > 1) return { ok: false, reason: 'ambiguous_menu' };
    return {
      ok: true,
      queryValue: clean(exactQueries[0].value).slice(0, 500),
      triggerLabel: clean(candidates[0].getAttribute('aria-label') || candidates[0].textContent || '').slice(0, 80),
      menuCount: menus.length
    };
  })()`;
}

async function waitForTriggerAction(
  runtime: MapsBrowserRuntime,
  expectedQuery: string,
  rating: SearchRating
): Promise<RatingTriggerAction> {
  const client = await runtime.getClient();
  const deadline = Date.now() + UI_SETTLE_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await assertActiveSearch(runtime);
    const evaluated = await client.Runtime.evaluate({
      expression: ratingTriggerActionExpression(expectedQuery, rating),
      returnByValue: true,
      awaitPromise: true
    });
    const parsed = parseRatingTriggerActionProbe(evaluated.result.value, expectedQuery, rating);
    if (parsed.state === "ready") return parsed;
    await sleep(POLL_INTERVAL_MS);
  }
  throw new BrowserRuntimeError("UI_ELEMENT_NOT_FOUND", "The verified Google Maps Rating filter did not become available");
}

async function waitForMenu(
  runtime: MapsBrowserRuntime,
  expectedQuery: string,
  rating: SearchRating
): Promise<RatingMenuState> {
  const client = await runtime.getClient();
  const deadline = Date.now() + UI_SETTLE_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await assertActiveSearch(runtime);
    const evaluated = await client.Runtime.evaluate({
      expression: ratingMenuProbeExpression(expectedQuery, rating),
      returnByValue: true,
      awaitPromise: true
    });
    const parsed = parseRatingMenuProbe(evaluated.result.value, expectedQuery, rating);
    if (parsed.state === "ready") return parsed;
    await sleep(POLL_INTERVAL_MS);
  }
  throw new BrowserRuntimeError("UI_ELEMENT_NOT_FOUND", "The verified Google Maps Rating menu did not become available");
}

async function waitForOptionAction(
  runtime: MapsBrowserRuntime,
  expectedQuery: string,
  rating: SearchRating
): Promise<void> {
  const client = await runtime.getClient();
  const deadline = Date.now() + UI_SETTLE_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await assertActiveSearch(runtime);
    const evaluated = await client.Runtime.evaluate({
      expression: ratingOptionActionExpression(expectedQuery, rating),
      returnByValue: true,
      awaitPromise: true
    });
    const parsed = parseRatingOptionActionProbe(evaluated.result.value, expectedQuery, rating);
    if (parsed.state === "ready") return;
    await sleep(POLL_INTERVAL_MS);
  }
  throw new BrowserRuntimeError("UI_ELEMENT_NOT_FOUND", `The Google Maps rating option ${rating} did not become available`);
}

async function waitForAppliedChip(
  runtime: MapsBrowserRuntime,
  expectedQuery: string,
  rating: SearchRating
): Promise<void> {
  const client = await runtime.getClient();
  const deadline = Date.now() + UI_SETTLE_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await assertActiveSearch(runtime);
    const evaluated = await client.Runtime.evaluate({
      expression: ratingAppliedChipExpression(expectedQuery),
      returnByValue: true,
      awaitPromise: true
    });
    if (parseRatingAppliedChipProbe(evaluated.result.value, expectedQuery, rating)) return;
    await sleep(POLL_INTERVAL_MS);
  }
  throw new BrowserRuntimeError(
    "UI_STATE_CHANGED",
    `Google Maps did not verify the requested ${rating}+ Rating filter chip in the active search state`
  );
}

export interface SearchRatingFilterResult {
  applied: true;
  query: string;
  rating: SearchRating;
  alreadyApplied: boolean;
  source: "google_maps_search_rating_filter";
}

export async function setVerifiedSearchRating(
  runtime: MapsBrowserRuntime,
  expectedQueryInput: string,
  rating: SearchRating
): Promise<SearchRatingFilterResult> {
  const expectedQuery = normalizeExpectedSearchQuery(expectedQueryInput);
  await assertActiveSearch(runtime);

  let uiMutated = false;
  try {
    const trigger = await waitForTriggerAction(runtime, expectedQuery, rating);
    if (trigger.alreadyApplied) {
      return {
        applied: true,
        query: expectedQuery,
        rating,
        alreadyApplied: true,
        source: "google_maps_search_rating_filter"
      };
    }
    uiMutated = true;

    const initialMenu = await waitForMenu(runtime, expectedQuery, rating);
    if (initialMenu.requestedChecked) {
      throw new BrowserRuntimeError(
        "UI_STATE_CHANGED",
        "The visible Rating trigger disagreed with the menu selected state; refusing to guess"
      );
    }

    await waitForOptionAction(runtime, expectedQuery, rating);
    await waitForAppliedChip(runtime, expectedQuery, rating);
    runtime.markSemanticMutation();

    return {
      applied: true,
      query: expectedQuery,
      rating,
      alreadyApplied: false,
      source: "google_maps_search_rating_filter"
    };
  } catch (error) {
    if (uiMutated && !runtime.getActiveIntervention()) runtime.invalidateSemanticContext();
    throw error;
  }
}
