import { normalizeExpectedPlaceLabel } from "./place-share.js";
import { BrowserRuntimeError, type MapsBrowserRuntime } from "./runtime.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeLabel(value: string): string {
  return value
    .replace(/[\uE000-\uF8FF]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase();
}

export function placeUrlIdentity(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new BrowserRuntimeError("UI_STATE_CHANGED", "Google Maps returned an invalid place URL");
  }
  if (
    url.protocol !== "https:" ||
    !["www.google.com", "google.com", "maps.google.com", "www.google.co.jp", "google.co.jp", "maps.google.co.jp"].includes(url.hostname) ||
    !url.pathname.startsWith("/maps/place/")
  ) {
    throw new BrowserRuntimeError("UI_STATE_CHANGED", "The active Google Maps place URL changed unexpectedly");
  }
  const marker = "/data=";
  const index = url.pathname.indexOf(marker);
  const pathIdentity = index >= 0 ? url.pathname.slice(0, index) : url.pathname;
  return `${url.origin}${pathIdentity}`;
}

export function isObservedCollapsedOpeningHoursLabel(value: string): boolean {
  const label = normalizeLabel(value);
  return label === "open 24 hours" ||
    label.startsWith("closed · opens ") ||
    label.startsWith("open · closes ") ||
    label.startsWith("営業時間外 · 営業開始: ") ||
    label.startsWith("営業中 · 営業終了: ");
}

export function isObservedExpandedOpeningHoursLabel(value: string): boolean {
  return ["closed", "open now", "営業中"].includes(normalizeLabel(value));
}

export function parseOpeningHoursActionProbe(
  value: unknown,
  expectedLabel: string
): { placeLabel: string; controlLabel: string; alreadyExpanded: boolean } {
  const probe = value as {
    ok?: unknown;
    reason?: unknown;
    placeLabel?: unknown;
    controlLabel?: unknown;
    alreadyExpanded?: unknown;
  } | null | undefined;

  if (
    probe?.ok === true &&
    typeof probe.placeLabel === "string" &&
    typeof probe.controlLabel === "string" &&
    typeof probe.alreadyExpanded === "boolean"
  ) {
    if (normalizeLabel(probe.placeLabel) !== normalizeLabel(expectedLabel)) {
      throw new BrowserRuntimeError(
        "UI_STATE_CHANGED",
        "The active Google Maps place changed before the opening-hours action. Read/select the place again."
      );
    }
    const observedLabel = probe.alreadyExpanded
      ? isObservedExpandedOpeningHoursLabel(probe.controlLabel)
      : isObservedCollapsedOpeningHoursLabel(probe.controlLabel);
    if (!observedLabel) {
      throw new BrowserRuntimeError(
        "UI_STATE_CHANGED",
        "Google Maps exposed an unobserved opening-hours control shape; refusing to guess"
      );
    }
    return {
      placeLabel: probe.placeLabel.replace(/\s+/g, " ").trim().slice(0, 240),
      controlLabel: probe.controlLabel.replace(/\s+/g, " ").trim().slice(0, 240),
      alreadyExpanded: probe.alreadyExpanded
    };
  }

  if (
    probe?.reason === "changed" ||
    probe?.reason === "ambiguous_place" ||
    probe?.reason === "ambiguous_hours"
  ) {
    throw new BrowserRuntimeError(
      "UI_STATE_CHANGED",
      "The active Google Maps place/opening-hours target changed or became ambiguous. Read/select the place again."
    );
  }

  throw new BrowserRuntimeError(
    "UI_ELEMENT_NOT_FOUND",
    "The verified Google Maps opening-hours control was not found"
  );
}

export type OpeningHoursSurfaceMode = "inline" | "detail";

export function parseOpeningHoursPostconditionProbe(value: unknown): OpeningHoursSurfaceMode | undefined {
  const probe = value as { ok?: unknown; reason?: unknown; mode?: unknown } | null | undefined;
  if (probe?.ok === true && (probe.mode === "inline" || probe.mode === "detail")) return probe.mode;
  if (probe?.reason === "ambiguous") {
    throw new BrowserRuntimeError(
      "UI_STATE_CHANGED",
      "Google Maps exposed an ambiguous opening-hours state; refusing to guess"
    );
  }
  if (probe?.reason === "pending") return undefined;
  throw new BrowserRuntimeError(
    "UI_STATE_CHANGED",
    "Google Maps opening-hours state changed unexpectedly"
  );
}

function openingHoursActionExpression(expectedLabel: string): string {
  const expected = JSON.stringify(normalizeLabel(expectedLabel));
  return `(() => {
    const visible = (el) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
    };
    const clean = (value) => String(value || '')
      .replace(/[\\uE000-\\uF8FF]/g, '')
      .replace(/\\s+/g, ' ').trim();
    const normalize = (value) => clean(value).toLocaleLowerCase();
    const labelOf = (el) => clean(el.getAttribute('aria-label') || el.textContent || '').slice(0, 240);
    const expected = ${expected};
    const isCollapsed = (entry) => {
      const label = normalize(entry.label);
      if (entry.expanded === 'false') {
        return label === 'open 24 hours' ||
          label.startsWith('closed · opens ') ||
          label.startsWith('open · closes ') ||
          label.startsWith('営業時間外 · 営業開始: ') ||
          label.startsWith('営業中 · 営業終了: ');
      }
      return entry.expanded === null &&
        label.startsWith('営業時間外 · 営業開始: ') &&
        label.includes('詳しい営業時間を見る');
    };
    const isExpanded = (entry) => entry.expanded === 'true' &&
      ['closed', 'open now', '営業中'].includes(normalize(entry.label));

    const mains = Array.from(document.querySelectorAll('[role="main"]')).filter(visible).slice(0, 8);
    const matching = mains.map((main) => {
      const headings = Array.from(main.querySelectorAll('h1, [role="heading"]')).filter(visible).slice(0, 32);
      const placeLabel = headings.map(labelOf).find((label) => normalize(label) === expected);
      return placeLabel ? { main, placeLabel } : null;
    }).filter(Boolean);
    if (matching.length === 0) return { ok: false, reason: 'changed' };
    if (matching.length !== 1) return { ok: false, reason: 'ambiguous_place' };

    const target = matching[0];
    const candidates = Array.from(target.main.querySelectorAll('button, [role="button"]'))
      .filter(visible).slice(0, 120)
      .map((el) => ({ el, label: labelOf(el), expanded: el.getAttribute('aria-expanded') }))
      .filter((entry) => isCollapsed(entry) || isExpanded(entry));
    if (candidates.length === 0) {
      return { ok: false, reason: 'missing_hours', placeLabel: target.placeLabel };
    }
    if (candidates.length !== 1) {
      return { ok: false, reason: 'ambiguous_hours', placeLabel: target.placeLabel };
    }

    const entry = candidates[0];
    const alreadyExpanded = isExpanded(entry);
    if (!alreadyExpanded) entry.el.click();
    return {
      ok: true,
      placeLabel: target.placeLabel,
      controlLabel: entry.label,
      alreadyExpanded
    };
  })()`;
}

function openingHoursPostconditionExpression(expectedLabel: string): string {
  const expected = JSON.stringify(normalizeLabel(expectedLabel));
  return `(() => {
    const visible = (el) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
    };
    const clean = (value) => String(value || '')
      .replace(/[\\uE000-\\uF8FF]/g, '')
      .replace(/\\s+/g, ' ').trim();
    const normalize = (value) => clean(value).toLocaleLowerCase();
    const labelOf = (el) => clean(el.getAttribute('aria-label') || el.textContent || '').slice(0, 240);
    const expected = ${expected};
    const isExpandedPrimary = (el) => {
      if (el.getAttribute('aria-expanded') !== 'true') return false;
      return ['closed', 'open now', '営業中'].includes(normalize(labelOf(el)));
    };
    const isHoursMarker = (el) => {
      const label = normalize(labelOf(el));
      return label.endsWith('copy open hours') ||
        label === 'suggest an edit to open hours' ||
        label.endsWith('営業時間をコピーします') ||
        label === '営業時間の修正を提案';
    };

    const mains = Array.from(document.querySelectorAll('[role="main"]')).filter(visible).slice(0, 8);
    const markers = mains.flatMap((main) =>
      Array.from(main.querySelectorAll('button, [role="button"]')).filter(visible).slice(0, 120)
    ).filter(isHoursMarker).slice(0, 9);
    if (markers.length === 0) return { ok: false, reason: 'pending' };
    if (markers.length > 8) return { ok: false, reason: 'ambiguous' };

    const matching = mains.map((main) => {
      const headings = Array.from(main.querySelectorAll('h1, [role="heading"]')).filter(visible).slice(0, 32);
      const placeLabel = headings.map(labelOf).find((label) => normalize(label) === expected);
      return placeLabel ? { main, placeLabel } : null;
    }).filter(Boolean);
    if (matching.length > 1) return { ok: false, reason: 'ambiguous' };
    if (matching.length === 1) {
      const expanded = Array.from(matching[0].main.querySelectorAll('button, [role="button"]'))
        .filter(visible).slice(0, 120).filter(isExpandedPrimary);
      if (expanded.length === 1) return { ok: true, mode: 'inline' };
      if (expanded.length > 1) return { ok: false, reason: 'ambiguous' };
      return { ok: false, reason: 'pending' };
    }

    return { ok: true, mode: 'detail' };
  })()`;
}

export interface OpeningHoursExpansionResult {
  expanded: true;
  placeLabel: string;
  alreadyExpanded: boolean;
  placeStateRetained: boolean;
  source: "google_maps_opening_hours";
}

export async function expandVerifiedOpeningHours(
  runtime: MapsBrowserRuntime,
  expectedLabelInput: string
): Promise<OpeningHoursExpansionResult> {
  const expectedLabel = normalizeExpectedPlaceLabel(expectedLabelInput);
  await runtime.assertReadableView("place");
  if (runtime.getViewState() !== "place") {
    throw new BrowserRuntimeError(
      "UI_STATE_CHANGED",
      "A selected place is not active. Run maps_search, read the current results, and select the intended place again."
    );
  }

  const beforeIdentity = placeUrlIdentity(await runtime.currentUrl());
  const client = await runtime.getClient();
  const acted = await client.Runtime.evaluate({
    expression: openingHoursActionExpression(expectedLabel),
    returnByValue: true,
    awaitPromise: true
  });
  const action = parseOpeningHoursActionProbe(acted.result.value, expectedLabel);
  if (action.alreadyExpanded) {
    return {
      expanded: true,
      placeLabel: action.placeLabel,
      alreadyExpanded: true,
      placeStateRetained: true,
      source: "google_maps_opening_hours"
    };
  }

  try {
    const deadline = Date.now() + 2_500;
    let mode: OpeningHoursSurfaceMode | undefined;
    while (Date.now() < deadline) {
      const currentUrl = await runtime.assertMapsSurface();
      if (placeUrlIdentity(currentUrl) !== beforeIdentity) {
        throw new BrowserRuntimeError(
          "UI_STATE_CHANGED",
          "Google Maps changed the active place while expanding opening hours"
        );
      }
      const postcondition = await client.Runtime.evaluate({
        expression: openingHoursPostconditionExpression(expectedLabel),
        returnByValue: true,
        awaitPromise: true
      });
      mode = parseOpeningHoursPostconditionProbe(postcondition.result.value);
      if (mode) break;
      await sleep(100);
    }
    if (!mode) {
      throw new BrowserRuntimeError(
        "UI_STATE_CHANGED",
        "Google Maps did not verify the requested opening-hours expansion. Read/select the place again before retrying."
      );
    }

    if (mode === "inline") {
      runtime.markSemanticMutation();
      return {
        expanded: true,
        placeLabel: action.placeLabel,
        alreadyExpanded: false,
        placeStateRetained: true,
        source: "google_maps_opening_hours"
      };
    }

    runtime.invalidateSemanticContext();
    return {
      expanded: true,
      placeLabel: action.placeLabel,
      alreadyExpanded: false,
      placeStateRetained: false,
      source: "google_maps_opening_hours"
    };
  } catch (error) {
    if (!runtime.getActiveIntervention()) runtime.invalidateSemanticContext();
    throw error;
  }
}
