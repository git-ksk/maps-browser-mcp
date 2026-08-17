import type { TravelMode } from "../types.js";
import { assertAuthenticatedSaveReadiness } from "./place-save-state.js";
import { BrowserRuntimeError, type MapsBrowserRuntime } from "./runtime.js";

export const ROUTE_SEND_MAX_DEVICES = 6;
const SEND_CONTROL_LABELS = [
  "Send directions to your phone",
  "Send directions to phone",
  "Send to your phone",
  "モバイル デバイスにルートを送信",
  "スマートフォンにルートを送信"
] as const;
const CLOSE_LABELS = ["Close", "Cancel", "閉じる", "キャンセル"] as const;
const EMAIL_MARKERS = ["email", "e-mail", "mail", "メール"] as const;
const OPEN_TIMEOUT_MS = 2_500;
const POSTCONDITION_TIMEOUT_MS = 3_000;
const POLL_INTERVAL_MS = 100;

function sleep(ms: number): Promise<void> { return new Promise((resolve) => setTimeout(resolve, ms)); }
function normalize(value: string): string { return value.replace(/[\uE000-\uF8FF]/g, "").replace(/\s+/g, " ").trim().toLocaleLowerCase(); }
function clean(value: string, max: number): string { return value.replace(/[\uE000-\uF8FF]/g, "").replace(/\s+/g, " ").trim().slice(0, max); }
function expectedEndpoint(value: string, name: string): string {
  const result = clean(value, 300);
  if (!result) throw new BrowserRuntimeError("UI_STATE_CHANGED", `${name} is empty or invalid`);
  return result;
}
function expectedRouteLabel(value: string): string {
  const result = clean(value, 240);
  if (!result) throw new BrowserRuntimeError("UI_STATE_CHANGED", "expectedRouteLabel is empty or invalid");
  return result;
}
function expectedDeviceLabel(value: string): string {
  const result = clean(value, 160);
  if (!result) throw new BrowserRuntimeError("UI_STATE_CHANGED", "expectedDeviceLabel is empty or invalid");
  if (result.includes("@") || EMAIL_MARKERS.some((marker) => normalize(result).includes(marker))) {
    throw new BrowserRuntimeError("UI_STATE_CHANGED", "Email targets are outside the V5-D device-only send scope");
  }
  return result;
}

export interface RouteSendIdentity {
  expectedOrigin: string;
  expectedDestination: string;
  expectedRouteIndex: number;
  expectedRouteLabel: string;
}
export interface RouteSendDeviceTarget { index: number; label: string; }
export interface RouteSendTargetsResult {
  origin: string; destination: string; mode: TravelMode; routeIndex: number; routeLabel: string;
  devices: RouteSendDeviceTarget[]; truncated: boolean; source: "google_maps_send_to_phone_dialog";
}
export interface RouteSendActionInput extends RouteSendIdentity { deviceIndex: number; expectedDeviceLabel: string; }
export interface RouteSendResult {
  sent: true; origin: string; destination: string; mode: TravelMode; routeIndex: number; routeLabel: string;
  deviceIndex: number; deviceLabel: string; source: "google_maps_send_to_phone_dialog";
}

async function assertSelectedSimpleRoute(runtime: MapsBrowserRuntime, input: RouteSendIdentity) {
  const origin = expectedEndpoint(input.expectedOrigin, "expectedOrigin");
  const destination = expectedEndpoint(input.expectedDestination, "expectedDestination");
  const routeLabel = expectedRouteLabel(input.expectedRouteLabel);
  if (!Number.isInteger(input.expectedRouteIndex) || input.expectedRouteIndex < 0 || input.expectedRouteIndex > 11) {
    throw new BrowserRuntimeError("UI_STATE_CHANGED", "expectedRouteIndex is outside the bounded route candidate range");
  }
  await runtime.assertDirectionsContext();
  if (runtime.getViewState() !== "route") {
    throw new BrowserRuntimeError("UI_STATE_CHANGED", "A selected route detail view is not active. Re-read route candidates and select the intended route first.");
  }
  assertAuthenticatedSaveReadiness(await runtime.readAuthenticatedReadiness());
  const last = runtime.getLastAction();
  if (!last || last.kind !== "directions" || last.origin === undefined || (last.waypoints?.length ?? 0) !== 0 ||
      (last.avoid?.length ?? 0) !== 0 || normalize(last.origin) !== normalize(origin) || normalize(last.destination) !== normalize(destination)) {
    throw new BrowserRuntimeError("UI_STATE_CHANGED", "The selected Google Maps route no longer matches the expected simple single-destination directions identity");
  }
  const selected = runtime.getSelectedRoute();
  if (!selected || selected.index !== input.expectedRouteIndex || normalize(selected.label) !== normalize(routeLabel)) {
    throw new BrowserRuntimeError("UI_STATE_CHANGED", "The selected Google Maps route identity changed before Send to phone");
  }
  return { origin, destination, mode: last.mode, routeIndex: selected.index, routeLabel: selected.label };
}

export function parseRouteSendTargetsProbe(value: unknown): RouteSendDeviceTarget[] | undefined {
  const probe = value as { ok?: unknown; reason?: unknown; rows?: unknown; total?: unknown } | null | undefined;
  if (probe?.reason === "pending") return undefined;
  if (probe?.ok !== true || !Array.isArray(probe.rows) || typeof probe.total !== "number") {
    if (["ambiguous_dialog", "ambiguous_device_structure", "duplicate_device", "email_only"].includes(String(probe?.reason))) {
      throw new BrowserRuntimeError("UI_STATE_CHANGED", "The Send to phone device surface changed or became ambiguous; refusing to guess");
    }
    throw new BrowserRuntimeError("UI_ELEMENT_NOT_FOUND", "The verified Send to phone device dialog was not found");
  }
  const devices: RouteSendDeviceTarget[] = []; const seen = new Set<string>();
  for (const [index, raw] of probe.rows.slice(0, ROUTE_SEND_MAX_DEVICES).entries()) {
    const row = raw as { label?: unknown };
    if (typeof row.label !== "string") throw new BrowserRuntimeError("UI_STATE_CHANGED", "Google Maps returned an invalid device target identity");
    const label = expectedDeviceLabel(row.label); const key = normalize(label);
    if (seen.has(key)) throw new BrowserRuntimeError("UI_STATE_CHANGED", "Google Maps returned duplicate device target identities");
    seen.add(key); devices.push({ index, label });
  }
  return devices;
}

export function resolveFreshRouteSendTarget(devices: RouteSendDeviceTarget[], deviceIndex: number, expectedLabelInput: string): RouteSendDeviceTarget {
  const expectedLabel = expectedDeviceLabel(expectedLabelInput);
  if (!Number.isInteger(deviceIndex) || deviceIndex < 0 || deviceIndex >= ROUTE_SEND_MAX_DEVICES) {
    throw new BrowserRuntimeError("UI_STATE_CHANGED", "The requested device index is outside the bounded fresh device state");
  }
  const row = devices[deviceIndex];
  if (!row || row.index !== deviceIndex) throw new BrowserRuntimeError("UI_STATE_CHANGED", "The requested Send to phone device row is missing or reordered");
  if (normalize(row.label) !== normalize(expectedLabel)) throw new BrowserRuntimeError("UI_STATE_CHANGED", "The requested device identity changed or its index became stale");
  if (devices.filter((candidate) => normalize(candidate.label) === normalize(expectedLabel)).length !== 1) {
    throw new BrowserRuntimeError("UI_STATE_CHANGED", "The requested device identity is duplicate or ambiguous");
  }
  return row;
}

function openSendDialogExpression(): string {
  const labels = JSON.stringify(SEND_CONTROL_LABELS.map(normalize));
  return `(() => {
    const visible=(el)=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none'};
    const clean=(v)=>String(v||'').replace(/[\\uE000-\\uF8FF]/g,'').replace(/\\s+/g,' ').trim();
    const norm=(v)=>clean(v).toLocaleLowerCase(); const allowed=new Set(${labels});
    const buttons=[...document.querySelectorAll('button,[role="button"]')].filter(visible).slice(0,180)
      .filter((el)=>allowed.has(norm(el.getAttribute('aria-label')||el.textContent||'')));
    if(buttons.length===0)return {ok:false,reason:'pending'};
    if(buttons.length!==1)return {ok:false,reason:'ambiguous_send_control'};
    buttons[0].click(); return {ok:true};
  })()`;
}

function readSendDialogExpression(): string {
  const closes = JSON.stringify(CLOSE_LABELS.map(normalize));
  const emailMarkers = JSON.stringify(EMAIL_MARKERS.map(normalize));
  return `(() => {
    const visible=(el)=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none'};
    const clean=(v)=>String(v||'').replace(/[\\uE000-\\uF8FF]/g,'').replace(/\\s+/g,' ').trim(); const norm=(v)=>clean(v).toLocaleLowerCase();
    const dialogs=[...document.querySelectorAll('[role="dialog"]')].filter(visible).slice(0,8);
    if(dialogs.length===0)return {ok:false,reason:'pending'}; if(dialogs.length!==1)return {ok:false,reason:'ambiguous_dialog'};
    const closeLabels=new Set(${closes}); const emailMarkers=${emailMarkers};
    const buttons=[...dialogs[0].querySelectorAll('button,[role="button"]')].filter(visible).slice(0,40); const rows=[]; let emailCount=0;
    for(const el of buttons){
      if(el.getAttribute('role')==='checkbox')continue;
      const label=clean(el.getAttribute('aria-label')||el.textContent||'').slice(0,160); const key=norm(label);
      if(!label||closeLabels.has(key))continue;
      if(label.includes('@')||emailMarkers.some((marker)=>key.includes(marker))){emailCount++;continue;}
      rows.push({label});
    }
    if(rows.length===0&&emailCount>0)return {ok:false,reason:'email_only'}; if(rows.length===0)return {ok:false,reason:'pending'};
    const seen=new Set(); for(const row of rows){const key=norm(row.label);if(!key||seen.has(key))return {ok:false,reason:'duplicate_device'};seen.add(key);}
    return {ok:true,rows:rows.slice(0,${ROUTE_SEND_MAX_DEVICES}),total:rows.length};
  })()`;
}

function targetDeviceExpression(deviceIndex: number, expectedDeviceLabel: string, click: boolean): string {
  const expected = JSON.stringify(normalize(expectedDeviceLabel));
  const closes = JSON.stringify(CLOSE_LABELS.map(normalize));
  const emailMarkers = JSON.stringify(EMAIL_MARKERS.map(normalize));
  return `(() => {
    const visible=(el)=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none'};
    const clean=(v)=>String(v||'').replace(/[\\uE000-\\uF8FF]/g,'').replace(/\\s+/g,' ').trim(); const norm=(v)=>clean(v).toLocaleLowerCase();
    const dialogs=[...document.querySelectorAll('[role="dialog"]')].filter(visible).slice(0,8);
    if(dialogs.length===0)return {ok:false,reason:'pending'}; if(dialogs.length!==1)return {ok:false,reason:'ambiguous_dialog'};
    const closeLabels=new Set(${closes}); const emailMarkers=${emailMarkers}; const buttons=[...dialogs[0].querySelectorAll('button,[role="button"]')].filter(visible).slice(0,40); const rows=[];
    for(const el of buttons){
      if(el.getAttribute('role')==='checkbox')continue;
      const label=clean(el.getAttribute('aria-label')||el.textContent||'').slice(0,160); const key=norm(label);
      if(!label||closeLabels.has(key)||label.includes('@')||emailMarkers.some((marker)=>key.includes(marker)))continue; rows.push({el,label});
    }
    const seen=new Set(); for(const row of rows){const key=norm(row.label);if(!key||seen.has(key))return {ok:false,reason:'duplicate_device'};seen.add(key);}
    if(${deviceIndex}<0||${deviceIndex}>=rows.length||${deviceIndex}>=${ROUTE_SEND_MAX_DEVICES})return {ok:false,reason:'target_missing'};
    const target=rows[${deviceIndex}]; if(norm(target.label)!==${expected})return {ok:false,reason:'target_mismatch'};
    if(${click ? "true" : "false"})target.el.click(); return {ok:true,index:${deviceIndex},label:target.label,clicked:${click ? "true" : "false"}};
  })()`;
}

export function parseRouteSendActionProbe(value: unknown, deviceIndex: number, expectedDeviceLabelInput: string): { index: number; label: string; clicked: boolean } | undefined {
  const expectedLabel = expectedDeviceLabel(expectedDeviceLabelInput);
  const probe = value as { ok?: unknown; reason?: unknown; index?: unknown; label?: unknown; clicked?: unknown } | null | undefined;
  if (probe?.reason === "pending") return undefined;
  if (probe?.ok !== true || typeof probe.index !== "number" || typeof probe.label !== "string" || typeof probe.clicked !== "boolean") {
    if (["ambiguous_dialog", "duplicate_device", "target_missing", "target_mismatch"].includes(String(probe?.reason))) {
      throw new BrowserRuntimeError("UI_STATE_CHANGED", "The approved Send to phone device target changed or became ambiguous");
    }
    throw new BrowserRuntimeError("UI_ELEMENT_NOT_FOUND", "The approved Send to phone device target was not found");
  }
  if (probe.index !== deviceIndex || normalize(probe.label) !== normalize(expectedLabel)) {
    throw new BrowserRuntimeError("UI_STATE_CHANGED", "The approved Send to phone device identity changed before the click");
  }
  return { index: probe.index, label: clean(probe.label, 160), clicked: probe.clicked };
}

function sendConfirmationSnapshotExpression(): string {
  return `(() => {
    const visible=(el)=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none'};
    const clean=(v)=>String(v||'').replace(/[\\uE000-\\uF8FF]/g,'').replace(/\\s+/g,' ').trim();
    const live=[...document.querySelectorAll('[role="status"],[role="alert"],[aria-live="polite"],[aria-live="assertive"]')].filter(visible).slice(0,24);
    const seen=new Set(); const texts=[];
    for(const el of live){
      const text=clean(el.getAttribute('aria-label')||el.textContent||'').slice(0,240);
      const key=text.toLocaleLowerCase();
      if(!text||seen.has(key))continue; seen.add(key); texts.push(text);
    }
    return {ok:true,texts};
  })()`;
}

export function parseRouteSendConfirmationSnapshot(value: unknown): string[] {
  const probe = value as { ok?: unknown; texts?: unknown } | null | undefined;
  if (probe?.ok !== true || !Array.isArray(probe.texts)) {
    throw new BrowserRuntimeError("UI_STATE_CHANGED", "The Send to phone confirmation surface could not be bounded before the device click");
  }
  const seen = new Set<string>();
  const texts: string[] = [];
  for (const raw of probe.texts.slice(0, 24)) {
    if (typeof raw !== "string") throw new BrowserRuntimeError("UI_STATE_CHANGED", "The Send to phone confirmation surface returned invalid text");
    const text = clean(raw, 240);
    if (!text) continue;
    const key = normalize(text);
    if (seen.has(key)) continue;
    seen.add(key);
    texts.push(text);
  }
  return texts;
}

export function parseRouteSendPostconditionProbe(
  value: unknown,
  expectedDeviceLabelInput: string,
  baselineInput: string[]
): boolean | undefined {
  const current = parseRouteSendConfirmationSnapshot(value);
  const expectedDevice = normalize(expectedDeviceLabel(expectedDeviceLabelInput));
  const baseline = new Set(baselineInput.map(normalize));
  const confirmed = current.filter((text) => {
    const normalized = normalize(text);
    if (baseline.has(normalized) || !normalized.includes(expectedDevice)) return false;
    return /sent|send complete|送信|送信済み|送信されました/i.test(text);
  });
  if (confirmed.length === 1) return true;
  if (confirmed.length > 1) {
    throw new BrowserRuntimeError("UI_STATE_CHANGED", "The Send to phone confirmation surface became ambiguous");
  }
  return undefined;
}

async function closeSendDialog(runtime: MapsBrowserRuntime): Promise<void> {
  const client = await runtime.getClient();
  await client.Input.dispatchKeyEvent({ type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
  await client.Input.dispatchKeyEvent({ type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
}

async function openAndReadTargets(
  runtime: MapsBrowserRuntime,
  identity: RouteSendIdentity,
  onDialogOpened?: () => void
): Promise<RouteSendTargetsResult> {
  const route = await assertSelectedSimpleRoute(runtime, identity); const client = await runtime.getClient();
  const openDeadline = Date.now() + OPEN_TIMEOUT_MS; let opened = false;
  while (Date.now() < openDeadline) {
    await assertSelectedSimpleRoute(runtime, identity);
    const evaluated = await client.Runtime.evaluate({ expression: openSendDialogExpression(), returnByValue: true, awaitPromise: true });
    const value = evaluated.result.value as { ok?: unknown; reason?: unknown } | undefined;
    if (value?.ok === true) { opened = true; onDialogOpened?.(); break; }
    if (value?.reason === "ambiguous_send_control") throw new BrowserRuntimeError("UI_STATE_CHANGED", "The selected-route Send to phone control became ambiguous");
    await sleep(POLL_INTERVAL_MS);
  }
  if (!opened) throw new BrowserRuntimeError("UI_ELEMENT_NOT_FOUND", "The selected-route Send to phone control did not become ready");
  const deadline = Date.now() + OPEN_TIMEOUT_MS;
  for (;;) {
    await assertSelectedSimpleRoute(runtime, identity);
    const evaluated = await client.Runtime.evaluate({ expression: readSendDialogExpression(), returnByValue: true, awaitPromise: true });
    const devices = parseRouteSendTargetsProbe(evaluated.result.value);
    if (devices) {
      const raw = evaluated.result.value as { total?: unknown };
      return { origin: route.origin, destination: route.destination, mode: route.mode, routeIndex: route.routeIndex, routeLabel: route.routeLabel,
        devices, truncated: typeof raw.total === "number" && raw.total > ROUTE_SEND_MAX_DEVICES, source: "google_maps_send_to_phone_dialog" };
    }
    if (Date.now() >= deadline) throw new BrowserRuntimeError("UI_ELEMENT_NOT_FOUND", "The Send to phone device dialog did not become ready");
    await sleep(POLL_INTERVAL_MS);
  }
}

export async function readVerifiedRouteSendTargets(runtime: MapsBrowserRuntime, identity: RouteSendIdentity): Promise<RouteSendTargetsResult> {
  let dialogOpened = false;
  try { return await openAndReadTargets(runtime, identity, () => { dialogOpened = true; }); }
  finally { if (dialogOpened) await closeSendDialog(runtime).catch(() => undefined); }
}

export async function sendVerifiedRouteToDevice(
  runtime: MapsBrowserRuntime,
  input: RouteSendActionInput,
  approvedEpoch: number,
  consumeApproval: () => void,
  timing: { postconditionTimeoutMs?: number; pollIntervalMs?: number } = {}
): Promise<RouteSendResult> {
  const expectedDevice = expectedDeviceLabel(input.expectedDeviceLabel);
  const postconditionTimeoutMs = timing.postconditionTimeoutMs ?? POSTCONDITION_TIMEOUT_MS;
  const pollIntervalMs = timing.pollIntervalMs ?? POLL_INTERVAL_MS;
  let approvalConsumed = false; let clickAttempted = false; let dialogOpened = false;
  try {
    const fresh = await openAndReadTargets(runtime, input, () => { dialogOpened = true; });
    const target = resolveFreshRouteSendTarget(fresh.devices, input.deviceIndex, expectedDevice);
    await assertSelectedSimpleRoute(runtime, input);
    if (runtime.getResourceEpoch() !== approvedEpoch) throw new BrowserRuntimeError("UI_STATE_CHANGED", "The Maps resource epoch changed after approval; request fresh approval for the current route/device");
    const client = await runtime.getClient();
    const verify = await client.Runtime.evaluate({ expression: targetDeviceExpression(input.deviceIndex, expectedDevice, false), returnByValue: true, awaitPromise: true });
    const verified = parseRouteSendActionProbe(verify.result.value, input.deviceIndex, expectedDevice);
    if (!verified) throw new BrowserRuntimeError("UI_STATE_CHANGED", "The approved device target disappeared before the send action");
    const baselineProbe = await client.Runtime.evaluate({ expression: sendConfirmationSnapshotExpression(), returnByValue: true, awaitPromise: true });
    const confirmationBaseline = parseRouteSendConfirmationSnapshot(baselineProbe.result.value);
    consumeApproval(); approvalConsumed = true; clickAttempted = true;
    const action = await client.Runtime.evaluate({ expression: targetDeviceExpression(input.deviceIndex, expectedDevice, true), returnByValue: true, awaitPromise: true });
    const acted = parseRouteSendActionProbe(action.result.value, input.deviceIndex, expectedDevice);
    if (!acted?.clicked) throw new BrowserRuntimeError("UI_STATE_CHANGED", "Google Maps did not activate the exact approved device target");
    const deadline = Date.now() + postconditionTimeoutMs;
    while (Date.now() < deadline) {
      await runtime.assertMapsSurface();
      const post = await client.Runtime.evaluate({ expression: sendConfirmationSnapshotExpression(), returnByValue: true, awaitPromise: true });
      if (parseRouteSendPostconditionProbe(post.result.value, expectedDevice, confirmationBaseline) === true) {
        runtime.markSemanticMutationWithoutReplayAction();
        return { sent: true, origin: fresh.origin, destination: fresh.destination, mode: fresh.mode, routeIndex: fresh.routeIndex,
          routeLabel: fresh.routeLabel, deviceIndex: target.index, deviceLabel: target.label, source: "google_maps_send_to_phone_dialog" };
      }
      await sleep(pollIntervalMs);
    }
    throw new BrowserRuntimeError("UI_STATE_CHANGED", "Google Maps did not expose an exact Send to phone confirmation for the approved device before timeout; do not automatically retry");
  } catch (error) {
    if ((approvalConsumed || clickAttempted) && !runtime.getActiveIntervention()) runtime.invalidateSemanticContext();
    throw error;
  } finally {
    if (dialogOpened && !clickAttempted) await closeSendDialog(runtime).catch(() => undefined);
  }
}
