import { normalizeExpectedPlaceLabel } from "./place-share.js";
import { BrowserRuntimeError, type MapsBrowserRuntime } from "./runtime.js";
import type { AuthenticatedMapsReadiness } from "./authenticated-readiness.js";

export const PLACE_SAVE_MAX_LISTS = 10;
const SAVE_LABELS = ["save", "saved", "保存", "保存済み"] as const;
export const PLACE_SAVE_MENU_HEADINGS = ["save to list", "リストに保存"] as const;
export const PLACE_SAVE_NEW_LIST_LABELS = ["new list", "create new list", "新しいリスト", "新しいリストを作成"] as const;

export function normalizePlaceSaveIdentity(value: string): string {
  return value.replace(/[\uE000-\uF8FF]/g, "").replace(/\s+/g, " ").trim().toLocaleLowerCase();
}

export interface PlaceSaveListState {
  index: number;
  label: string;
  saved: boolean;
}

export interface PlaceSaveStateResult {
  placeLabel: string;
  lists: PlaceSaveListState[];
  truncated: boolean;
  source: "google_maps_save_menu";
}

export function assertAuthenticatedSaveReadiness(state: AuthenticatedMapsReadiness): void {
  if (state === "signed_in") return;
  throw new BrowserRuntimeError(
    "UI_STATE_CHANGED",
    "The dedicated Google Maps session is not signed in. Complete sign-in as Human and reissue the save-state read."
  );
}

export function parsePlaceSaveStateProbe(value: unknown, expectedLabel: string): PlaceSaveStateResult | undefined {
  const probe = value as {
    ok?: unknown; reason?: unknown; placeLabel?: unknown; rows?: unknown; total?: unknown;
  } | null | undefined;
  if (probe?.reason === "pending") return undefined;
  if (probe?.ok !== true || typeof probe.placeLabel !== "string" || !Array.isArray(probe.rows) || typeof probe.total !== "number") {
    if (["changed", "ambiguous_place", "ambiguous_save", "ambiguous_menu", "ambiguous_list_structure", "duplicate_list", "new_list_in_radio"].includes(String(probe?.reason))) {
      throw new BrowserRuntimeError("UI_STATE_CHANGED", "The active Google Maps place/save-list state changed or became ambiguous; refusing to guess");
    }
    throw new BrowserRuntimeError("UI_ELEMENT_NOT_FOUND", "The verified Google Maps save-list chooser was not found");
  }
  if (normalizePlaceSaveIdentity(probe.placeLabel) !== normalizePlaceSaveIdentity(expectedLabel)) {
    throw new BrowserRuntimeError("UI_STATE_CHANGED", "The active Google Maps place changed before the save-state read");
  }
  const lists: PlaceSaveListState[] = [];
  const seen = new Set<string>();
  for (const [index, raw] of probe.rows.slice(0, PLACE_SAVE_MAX_LISTS).entries()) {
    const row = raw as { label?: unknown; checked?: unknown };
    if (typeof row.label !== "string" || typeof row.checked !== "boolean") {
      throw new BrowserRuntimeError("UI_STATE_CHANGED", "Google Maps returned an invalid save-list identity");
    }
    const label = row.label.replace(/[\uE000-\uF8FF]/g, "").replace(/\s+/g, " ").trim().slice(0, 160);
    const key = normalizePlaceSaveIdentity(label);
    if (PLACE_SAVE_NEW_LIST_LABELS.some((candidate) => normalizePlaceSaveIdentity(candidate) === key)) {
      throw new BrowserRuntimeError("UI_STATE_CHANGED", "Google Maps exposed a new-list control as a save-list row; refusing to treat it as an existing list");
    }
    if (!label || seen.has(key)) {
      throw new BrowserRuntimeError("UI_STATE_CHANGED", "Google Maps returned duplicate or empty save-list identities");
    }
    seen.add(key);
    lists.push({ index, label, saved: row.checked });
  }
  return {
    placeLabel: probe.placeLabel.replace(/\s+/g, " ").trim().slice(0, 240),
    lists,
    truncated: probe.total > PLACE_SAVE_MAX_LISTS,
    source: "google_maps_save_menu"
  };
}

export function placeSaveOpenExpression(expectedLabel: string): string {
  const expected = JSON.stringify(normalizePlaceSaveIdentity(expectedLabel));
  const saveLabels = JSON.stringify(SAVE_LABELS);
  return `(() => {
    const visible = (el) => { const r=el.getBoundingClientRect(); const s=getComputedStyle(el); return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none'; };
    const clean = (v) => String(v||'').replace(/[\\uE000-\\uF8FF]/g,'').replace(/\\s+/g,' ').trim();
    const norm = (v) => clean(v).toLocaleLowerCase();
    const labelOf = (el) => clean(el.getAttribute('aria-label') || el.textContent || '').slice(0,240);
    const mains=[...document.querySelectorAll('[role="main"]')].filter(visible).slice(0,8);
    const matching=mains.map(main=>{ const headings=[...main.querySelectorAll('h1,[role="heading"]')].filter(visible).slice(0,32); const place=headings.map(labelOf).find(x=>norm(x)===${expected}); return place?{main,place}:null; }).filter(Boolean);
    if(matching.length===0)return {ok:false,reason:'changed'};
    if(matching.length!==1)return {ok:false,reason:'ambiguous_place'};
    const allowed=new Set(${saveLabels}); const target=matching[0];
    const buttons=[...target.main.querySelectorAll('button,[role="button"]')].filter(visible).slice(0,96).filter(el=>allowed.has(norm(labelOf(el))));
    if(buttons.length===0)return {ok:false,reason:'missing_save',placeLabel:target.place};
    if(buttons.length!==1)return {ok:false,reason:'ambiguous_save',placeLabel:target.place};
    buttons[0].click(); return {ok:true,placeLabel:target.place};
  })()`;
}

export function placeSaveReadExpression(expectedLabel: string): string {
  const expected = JSON.stringify(normalizePlaceSaveIdentity(expectedLabel));
  const headings = JSON.stringify(PLACE_SAVE_MENU_HEADINGS);
  const newListLabels = JSON.stringify(PLACE_SAVE_NEW_LIST_LABELS.map(normalizePlaceSaveIdentity));
  return `(() => {
    const visible = (el) => { const r=el.getBoundingClientRect(); const s=getComputedStyle(el); return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none'; };
    const clean = (v) => String(v||'').replace(/[\\uE000-\\uF8FF]/g,'').replace(/\\s+/g,' ').trim();
    const norm = (v) => clean(v).toLocaleLowerCase();
    const labelOf = (el) => clean(el.getAttribute('aria-label') || el.textContent || '').slice(0,240);
    const mains=[...document.querySelectorAll('[role="main"]')].filter(visible).slice(0,8);
    const places=mains.flatMap(main=>[...main.querySelectorAll('h1,[role="heading"]')].filter(visible).map(labelOf).filter(x=>norm(x)===${expected}));
    if(places.length===0)return {ok:false,reason:'changed'}; if(places.length!==1)return {ok:false,reason:'ambiguous_place'};
    const allowedHeadings=new Set(${headings});
    const menus=[...document.querySelectorAll('[role="menu"]')].filter(visible).slice(0,8).filter(menu=>[...menu.querySelectorAll('[role="heading"]')].filter(visible).some(h=>allowedHeadings.has(norm(labelOf(h)))));
    if(menus.length===0)return {ok:false,reason:'pending'}; if(menus.length!==1)return {ok:false,reason:'ambiguous_menu'};
    const rows=[...menus[0].querySelectorAll('[role="menuitemradio"]')].filter(visible).slice(0,64);
    const newListLabels=new Set(${newListLabels});
    const parsed=[];
    for(const el of rows){
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
      parsed.push({label:name,checked:checked==='true'});
    }
    const seen=new Set(); for(const row of parsed){const key=norm(row.label);if(!key||seen.has(key))return {ok:false,reason:'duplicate_list'};seen.add(key);}
    return {ok:true,placeLabel:places[0],rows:parsed.slice(0,${PLACE_SAVE_MAX_LISTS}),total:parsed.length};
  })()`;
}

export async function closePlaceSaveMenu(runtime: MapsBrowserRuntime): Promise<void> {
  const client = await runtime.getClient();
  await client.Input.dispatchKeyEvent({ type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
  await client.Input.dispatchKeyEvent({ type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
}

export async function readVerifiedPlaceSaveState(runtime: MapsBrowserRuntime, expectedLabelInput: string): Promise<PlaceSaveStateResult> {
  const expectedLabel = normalizeExpectedPlaceLabel(expectedLabelInput);
  await runtime.assertReadableView("place");
  assertAuthenticatedSaveReadiness(await runtime.readAuthenticatedReadiness());
  const client = await runtime.getClient();
  const opened = await client.Runtime.evaluate({ expression: placeSaveOpenExpression(expectedLabel), returnByValue: true, awaitPromise: true });
  const openValue = opened.result.value as { ok?: unknown; reason?: unknown } | undefined;
  if (openValue?.ok !== true) {
    parsePlaceSaveStateProbe({ ...openValue, rows: [], total: 0 }, expectedLabel);
  }
  const deadline = Date.now() + 2_000;
  try {
    for (;;) {
      const result = await client.Runtime.evaluate({ expression: placeSaveReadExpression(expectedLabel), returnByValue: true, awaitPromise: true });
      const parsed = parsePlaceSaveStateProbe(result.result.value, expectedLabel);
      if (parsed) return parsed;
      if (Date.now() >= deadline) throw new BrowserRuntimeError("UI_ELEMENT_NOT_FOUND", "The Google Maps save-list chooser did not become ready");
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  } finally {
    await closePlaceSaveMenu(runtime).catch(() => undefined);
  }
}
