import { normalizeExpectedPlaceLabel } from "./place-share.js";
import { BrowserRuntimeError, type MapsBrowserRuntime } from "./runtime.js";

const PHOTO_CONTROL_LABELS = [
  "see photos",
  "all photos",
  "photos",
  "写真",
  "写真を見る",
  "写真を表示",
  "すべての写真"
] as const;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeUiLabel(value: string): string {
  return value
    .replace(/[\uE000-\uF8FF]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase();
}

export function parsePhotoOpenProbe(
  value: unknown,
  expectedLabel: string
): { placeLabel: string; controlLabel: string } {
  const probe = value as {
    ok?: unknown;
    reason?: unknown;
    placeLabel?: unknown;
    controlLabel?: unknown;
  } | null | undefined;

  if (
    probe?.ok === true &&
    typeof probe.placeLabel === "string" &&
    typeof probe.controlLabel === "string"
  ) {
    if (normalizeUiLabel(probe.placeLabel) !== normalizeUiLabel(expectedLabel)) {
      throw new BrowserRuntimeError(
        "UI_STATE_CHANGED",
        "The active Google Maps place changed before the photo action. Read/select the place again."
      );
    }
    return {
      placeLabel: probe.placeLabel.replace(/\s+/g, " ").trim().slice(0, 240),
      controlLabel: normalizeUiLabel(probe.controlLabel).slice(0, 80)
    };
  }

  if (probe?.reason === "changed" || probe?.reason === "ambiguous_place" || probe?.reason === "ambiguous_photo") {
    throw new BrowserRuntimeError(
      "UI_STATE_CHANGED",
      "The active Google Maps place/photo target changed or became ambiguous. Read/select the place again."
    );
  }

  throw new BrowserRuntimeError(
    "UI_ELEMENT_NOT_FOUND",
    "The verified Google Maps place photo control was not found"
  );
}

export function parsePhotoSurfaceProbe(value: unknown, expectedLabel: string): boolean {
  const probe = value as {
    ok?: unknown;
    reason?: unknown;
    placeLabel?: unknown;
  } | null | undefined;

  if (probe?.ok === true && typeof probe.placeLabel === "string") {
    if (normalizeUiLabel(probe.placeLabel) !== normalizeUiLabel(expectedLabel)) {
      throw new BrowserRuntimeError(
        "UI_STATE_CHANGED",
        "The Google Maps photo viewer no longer belongs to the expected place"
      );
    }
    return true;
  }
  if (probe?.reason === "ambiguous") {
    throw new BrowserRuntimeError(
      "UI_STATE_CHANGED",
      "Google Maps exposed an ambiguous photo viewer state; refusing to guess"
    );
  }
  return false;
}

export function isPhotoViewerPath(value: string): boolean {
  try {
    const pathname = new URL(value).pathname;
    return pathname.startsWith("/maps/@") && /,3a(?:,|\/)/.test(pathname) && pathname.includes("/data=");
  } catch {
    return false;
  }
}

function openPhotoExpression(expectedLabel: string): string {
  const expected = JSON.stringify(normalizeUiLabel(expectedLabel));
  const allowed = JSON.stringify(PHOTO_CONTROL_LABELS);
  return `(() => {
    const visible = (el) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
    };
    const normalize = (value) => String(value || '')
      .replace(/[\\uE000-\\uF8FF]/g, '')
      .replace(/\\s+/g, ' ').trim().toLocaleLowerCase();
    const labelOf = (el) => String(el.getAttribute('aria-label') || el.textContent || '').slice(0, 240);
    const expected = ${expected};
    const allowed = new Set(${allowed});
    const mains = Array.from(document.querySelectorAll('[role="main"]')).filter(visible).slice(0, 8);
    const matching = mains.map((main) => {
      const headings = Array.from(main.querySelectorAll('h1, [role="heading"]')).filter(visible).slice(0, 32);
      const placeLabel = headings.map(labelOf).find((label) => normalize(label) === expected);
      return placeLabel ? { main, placeLabel } : null;
    }).filter(Boolean);
    if (matching.length === 0) return { ok: false, reason: 'changed' };
    if (matching.length !== 1) return { ok: false, reason: 'ambiguous_place' };

    const target = matching[0];
    const controls = Array.from(target.main.querySelectorAll('button, [role="button"]'))
      .filter(visible).slice(0, 120)
      .map((el) => ({ el, label: labelOf(el) }))
      .filter((entry) => allowed.has(normalize(entry.label)));
    if (controls.length === 0) return { ok: false, reason: 'missing_photo', placeLabel: target.placeLabel };
    if (controls.length !== 1) return { ok: false, reason: 'ambiguous_photo', placeLabel: target.placeLabel };

    controls[0].el.click();
    return {
      ok: true,
      placeLabel: target.placeLabel,
      controlLabel: controls[0].label
    };
  })()`;
}

function verifyPhotoSurfaceExpression(expectedLabel: string): string {
  const expected = JSON.stringify(normalizeUiLabel(expectedLabel));
  return `(() => {
    const visible = (el) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
    };
    const normalize = (value) => String(value || '')
      .replace(/[\\uE000-\\uF8FF]/g, '')
      .replace(/\\s+/g, ' ').trim().toLocaleLowerCase();
    const labelOf = (el) => String(el.getAttribute('aria-label') || el.textContent || '').slice(0, 240);
    const expected = ${expected};
    const headings = Array.from(document.querySelectorAll('h1, h2, [role="heading"]')).filter(visible).slice(0, 32);
    const matching = headings.map(labelOf).filter((label) => normalize(label) === expected);
    if (matching.length === 0) return { ok: false, reason: 'pending' };
    if (matching.length !== 1) return { ok: false, reason: 'ambiguous' };
    const closers = Array.from(document.querySelectorAll('button, [role="button"]')).filter(visible).slice(0, 80)
      .filter((el) => !el.closest('[role="search"]'))
      .map(labelOf)
      .filter((label) => ['close', '閉じる'].includes(normalize(label)));
    if (closers.length !== 1) return { ok: false, reason: closers.length === 0 ? 'pending' : 'ambiguous' };
    return { ok: true, placeLabel: matching[0] };
  })()`;
}

async function invalidatePlaceStateAfterViewerTransition(runtime: MapsBrowserRuntime): Promise<void> {
  try {
    await runtime.assertReadableView("place");
  } catch (error) {
    if (error instanceof BrowserRuntimeError && error.code === "UI_STATE_CHANGED") return;
    throw error;
  }
  throw new BrowserRuntimeError(
    "UI_STATE_CHANGED",
    "Google Maps photo viewer opened without invalidating the previous place semantic state"
  );
}

export interface PlacePhotoSurfaceResult {
  opened: true;
  placeLabel: string;
  source: "google_maps_photo_surface";
}

export async function openVerifiedPlacePhotoSurface(
  runtime: MapsBrowserRuntime,
  expectedLabelInput: string
): Promise<PlacePhotoSurfaceResult> {
  const expectedLabel = normalizeExpectedPlaceLabel(expectedLabelInput);
  await runtime.assertReadableView("place");
  if (runtime.getViewState() !== "place") {
    throw new BrowserRuntimeError(
      "UI_STATE_CHANGED",
      "A selected place is not active. Run maps_search, read the current results, and select the intended place again."
    );
  }

  const client = await runtime.getClient();
  const opened = await client.Runtime.evaluate({
    expression: openPhotoExpression(expectedLabel),
    returnByValue: true,
    awaitPromise: true
  });
  const { placeLabel } = parsePhotoOpenProbe(opened.result.value, expectedLabel);

  let observedUrl: string | undefined;
  const deadline = Date.now() + 3_500;
  while (Date.now() < deadline) {
    const currentUrl = await runtime.assertMapsSurface();
    const verified = await client.Runtime.evaluate({
      expression: verifyPhotoSurfaceExpression(expectedLabel),
      returnByValue: true,
      awaitPromise: true
    });
    if (isPhotoViewerPath(currentUrl) && parsePhotoSurfaceProbe(verified.result.value, expectedLabel)) {
      observedUrl = currentUrl;
      break;
    }
    await sleep(100);
  }

  if (!observedUrl) {
    const currentUrl = await runtime.assertMapsSurface();
    if (!new URL(currentUrl).pathname.startsWith("/maps/place/")) {
      await invalidatePlaceStateAfterViewerTransition(runtime);
    }
    throw new BrowserRuntimeError(
      "UI_STATE_CHANGED",
      "Google Maps did not enter a verified photo viewer for the active place. Select the place again before retrying."
    );
  }

  // The photo viewer is useful to the human but is not yet a replayable semantic state.
  // Intentionally invalidate the previous place state and advance the resource epoch.
  await invalidatePlaceStateAfterViewerTransition(runtime);
  return {
    opened: true,
    placeLabel,
    source: "google_maps_photo_surface"
  };
}
