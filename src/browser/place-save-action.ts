import { normalizeExpectedPlaceLabel } from "./place-share.js";
import {
  PLACE_SAVE_MAX_LISTS,
  PLACE_SAVE_MENU_HEADINGS,
  PLACE_SAVE_NEW_LIST_LABELS,
  assertAuthenticatedSaveReadiness,
  closePlaceSaveMenu,
  normalizePlaceSaveIdentity,
  parsePlaceSaveStateProbe,
  placeSaveOpenExpression,
  placeSaveReadExpression,
  type PlaceSaveStateResult
} from "./place-save-state.js";
import { BrowserRuntimeError, type MapsBrowserRuntime } from "./runtime.js";

const POSTCONDITION_TIMEOUT_MS = 2_500;
const POLL_INTERVAL_MS = 100;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface PlaceSaveTarget {
  placeLabel: string;
  listIndex: number;
  listLabel: string;
  alreadySaved: boolean;
}

export interface PlaceSaveToListResult {
  saved: true;
  alreadySaved: boolean;
  placeLabel: string;
  listIndex: number;
  listLabel: string;
  source: "google_maps_save_menu";
}

function isNewListLabel(value: string): boolean {
  const normalized = normalizePlaceSaveIdentity(value);
  return PLACE_SAVE_NEW_LIST_LABELS.some((label) => normalizePlaceSaveIdentity(label) === normalized);
}

export function resolveFreshPlaceSaveTarget(
  state: PlaceSaveStateResult,
  expectedPlaceLabel: string,
  listIndex: number,
  expectedListLabel: string
): PlaceSaveTarget {
  if (!Number.isInteger(listIndex) || listIndex < 0 || listIndex >= PLACE_SAVE_MAX_LISTS) {
    throw new BrowserRuntimeError("UI_STATE_CHANGED", "The requested save-list index is outside the bounded fresh chooser state");
  }
  if (normalizePlaceSaveIdentity(state.placeLabel) !== normalizePlaceSaveIdentity(expectedPlaceLabel)) {
    throw new BrowserRuntimeError("UI_STATE_CHANGED", "The active Google Maps place changed before the save action");
  }
  if (isNewListLabel(expectedListLabel)) {
    throw new BrowserRuntimeError("UI_STATE_CHANGED", "New-list creation is not an allowed V5-C save target");
  }

  const row = state.lists[listIndex];
  if (!row || row.index !== listIndex) {
    throw new BrowserRuntimeError("UI_STATE_CHANGED", "The requested save-list row is missing or its order changed");
  }
  if (isNewListLabel(row.label)) {
    throw new BrowserRuntimeError("UI_STATE_CHANGED", "New-list creation is not an allowed V5-C save target");
  }
  if (normalizePlaceSaveIdentity(row.label) !== normalizePlaceSaveIdentity(expectedListLabel)) {
    throw new BrowserRuntimeError("UI_STATE_CHANGED", "The requested save-list identity changed or its index became stale");
  }

  const duplicateMatches = state.lists.filter(
    (candidate) => normalizePlaceSaveIdentity(candidate.label) === normalizePlaceSaveIdentity(expectedListLabel)
  );
  if (duplicateMatches.length !== 1) {
    throw new BrowserRuntimeError("UI_STATE_CHANGED", "The requested save-list identity is duplicate or ambiguous");
  }

  return {
    placeLabel: state.placeLabel,
    listIndex,
    listLabel: row.label,
    alreadySaved: row.saved
  };
}

function targetExpression(
  expectedPlaceLabel: string,
  listIndex: number,
  expectedListLabel: string,
  click: boolean
): string {
  const expectedPlace = JSON.stringify(normalizePlaceSaveIdentity(expectedPlaceLabel));
  const expectedList = JSON.stringify(normalizePlaceSaveIdentity(expectedListLabel));
  const headings = JSON.stringify(PLACE_SAVE_MENU_HEADINGS);
  const newListLabels = JSON.stringify(PLACE_SAVE_NEW_LIST_LABELS.map((label) => normalizePlaceSaveIdentity(label)));

  return `(() => {
    const visible = (el) => { const r=el.getBoundingClientRect(); const s=getComputedStyle(el); return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none'; };
    const clean = (v) => String(v||'').replace(/[\\uE000-\\uF8FF]/g,'').replace(/\\s+/g,' ').trim();
    const norm = (v) => clean(v).toLocaleLowerCase();
    const labelOf = (el) => clean(el.getAttribute('aria-label') || el.textContent || '').slice(0,240);
    const mains=[...document.querySelectorAll('[role="main"]')].filter(visible).slice(0,8);
    const places=mains.flatMap(main=>[...main.querySelectorAll('h1,[role="heading"]')].filter(visible).map(labelOf).filter(x=>norm(x)===${expectedPlace}));
    if(places.length===0)return {ok:false,reason:'changed'};
    if(places.length!==1)return {ok:false,reason:'ambiguous_place'};
    const allowedHeadings=new Set(${headings});
    const menus=[...document.querySelectorAll('[role="menu"]')].filter(visible).slice(0,8).filter(menu=>[...menu.querySelectorAll('[role="heading"]')].filter(visible).some(h=>allowedHeadings.has(norm(labelOf(h)))));
    if(menus.length===0)return {ok:false,reason:'pending'};
    if(menus.length!==1)return {ok:false,reason:'ambiguous_menu'};
    const rawRows=[...menus[0].querySelectorAll('[role="menuitemradio"]')].filter(visible).slice(0,64);
    const newListLabels=new Set(${newListLabels});
    const rows=[];
    for(const el of rawRows){
      const leaves=[...el.querySelectorAll('div,span')]
        .filter(visible)
        .filter(node=>node.children.length===0)
        .map(node=>clean(node.textContent).slice(0,160))
        .filter(Boolean);
      const uniqueLeaves=[]; const leafSeen=new Set();
      for(const text of leaves){const key=norm(text);if(!leafSeen.has(key)){leafSeen.add(key);uniqueLeaves.push(text);}}
      if(uniqueLeaves.length<1)return {ok:false,reason:'ambiguous_list_structure'};
      const name=uniqueLeaves[0];
      if(newListLabels.has(norm(name)))return {ok:false,reason:'new_list_in_radio'};
      const rowText=clean(el.textContent);
      if(!rowText.startsWith(name))return {ok:false,reason:'ambiguous_list_structure'};
      const checked=el.getAttribute('aria-checked');
      if(checked!=='true'&&checked!=='false')return {ok:false,reason:'ambiguous_list_structure'};
      rows.push({el,label:name,checked:checked==='true'});
    }
    const seen=new Set();
    for(const row of rows){const key=norm(row.label);if(!key||seen.has(key))return {ok:false,reason:'duplicate_list'};seen.add(key);}
    if(${listIndex} < 0 || ${listIndex} >= rows.length || ${listIndex} >= ${PLACE_SAVE_MAX_LISTS})return {ok:false,reason:'target_missing'};
    const target=rows[${listIndex}];
    if(norm(target.label)!==${expectedList})return {ok:false,reason:'target_mismatch',listLabel:target.label};
    const wasSaved=target.checked;
    if(${click ? "true" : "false"}){
      const rect=target.el.getBoundingClientRect();
      const x=rect.left+(rect.width/2), y=rect.top+(rect.height/2);
      if(!(rect.width>0&&rect.height>0&&Number.isFinite(x)&&Number.isFinite(y)))return {ok:false,reason:'target_not_clickable'};
      return {ok:true,placeLabel:places[0],listIndex:${listIndex},listLabel:target.label,checked:wasSaved,clicked:false,x,y};
    }
    return {ok:true,placeLabel:places[0],listIndex:${listIndex},listLabel:target.label,checked:wasSaved,clicked:false};
  })()`;
}

export function parsePlaceSaveActionProbe(
  value: unknown,
  expectedPlaceLabel: string,
  listIndex: number,
  expectedListLabel: string
): { placeLabel: string; listIndex: number; listLabel: string; wasSaved: boolean; clicked: boolean; point?: { x: number; y: number } } | undefined {
  const probe = value as {
    ok?: unknown;
    reason?: unknown;
    placeLabel?: unknown;
    listIndex?: unknown;
    listLabel?: unknown;
    checked?: unknown;
    clicked?: unknown;
    x?: unknown;
    y?: unknown;
  } | null | undefined;

  if (probe?.reason === "pending") return undefined;
  if (
    probe?.ok !== true ||
    typeof probe.placeLabel !== "string" ||
    typeof probe.listIndex !== "number" ||
    typeof probe.listLabel !== "string" ||
    typeof probe.checked !== "boolean" ||
    typeof probe.clicked !== "boolean"
  ) {
    if ([
      "changed",
      "ambiguous_place",
      "ambiguous_menu",
      "ambiguous_list_structure",
      "duplicate_list",
      "new_list_in_radio",
      "target_missing",
      "target_mismatch",
      "target_not_clickable"
    ].includes(String(probe?.reason))) {
      throw new BrowserRuntimeError("UI_STATE_CHANGED", "The Google Maps save target changed or became ambiguous; refusing to guess");
    }
    throw new BrowserRuntimeError("UI_ELEMENT_NOT_FOUND", "The verified Google Maps save-list target was not found");
  }
  if (normalizePlaceSaveIdentity(probe.placeLabel) !== normalizePlaceSaveIdentity(expectedPlaceLabel)) {
    throw new BrowserRuntimeError("UI_STATE_CHANGED", "The active Google Maps place changed before the save click");
  }
  if (probe.listIndex !== listIndex || normalizePlaceSaveIdentity(probe.listLabel) !== normalizePlaceSaveIdentity(expectedListLabel)) {
    throw new BrowserRuntimeError("UI_STATE_CHANGED", "The requested save-list identity changed before the save click");
  }
  if (isNewListLabel(probe.listLabel)) {
    throw new BrowserRuntimeError("UI_STATE_CHANGED", "New-list creation is not an allowed V5-C save target");
  }
  const hasPoint = probe.x !== undefined || probe.y !== undefined;
  let point: { x: number; y: number } | undefined;
  if (hasPoint) {
    if (typeof probe.x !== "number" || typeof probe.y !== "number" || !Number.isFinite(probe.x) || !Number.isFinite(probe.y)) {
      throw new BrowserRuntimeError("UI_STATE_CHANGED", "The verified Google Maps save-list target did not expose a stable click point");
    }
    point = { x: probe.x, y: probe.y };
  }
  return {
    placeLabel: probe.placeLabel.replace(/\s+/g, " ").trim().slice(0, 240),
    listIndex,
    listLabel: probe.listLabel.replace(/\s+/g, " ").trim().slice(0, 160),
    wasSaved: probe.checked,
    clicked: probe.clicked,
    ...(point ? { point } : {})
  };
}

export function parsePlaceSavePostconditionProbe(
  value: unknown,
  expectedPlaceLabel: string,
  listIndex: number,
  expectedListLabel: string
): boolean | undefined {
  const parsed = parsePlaceSaveActionProbe(value, expectedPlaceLabel, listIndex, expectedListLabel);
  if (!parsed) return undefined;
  return parsed.wasSaved;
}

async function readFreshChooserState(
  runtime: MapsBrowserRuntime,
  expectedPlaceLabel: string,
  client: Awaited<ReturnType<MapsBrowserRuntime["getClient"]>>,
  deadline: number
): Promise<PlaceSaveStateResult> {
  for (;;) {
    await runtime.assertReadableView("place");
    const result = await client.Runtime.evaluate({
      expression: placeSaveReadExpression(expectedPlaceLabel),
      returnByValue: true,
      awaitPromise: true
    });
    const parsed = parsePlaceSaveStateProbe(result.result.value, expectedPlaceLabel);
    if (parsed) return parsed;
    if (Date.now() >= deadline) {
      throw new BrowserRuntimeError("UI_ELEMENT_NOT_FOUND", "The Google Maps save-list chooser did not become ready");
    }
    await sleep(100);
  }
}

async function reopenChooserForVerification(
  runtime: MapsBrowserRuntime,
  expectedPlaceLabel: string,
  client: Awaited<ReturnType<MapsBrowserRuntime["getClient"]>>,
  timeoutMs = 2_000
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    await runtime.assertReadableView("place");
    const opened = await client.Runtime.evaluate({
      expression: placeSaveOpenExpression(expectedPlaceLabel),
      returnByValue: true,
      awaitPromise: true
    });
    const value = opened.result.value as { ok?: unknown; reason?: unknown } | undefined;
    if (value?.ok === true) return;
    if ((value?.reason === "missing_save" || value?.reason === "pending") && Date.now() < deadline) {
      await sleep(POLL_INTERVAL_MS);
      continue;
    }
    parsePlaceSaveStateProbe({ ...value, rows: [], total: 0 }, expectedPlaceLabel);
  }
}

export async function saveVerifiedPlaceToExistingList(
  runtime: MapsBrowserRuntime,
  expectedPlaceLabelInput: string,
  listIndex: number,
  expectedListLabelInput: string,
  timing: { postconditionTimeoutMs?: number; pollIntervalMs?: number } = {}
): Promise<PlaceSaveToListResult> {
  const expectedPlaceLabel = normalizeExpectedPlaceLabel(expectedPlaceLabelInput);
  const postconditionTimeoutMs = timing.postconditionTimeoutMs ?? POSTCONDITION_TIMEOUT_MS;
  const pollIntervalMs = timing.pollIntervalMs ?? POLL_INTERVAL_MS;
  const expectedListLabel = expectedListLabelInput.replace(/\s+/g, " ").trim().slice(0, 160);
  if (!expectedListLabel) throw new Error("expectedListLabel must not be empty");
  if (!Number.isInteger(listIndex) || listIndex < 0 || listIndex >= PLACE_SAVE_MAX_LISTS) {
    throw new Error(`listIndex must be an integer between 0 and ${PLACE_SAVE_MAX_LISTS - 1}`);
  }
  if (isNewListLabel(expectedListLabel)) {
    throw new BrowserRuntimeError("UI_STATE_CHANGED", "New-list creation is not an allowed V5-C save target");
  }

  await runtime.assertReadableView("place");
  if (runtime.getViewState() !== "place") {
    throw new BrowserRuntimeError(
      "UI_STATE_CHANGED",
      "A selected place is not active. Re-run the bounded place workflow and select the intended place again."
    );
  }
  assertAuthenticatedSaveReadiness(await runtime.readAuthenticatedReadiness());
  const resourceEpoch = runtime.getResourceEpoch();
  const client = await runtime.getClient();

  let clickAttempted = false;
  try {
    await reopenChooserForVerification(runtime, expectedPlaceLabel, client);
    const freshState = await readFreshChooserState(runtime, expectedPlaceLabel, client, Date.now() + 2_000);
    const target = resolveFreshPlaceSaveTarget(freshState, expectedPlaceLabel, listIndex, expectedListLabel);

    if (runtime.getResourceEpoch() !== resourceEpoch) {
      throw new BrowserRuntimeError("UI_STATE_CHANGED", "The Maps resource epoch changed before the save action; reissue the semantic workflow");
    }
    if (target.alreadySaved) {
      return {
        saved: true,
        alreadySaved: true,
        placeLabel: target.placeLabel,
        listIndex,
        listLabel: target.listLabel,
        source: "google_maps_save_menu"
      };
    }

    await runtime.assertReadableView("place");
    if (runtime.getResourceEpoch() !== resourceEpoch) {
      throw new BrowserRuntimeError("UI_STATE_CHANGED", "The Maps resource epoch changed immediately before the save click; refusing stale action replay");
    }
    // Revalidate the exact row and obtain only its bounded viewport click point first.
    // The actual mutation is performed with CDP Input so Google Maps receives a trusted
    // pointer event rather than a synthetic HTMLElement.click().
    const actionEval = await client.Runtime.evaluate({
      expression: targetExpression(expectedPlaceLabel, listIndex, expectedListLabel, true),
      returnByValue: true,
      awaitPromise: true
    });
    const action = parsePlaceSaveActionProbe(actionEval.result.value, expectedPlaceLabel, listIndex, expectedListLabel);
    if (!action) {
      throw new BrowserRuntimeError("UI_STATE_CHANGED", "The save-list chooser disappeared before the bounded save click");
    }
    if (action.wasSaved) {
      return {
        saved: true,
        alreadySaved: true,
        placeLabel: action.placeLabel,
        listIndex,
        listLabel: action.listLabel,
        source: "google_maps_save_menu"
      };
    }
    if (action.clicked || !action.point) {
      throw new BrowserRuntimeError("UI_STATE_CHANGED", "The save target changed immediately before the bounded save click");
    }

    // From the first pointer dispatch onward, conservatively assume the mutation may
    // have happened even if CDP fails afterward. Never auto-replay this click.
    clickAttempted = true;
    await client.Input.dispatchMouseEvent({
      type: "mousePressed",
      x: action.point.x,
      y: action.point.y,
      button: "left",
      buttons: 1,
      clickCount: 1
    });
    await client.Input.dispatchMouseEvent({
      type: "mouseReleased",
      x: action.point.x,
      y: action.point.y,
      button: "left",
      buttons: 0,
      clickCount: 1
    });
    // Let Google Maps finish the trusted row activation before probing/reopening the
    // chooser. Reopening during the close/update transition can race the save state.
    await sleep(200);

    let reopened = false;
    const deadline = Date.now() + postconditionTimeoutMs;
    for (;;) {
      await runtime.assertReadableView("place");
      const post = await client.Runtime.evaluate({
        expression: targetExpression(expectedPlaceLabel, listIndex, expectedListLabel, false),
        returnByValue: true,
        awaitPromise: true
      });
      const verified = parsePlaceSavePostconditionProbe(post.result.value, expectedPlaceLabel, listIndex, expectedListLabel);
      if (verified === true) {
        runtime.markSemanticMutation();
        return {
          saved: true,
          alreadySaved: false,
          placeLabel: action.placeLabel,
          listIndex,
          listLabel: action.listLabel,
          source: "google_maps_save_menu"
        };
      }
      if (verified === undefined && !reopened) {
        await reopenChooserForVerification(runtime, expectedPlaceLabel, client);
        reopened = true;
        continue;
      }
      if (Date.now() >= deadline) {
        throw new BrowserRuntimeError(
          "UI_STATE_CHANGED",
          "Google Maps did not verify saved=true for the exact requested existing list before the postcondition timeout"
        );
      }
      await sleep(pollIntervalMs);
    }
  } catch (error) {
    if (clickAttempted && !runtime.getActiveIntervention()) runtime.invalidateSemanticContext();
    throw error;
  } finally {
    await closePlaceSaveMenu(runtime).catch(() => undefined);
  }
}
