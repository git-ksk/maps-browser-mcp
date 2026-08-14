import { normalizeExpectedPlaceLabel } from "./place-share.js";
import { BrowserRuntimeError, type MapsBrowserRuntime } from "./runtime.js";

const MAX_QUERY_LENGTH = 500;
const NEARBY_LABELS = [
  "nearby",
  "search nearby",
  "search nearby places",
  "付近を検索",
  "周辺を検索",
  "近くを検索"
] as const;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeLabel(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLocaleLowerCase();
}

export function normalizeNearbyQuery(value: string): string {
  const trimmed = value.replace(/\s+/g, " ").trim();
  if (!trimmed || trimmed.length > MAX_QUERY_LENGTH) {
    throw new BrowserRuntimeError(
      "UI_STATE_CHANGED",
      "query must contain 1 to 500 characters for a nearby search"
    );
  }
  return trimmed;
}

export function parseNearbyOpenProbe(
  value: unknown,
  expectedLabel: string
): { placeLabel: string } {
  const probe = value as {
    ok?: unknown;
    reason?: unknown;
    placeLabel?: unknown;
  } | null | undefined;

  if (probe?.ok === true && typeof probe.placeLabel === "string") {
    if (normalizeLabel(probe.placeLabel) !== normalizeLabel(expectedLabel)) {
      throw new BrowserRuntimeError(
        "UI_STATE_CHANGED",
        "The active Google Maps place changed before the nearby action. Read/select the place again."
      );
    }
    return { placeLabel: probe.placeLabel.replace(/\s+/g, " ").trim().slice(0, 240) };
  }

  if (
    probe?.reason === "changed" ||
    probe?.reason === "ambiguous_place" ||
    probe?.reason === "ambiguous_nearby"
  ) {
    throw new BrowserRuntimeError(
      "UI_STATE_CHANGED",
      "The active Google Maps place/nearby target changed or became ambiguous. Read/select the place again."
    );
  }

  throw new BrowserRuntimeError(
    "UI_ELEMENT_NOT_FOUND",
    "The verified Google Maps place Nearby control was not found"
  );
}

export function parseNearbyInputProbe(value: unknown): { inputLabel: string } | undefined {
  const probe = value as {
    ok?: unknown;
    reason?: unknown;
    inputLabel?: unknown;
  } | null | undefined;

  if (probe?.ok === true && typeof probe.inputLabel === "string") {
    return { inputLabel: probe.inputLabel.replace(/\s+/g, " ").trim().slice(0, 160) };
  }
  if (probe?.reason === "ambiguous") {
    throw new BrowserRuntimeError(
      "UI_STATE_CHANGED",
      "Google Maps exposed more than one nearby-mode search input; refusing to guess"
    );
  }
  if (probe?.reason === "missing") return undefined;
  throw new BrowserRuntimeError("UI_STATE_CHANGED", "Google Maps nearby-search input state changed unexpectedly");
}

export function parseNearbyPostconditionProbe(value: unknown, query: string): boolean {
  const probe = value as { ok?: unknown; reason?: unknown; query?: unknown } | null | undefined;
  if (probe?.ok === true && typeof probe.query === "string") {
    if (normalizeLabel(probe.query) !== normalizeLabel(query)) {
      throw new BrowserRuntimeError(
        "UI_STATE_CHANGED",
        "Google Maps nearby-search query changed before the result state was accepted"
      );
    }
    return true;
  }
  if (probe?.reason === "ambiguous") {
    throw new BrowserRuntimeError(
      "UI_STATE_CHANGED",
      "Google Maps nearby-search result state became ambiguous; refusing to guess"
    );
  }
  return false;
}

function openNearbyExpression(expectedLabel: string): string {
  const expected = JSON.stringify(normalizeLabel(expectedLabel));
  const allowedLabels = JSON.stringify(NEARBY_LABELS);
  return `(() => {
    const visible = (el) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
    };
    const labelOf = (el) => (el.getAttribute('aria-label') || el.textContent || '')
      .replace(/\\s+/g, ' ').trim().slice(0, 240);
    const normalize = (value) => value.replace(/\\s+/g, ' ').trim().toLocaleLowerCase();
    const expected = ${expected};
    const allowed = new Set(${allowedLabels});

    const mains = Array.from(document.querySelectorAll('[role="main"]')).filter(visible).slice(0, 8);
    const matching = mains.map((main) => {
      const headings = Array.from(main.querySelectorAll('h1, [role="heading"]')).filter(visible).slice(0, 32);
      const labels = headings.map(labelOf).filter(Boolean);
      const exact = labels.find((label) => normalize(label) === expected);
      return exact ? { main, placeLabel: exact } : null;
    }).filter(Boolean);

    if (matching.length === 0) return { ok: false, reason: 'changed' };
    if (matching.length !== 1) return { ok: false, reason: 'ambiguous_place' };

    const target = matching[0];
    const controls = Array.from(target.main.querySelectorAll('button, [role="button"]'))
      .filter(visible)
      .slice(0, 96)
      .filter((control) => allowed.has(normalize(labelOf(control))));
    if (controls.length === 0) return { ok: false, reason: 'missing_nearby', placeLabel: target.placeLabel };
    if (controls.length !== 1) return { ok: false, reason: 'ambiguous_nearby', placeLabel: target.placeLabel };

    controls[0].click();
    return { ok: true, placeLabel: target.placeLabel };
  })()`;
}

function nearbyInputExpression(query?: string): string {
  const allowedLabels = JSON.stringify(NEARBY_LABELS);
  const expected = query === undefined ? "null" : JSON.stringify(normalizeLabel(query));
  return `(() => {
    const visible = (el) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
    };
    const normalize = (value) => String(value || '').replace(/\\s+/g, ' ').trim().toLocaleLowerCase();
    const labelOf = (el) => el.getAttribute('aria-label') || el.getAttribute('placeholder') || '';
    const allowed = new Set(${allowedLabels});
    const expected = ${expected};
    const inputs = Array.from(document.querySelectorAll('input, textarea, [role="searchbox"], [role="combobox"], [role="textbox"]'))
      .filter(visible)
      .slice(0, 24)
      .filter((el) => allowed.has(normalize(labelOf(el))));
    if (inputs.length === 0) return { ok: false, reason: expected === null ? 'missing' : 'pending' };
    if (inputs.length !== 1) return { ok: false, reason: 'ambiguous' };
    const target = inputs[0];
    if (expected !== null) {
      const value = String(target.value || target.textContent || '').slice(0, 500);
      return normalize(value) === expected
        ? { ok: true, query: value }
        : { ok: false, reason: 'pending' };
    }
    target.focus();
    if (typeof target.select === 'function') target.select();
    return { ok: true, inputLabel: String(labelOf(target)).slice(0, 160) };
  })()`;
}

function isSearchPath(value: string): boolean {
  try {
    return new URL(value).pathname.startsWith("/maps/search/");
  } catch {
    return false;
  }
}

export interface NearbySearchResult {
  opened: true;
  query: string;
  fromPlaceLabel: string;
  url: string;
  source: "google_maps_nearby_search";
}

export async function searchNearbyFromVerifiedPlace(
  runtime: MapsBrowserRuntime,
  expectedLabelInput: string,
  queryInput: string
): Promise<NearbySearchResult> {
  const expectedLabel = normalizeExpectedPlaceLabel(expectedLabelInput);
  const query = normalizeNearbyQuery(queryInput);

  await runtime.assertReadableView("place");
  if (runtime.getViewState() !== "place") {
    throw new BrowserRuntimeError(
      "UI_STATE_CHANGED",
      "A selected place is not active. Run maps_search, read the current results, and select the intended place again."
    );
  }

  const client = await runtime.getClient();
  const opened = await client.Runtime.evaluate({
    expression: openNearbyExpression(expectedLabel),
    returnByValue: true,
    awaitPromise: true
  });
  const { placeLabel } = parseNearbyOpenProbe(opened.result.value, expectedLabel);

  let inputReady = false;
  const inputDeadline = Date.now() + 2_500;
  while (Date.now() < inputDeadline) {
    await runtime.assertMapsSurface();
    const focused = await client.Runtime.evaluate({
      expression: nearbyInputExpression(),
      returnByValue: true,
      awaitPromise: true
    });
    if (parseNearbyInputProbe(focused.result.value)) {
      inputReady = true;
      break;
    }
    await sleep(100);
  }
  if (!inputReady) {
    throw new BrowserRuntimeError(
      "UI_ELEMENT_NOT_FOUND",
      "Google Maps did not expose one explicit nearby-mode search input for the verified active place"
    );
  }

  await runtime.assertMapsSurface();
  await client.Input.insertText({ text: query });
  await client.Input.dispatchKeyEvent({ type: "keyDown", key: "Enter" });
  await client.Input.dispatchKeyEvent({ type: "keyUp", key: "Enter" });

  let searchUrl: string | undefined;
  const resultDeadline = Date.now() + 4_000;
  while (Date.now() < resultDeadline) {
    const observedUrl = await runtime.assertMapsSurface();
    const verified = await client.Runtime.evaluate({
      expression: nearbyInputExpression(query),
      returnByValue: true,
      awaitPromise: true
    });
    if (isSearchPath(observedUrl) && parseNearbyPostconditionProbe(verified.result.value, query)) {
      searchUrl = observedUrl;
      break;
    }
    await sleep(100);
  }

  if (!searchUrl) {
    throw new BrowserRuntimeError(
      "UI_STATE_CHANGED",
      "Google Maps did not enter a verified nearby-search result state. Select the place again before retrying."
    );
  }

  // Reload only the already-verified Maps result URL so the runtime can atomically
  // adopt the new search semantic state without exposing or guessing a private URL shape.
  const adopted = await runtime.navigate(searchUrl, { kind: "search", query });
  return {
    opened: true,
    query,
    fromPlaceLabel: placeLabel,
    url: adopted.url,
    source: "google_maps_nearby_search"
  };
}
