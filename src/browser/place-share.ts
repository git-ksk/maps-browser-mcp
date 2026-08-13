import { BrowserRuntimeError, type MapsBrowserRuntime } from "./runtime.js";

const MAX_SHARE_URL_LENGTH = 2_048;
const MAX_EXPECTED_LABEL_LENGTH = 240;
const SHARE_BUTTON_LABELS = ["share", "共有"] as const;

function normalizeLabel(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLocaleLowerCase();
}

export function normalizeExpectedPlaceLabel(value: string): string {
  const trimmed = value.replace(/\s+/g, " ").trim();
  if (!trimmed || trimmed.length > MAX_EXPECTED_LABEL_LENGTH) {
    throw new BrowserRuntimeError(
      "UI_STATE_CHANGED",
      "expectedLabel must identify the active place with 1 to 240 characters"
    );
  }
  return trimmed;
}

export function validateMapsShareUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_SHARE_URL_LENGTH) {
    throw new BrowserRuntimeError("UI_STATE_CHANGED", "Google Maps returned an invalid share URL");
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new BrowserRuntimeError("UI_STATE_CHANGED", "Google Maps returned an invalid share URL");
  }

  const safeShortLink = url.protocol === "https:" && url.hostname === "maps.app.goo.gl";
  const safeMapsLink = url.protocol === "https:" &&
    url.hostname === "www.google.com" &&
    (url.pathname === "/maps" || url.pathname.startsWith("/maps/"));
  if (!safeShortLink && !safeMapsLink) {
    throw new BrowserRuntimeError(
      "UI_STATE_CHANGED",
      "Google Maps returned a share URL outside the allowed Maps origins"
    );
  }
  return url.toString();
}

export function parsePlaceShareOpenProbe(
  value: unknown,
  expectedLabel: string
): { placeLabel: string } {
  const probe = value as {
    ok?: unknown;
    reason?: unknown;
    placeLabel?: unknown;
  } | null | undefined;

  if (probe?.ok === true && typeof probe.placeLabel === "string") {
    const normalizedExpected = normalizeLabel(expectedLabel);
    const normalizedObserved = normalizeLabel(probe.placeLabel);
    if (normalizedExpected !== normalizedObserved) {
      throw new BrowserRuntimeError(
        "UI_STATE_CHANGED",
        "The active Google Maps place changed before the share action. Read/select the place again."
      );
    }
    return { placeLabel: probe.placeLabel.replace(/\s+/g, " ").trim().slice(0, MAX_EXPECTED_LABEL_LENGTH) };
  }

  if (probe?.reason === "changed" || probe?.reason === "ambiguous_place" || probe?.reason === "ambiguous_share") {
    throw new BrowserRuntimeError(
      "UI_STATE_CHANGED",
      "The active Google Maps place/share target changed or became ambiguous. Read/select the place again."
    );
  }

  throw new BrowserRuntimeError(
    "UI_ELEMENT_NOT_FOUND",
    "The verified Google Maps place share control was not found"
  );
}

export function parsePlaceShareLinkProbe(value: unknown): string | undefined {
  const probe = value as { ok?: unknown; reason?: unknown; url?: unknown } | null | undefined;
  if (probe?.ok === true && typeof probe.url === "string") {
    return validateMapsShareUrl(probe.url);
  }
  if (probe?.reason === "ambiguous") {
    throw new BrowserRuntimeError(
      "UI_STATE_CHANGED",
      "Google Maps exposed multiple different share-link targets; refusing to guess"
    );
  }
  return undefined;
}

function openPlaceShareExpression(expectedLabel: string): string {
  const expected = JSON.stringify(normalizeLabel(expectedLabel));
  const shareLabels = JSON.stringify(SHARE_BUTTON_LABELS);
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
    const allowedShareLabels = new Set(${shareLabels});

    const mains = Array.from(document.querySelectorAll('[role="main"]')).filter(visible);
    const matching = mains.map((main) => {
      const headings = Array.from(main.querySelectorAll('h1, [role="heading"]')).filter(visible);
      const labels = headings.map(labelOf).filter(Boolean);
      const exact = labels.find((label) => normalize(label) === expected);
      return exact ? { main, placeLabel: exact } : null;
    }).filter(Boolean);

    if (matching.length === 0) return { ok: false, reason: 'changed' };
    if (matching.length !== 1) return { ok: false, reason: 'ambiguous_place' };

    const target = matching[0];
    const buttons = Array.from(target.main.querySelectorAll('button, [role="button"]'))
      .filter(visible)
      .filter((button) => allowedShareLabels.has(normalize(labelOf(button))));
    if (buttons.length === 0) return { ok: false, reason: 'missing_share', placeLabel: target.placeLabel };
    if (buttons.length !== 1) return { ok: false, reason: 'ambiguous_share', placeLabel: target.placeLabel };

    buttons[0].click();
    return { ok: true, placeLabel: target.placeLabel };
  })()`;
}

const READ_PLACE_SHARE_EXPRESSION = `(() => {
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
  };
  const safe = (value) => {
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && (
        url.hostname === 'maps.app.goo.gl' ||
        (url.hostname === 'www.google.com' && (url.pathname === '/maps' || url.pathname.startsWith('/maps/')))
      );
    } catch {
      return false;
    }
  };

  const fields = Array.from(document.querySelectorAll('input, textarea, [role="textbox"]')).filter(visible);
  const urls = [];
  const seen = new Set();
  for (const field of fields) {
    const value = String(field.value || field.textContent || '').trim().slice(0, 2048);
    if (!safe(value) || seen.has(value)) continue;
    seen.add(value);
    urls.push(value);
    if (urls.length > 1) return { ok: false, reason: 'ambiguous' };
  }
  return urls.length === 1 ? { ok: true, url: urls[0] } : { ok: false, reason: 'pending' };
})()`;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface PlaceShareLinkResult {
  placeLabel: string;
  url: string;
  source: "google_maps_share_dialog";
}

export async function getVerifiedPlaceShareLink(
  runtime: MapsBrowserRuntime,
  expectedLabelInput: string
): Promise<PlaceShareLinkResult> {
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
    expression: openPlaceShareExpression(expectedLabel),
    returnByValue: true,
    awaitPromise: true
  });
  const { placeLabel } = parsePlaceShareOpenProbe(opened.result.value, expectedLabel);

  try {
    const deadline = Date.now() + 2_500;
    while (Date.now() < deadline) {
      await runtime.assertReadableView("place");
      const read = await client.Runtime.evaluate({
        expression: READ_PLACE_SHARE_EXPRESSION,
        returnByValue: true,
        awaitPromise: true
      });
      const url = parsePlaceShareLinkProbe(read.result.value);
      if (url) {
        return { placeLabel, url, source: "google_maps_share_dialog" };
      }
      await sleep(100);
    }
    throw new BrowserRuntimeError(
      "UI_ELEMENT_NOT_FOUND",
      "Google Maps did not expose a bounded share link for the verified active place"
    );
  } finally {
    await client.Input.dispatchKeyEvent({ type: "keyDown", key: "Escape" }).catch(() => undefined);
    await client.Input.dispatchKeyEvent({ type: "keyUp", key: "Escape" }).catch(() => undefined);
  }
}
