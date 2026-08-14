import { normalizeExpectedPlaceLabel } from "./place-share.js";
import { BrowserRuntimeError, type MapsBrowserRuntime } from "./runtime.js";

export type PlaceTab = "overview" | "about";

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

function labelsForTab(expectedLabel: string, tab: PlaceTab): string[] {
  if (tab === "overview") {
    return [
      `Overview of ${expectedLabel}`,
      `${expectedLabel} の概要`
    ];
  }
  return [
    `About ${expectedLabel}`,
    `「${expectedLabel}」について`
  ];
}

export function parsePlaceTabActionProbe(
  value: unknown,
  expectedLabel: string,
  tab: PlaceTab
): { placeLabel: string; tabLabel: string; alreadySelected: boolean } {
  const probe = value as {
    ok?: unknown;
    reason?: unknown;
    placeLabel?: unknown;
    tabLabel?: unknown;
    alreadySelected?: unknown;
  } | null | undefined;

  if (
    probe?.ok === true &&
    typeof probe.placeLabel === "string" &&
    typeof probe.tabLabel === "string" &&
    typeof probe.alreadySelected === "boolean"
  ) {
    if (normalizeLabel(probe.placeLabel) !== normalizeLabel(expectedLabel)) {
      throw new BrowserRuntimeError(
        "UI_STATE_CHANGED",
        "The active Google Maps place changed before the tab action. Read/select the place again."
      );
    }
    const allowed = new Set(labelsForTab(expectedLabel, tab).map(normalizeLabel));
    if (!allowed.has(normalizeLabel(probe.tabLabel))) {
      throw new BrowserRuntimeError(
        "UI_STATE_CHANGED",
        "The Google Maps place tab label changed before the action; refusing to guess"
      );
    }
    return {
      placeLabel: probe.placeLabel.replace(/\s+/g, " ").trim().slice(0, 240),
      tabLabel: probe.tabLabel.replace(/\s+/g, " ").trim().slice(0, 320),
      alreadySelected: probe.alreadySelected
    };
  }

  if (
    probe?.reason === "changed" ||
    probe?.reason === "ambiguous_place" ||
    probe?.reason === "ambiguous_tab"
  ) {
    throw new BrowserRuntimeError(
      "UI_STATE_CHANGED",
      "The active Google Maps place/tab target changed or became ambiguous. Read/select the place again."
    );
  }

  throw new BrowserRuntimeError(
    "UI_ELEMENT_NOT_FOUND",
    `The verified Google Maps ${tab} place tab was not found`
  );
}

export function parsePlaceTabPostconditionProbe(
  value: unknown,
  expectedLabel: string,
  tab: PlaceTab
): boolean {
  const probe = value as {
    ok?: unknown;
    reason?: unknown;
    placeLabel?: unknown;
    tabLabel?: unknown;
    selected?: unknown;
  } | null | undefined;

  if (
    probe?.ok === true &&
    typeof probe.placeLabel === "string" &&
    typeof probe.tabLabel === "string" &&
    typeof probe.selected === "boolean"
  ) {
    if (normalizeLabel(probe.placeLabel) !== normalizeLabel(expectedLabel)) {
      throw new BrowserRuntimeError(
        "UI_STATE_CHANGED",
        "The active Google Maps place changed while selecting the requested tab"
      );
    }
    const allowed = new Set(labelsForTab(expectedLabel, tab).map(normalizeLabel));
    if (!allowed.has(normalizeLabel(probe.tabLabel))) {
      throw new BrowserRuntimeError(
        "UI_STATE_CHANGED",
        "The requested Google Maps place tab changed while verifying the selection"
      );
    }
    return probe.selected;
  }

  if (
    probe?.reason === "changed" ||
    probe?.reason === "ambiguous_place" ||
    probe?.reason === "ambiguous_tab" ||
    probe?.reason === "missing_tab"
  ) {
    throw new BrowserRuntimeError(
      "UI_STATE_CHANGED",
      "The active Google Maps place/tab state changed before the requested selection could be verified"
    );
  }

  return false;
}

function placeTabExpression(expectedLabel: string, tab: PlaceTab, click: boolean): string {
  const expectedRaw = JSON.stringify(expectedLabel);
  const expected = JSON.stringify(normalizeLabel(expectedLabel));
  const tabLabels = JSON.stringify(labelsForTab(expectedLabel, tab).map(normalizeLabel));
  const identityLabels = JSON.stringify([
    ...labelsForTab(expectedLabel, "overview"),
    ...labelsForTab(expectedLabel, "about")
  ].map(normalizeLabel));

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
    const labelOf = (el) => clean(el.getAttribute('aria-label') || el.textContent || '').slice(0, 320);
    const expectedRaw = ${expectedRaw};
    const expected = ${expected};
    const targetLabels = new Set(${tabLabels});
    const identityLabels = new Set(${identityLabels});

    const mains = Array.from(document.querySelectorAll('[role="main"]')).filter(visible).slice(0, 8);
    const matching = mains.map((main) => {
      const headings = Array.from(main.querySelectorAll('h1, [role="heading"]')).filter(visible).slice(0, 32);
      const exactHeading = headings.map(labelOf).find((label) => normalize(label) === expected);
      const tabs = Array.from(main.querySelectorAll('[role="tab"]')).filter(visible).slice(0, 16);
      const placeTabs = tabs.filter((entry) => identityLabels.has(normalize(labelOf(entry))));
      return exactHeading || placeTabs.length > 0
        ? { main, placeLabel: exactHeading || expectedRaw }
        : null;
    }).filter(Boolean);

    if (matching.length === 0) return { ok: false, reason: 'changed' };
    if (matching.length !== 1) return { ok: false, reason: 'ambiguous_place' };

    const target = matching[0];
    const tabs = Array.from(target.main.querySelectorAll('[role="tab"]')).filter(visible).slice(0, 16);
    const candidates = tabs
      .map((el) => ({ el, label: labelOf(el) }))
      .filter((entry) => targetLabels.has(normalize(entry.label)));
    if (candidates.length === 0) {
      return { ok: false, reason: 'missing_tab', placeLabel: target.placeLabel };
    }
    if (candidates.length !== 1) {
      return { ok: false, reason: 'ambiguous_tab', placeLabel: target.placeLabel };
    }

    const selected = candidates[0].el.getAttribute('aria-selected') === 'true';
    if (${click ? "true" : "false"} && !selected) candidates[0].el.click();
    return {
      ok: true,
      placeLabel: target.placeLabel,
      tabLabel: candidates[0].label,
      ${click ? "alreadySelected: selected" : "selected"}
    };
  })()`;
}

export interface PlaceTabSelectionResult {
  selected: true;
  placeLabel: string;
  tab: PlaceTab;
  alreadySelected: boolean;
  source: "google_maps_place_tabs";
}

export async function selectVerifiedPlaceTab(
  runtime: MapsBrowserRuntime,
  expectedLabelInput: string,
  tab: PlaceTab
): Promise<PlaceTabSelectionResult> {
  const expectedLabel = normalizeExpectedPlaceLabel(expectedLabelInput);
  await runtime.assertReadableView("place");
  if (runtime.getViewState() !== "place") {
    throw new BrowserRuntimeError(
      "UI_STATE_CHANGED",
      "A selected place is not active. Run maps_search, read the current results, and select the intended place again."
    );
  }

  const client = await runtime.getClient();
  const acted = await client.Runtime.evaluate({
    expression: placeTabExpression(expectedLabel, tab, true),
    returnByValue: true,
    awaitPromise: true
  });
  const action = parsePlaceTabActionProbe(acted.result.value, expectedLabel, tab);

  if (!action.alreadySelected) {
    try {
      const deadline = Date.now() + 2_500;
      let verified = false;
      while (Date.now() < deadline) {
        await runtime.assertReadableView("place");
        const postcondition = await client.Runtime.evaluate({
          expression: placeTabExpression(expectedLabel, tab, false),
          returnByValue: true,
          awaitPromise: true
        });
        if (parsePlaceTabPostconditionProbe(postcondition.result.value, expectedLabel, tab)) {
          verified = true;
          break;
        }
        await sleep(100);
      }
      if (!verified) {
        throw new BrowserRuntimeError(
          "UI_STATE_CHANGED",
          "Google Maps did not verify the requested place tab selection. Read/select the place again before retrying."
        );
      }
      runtime.markSemanticMutation();
    } catch (error) {
      if (!runtime.getActiveIntervention()) runtime.invalidateSemanticContext();
      throw error;
    }
  }

  return {
    selected: true,
    placeLabel: action.placeLabel,
    tab,
    alreadySelected: action.alreadySelected,
    source: "google_maps_place_tabs"
  };
}
