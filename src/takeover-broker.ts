import { randomBytes } from "node:crypto";
import type { MapsIntervention } from "./browser/runtime.js";
import { TakeoverSessionError, TakeoverSessionManager } from "./takeover-session.js";

export interface TakeoverBrowserAdapter {
  captureHumanTakeoverFrame(interventionId: string, epoch: number): Promise<{
    data: string;
    width: number;
    height: number;
    hostname: string;
  }>;
  tapHumanTakeover(interventionId: string, epoch: number, x: number, y: number): Promise<void>;
  scrollHumanTakeover(interventionId: string, epoch: number, deltaY: number): Promise<void>;
  insertHumanTakeoverText(interventionId: string, epoch: number, text: string): Promise<void>;
  pressHumanTakeoverKey(interventionId: string, epoch: number, key: string): Promise<void>;
}

export interface TakeoverBrokerConfig {
  enabled: boolean;
  publicBaseUrl?: string;
  ttlMs: number;
}

function privateHeaders(contentType: string): HeadersInit {
  return {
    "content-type": contentType,
    "cache-control": "no-store, max-age=0",
    pragma: "no-cache",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
    "permissions-policy": "camera=(), microphone=(), geolocation=()"
  };
}

function json(status: number, body: object): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: privateHeaders("application/json; charset=utf-8")
  });
}

function pageHtml(nonce: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<title>Maps human takeover</title>
<style nonce="${nonce}">
:root{font-family:system-ui,-apple-system,sans-serif;color-scheme:light dark}body{margin:0;background:Canvas;color:CanvasText}main{max-width:760px;margin:auto;padding:12px}.bar{display:flex;gap:8px;flex-wrap:wrap;align-items:center}.status{font-size:13px;opacity:.8;flex:1}.screen{margin:10px 0;border:1px solid color-mix(in srgb,CanvasText 18%,transparent);border-radius:12px;overflow:hidden;background:#111;touch-action:manipulation}.screen img{display:block;width:100%;height:auto;min-height:180px;object-fit:contain}.controls{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}button,input{font:inherit;min-height:44px;border-radius:10px;border:1px solid color-mix(in srgb,CanvasText 20%,transparent);padding:8px}input{grid-column:1/4;min-width:0}button{cursor:pointer}.wide{grid-column:1/-1}.danger{border-color:#b33}small{display:block;line-height:1.4;opacity:.75;margin-top:10px}
</style>
</head>
<body><main>
<div class="bar"><strong>Human takeover</strong><span id="status" class="status">Connecting…</span></div>
<div id="screen" class="screen"><img id="frame" alt="Live browser view"></div>
<div class="controls">
<button data-scroll="-620">↑ Scroll</button><button data-key="Tab">Tab</button><button data-key="Enter">Enter</button><button data-key="Escape">Esc</button>
<button data-scroll="620">↓ Scroll</button><button data-key="Backspace">⌫</button><button data-key="ArrowUp">↑ key</button><button data-key="ArrowDown">↓ key</button>
<input id="text" autocomplete="off" autocapitalize="none" placeholder="Type into focused browser field"><button id="send">Send</button>
<button id="done" class="wide">Done — return to MCP and choose Continue</button>
</div>
<small>This page controls only the current dedicated Chrome tab. It does not expose CDP, an address bar, cookies, DOM, or network data. Passwords, 2FA codes and CAPTCHA responses stay in the browser interaction and are not sent through MCP.</small>
</main>
<script nonce="${nonce}">
const sessionId=location.pathname.split('/').filter(Boolean).at(-1)||'';
const fragment=new URLSearchParams(location.hash.slice(1));
const cap=fragment.get('cap')||'';
history.replaceState(null,'',location.pathname);
const auth={'authorization':'Takeover '+cap};
const statusEl=document.querySelector('#status');
const frame=document.querySelector('#frame');
const screen=document.querySelector('#screen');
let viewport={width:1,height:1};let stopped=false;let objectUrl='';
function status(text){statusEl.textContent=text}
async function api(path,options={}){const headers={...(options.headers||{}),...auth};const response=await fetch('/takeover/api/'+path+'/'+encodeURIComponent(sessionId),{...options,headers,cache:'no-store'});if(!response.ok)throw new Error('takeover unavailable');return response}
async function refresh(){if(stopped)return;try{const r=await api('frame');viewport={width:Number(r.headers.get('x-takeover-width'))||1,height:Number(r.headers.get('x-takeover-height'))||1};const host=r.headers.get('x-takeover-host')||'Google';const blob=await r.blob();const next=URL.createObjectURL(blob);frame.onload=()=>{if(objectUrl)URL.revokeObjectURL(objectUrl);objectUrl=next};frame.src=next;status(host+' · live');}catch{status('Session unavailable or expired');stopped=true;return}setTimeout(refresh,700)}
async function input(body){try{await api('input',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});setTimeout(refresh,100)}catch{status('Input rejected');stopped=true}}
screen.addEventListener('click',(event)=>{const r=frame.getBoundingClientRect();if(!r.width||!r.height)return;const x=Math.max(0,Math.min(viewport.width,(event.clientX-r.left)*viewport.width/r.width));const y=Math.max(0,Math.min(viewport.height,(event.clientY-r.top)*viewport.height/r.height));void input({kind:'tap',x,y})});
document.querySelectorAll('[data-scroll]').forEach((el)=>el.addEventListener('click',()=>void input({kind:'scroll',deltaY:Number(el.dataset.scroll)})));
document.querySelectorAll('[data-key]').forEach((el)=>el.addEventListener('click',()=>void input({kind:'key',key:el.dataset.key})));
document.querySelector('#send').addEventListener('click',()=>{const field=document.querySelector('#text');const text=field.value;if(text){field.value='';void input({kind:'text',text})}});
document.querySelector('#done').addEventListener('click',async()=>{try{await api('done',{method:'POST'});status('Remote control closed. Return to MCP and choose Continue.');stopped=true}catch{status('Session already closed')}});
if(!cap){status('Missing capability');stopped=true}else{void refresh()}
</script></body></html>`;
}

export class TakeoverBroker {
  private readonly sessions: TakeoverSessionManager;
  private readonly publicOrigin?: string;

  constructor(
    private readonly browser: TakeoverBrowserAdapter,
    private readonly config: TakeoverBrokerConfig
  ) {
    this.sessions = new TakeoverSessionManager(config.ttlMs);
    this.publicOrigin = config.publicBaseUrl ? new URL(config.publicBaseUrl).origin : undefined;
  }

  isEnabled(): boolean {
    return this.config.enabled;
  }

  isPath(pathname: string): boolean {
    return pathname.startsWith("/takeover/");
  }

  createLink(intervention: Pick<MapsIntervention, "id" | "epoch">): string | undefined {
    if (!this.config.enabled || !this.config.publicBaseUrl) return undefined;
    const grant = this.sessions.ensure(intervention.id, intervention.epoch);
    const url = new URL(`/takeover/${encodeURIComponent(grant.id)}`, this.config.publicBaseUrl);
    url.hash = `cap=${encodeURIComponent(grant.capability)}`;
    return url.toString();
  }

  revokeForIntervention(interventionId: string): void {
    this.sessions.revokeForIntervention(interventionId);
  }

  async handle(request: Request): Promise<Response> {
    if (!this.config.enabled) return json(404, { error: "not_found" });
    const url = new URL(request.url);
    const pageMatch = /^\/takeover\/([A-Za-z0-9-]{8,100})$/.exec(url.pathname);
    if (pageMatch) {
      if (request.method !== "GET" && request.method !== "HEAD") return json(405, { error: "method_not_allowed" });
      const nonce = randomBytes(18).toString("base64url");
      const headers = new Headers(privateHeaders("text/html; charset=utf-8"));
      headers.set(
        "content-security-policy",
        `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; img-src 'self' blob: data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`
      );
      return new Response(request.method === "HEAD" ? null : pageHtml(nonce), { status: 200, headers });
    }

    const apiMatch = /^\/takeover\/api\/(frame|input|done)\/([A-Za-z0-9-]{8,100})$/.exec(url.pathname);
    if (!apiMatch) return json(404, { error: "not_found" });
    const operation = apiMatch[1];
    const id = apiMatch[2];
    const capability = this.readCapability(request.headers.get("authorization"));
    if (!capability) return json(404, { error: "takeover_unavailable" });

    let grant: ReturnType<TakeoverSessionManager["verify"]>;
    try {
      grant = this.sessions.verify(id, capability);
    } catch (error) {
      if (error instanceof TakeoverSessionError) return json(404, { error: "takeover_unavailable" });
      throw error;
    }

    if (operation === "frame") {
      if (request.method !== "GET") return json(405, { error: "method_not_allowed" });
      try {
        const frame = await this.browser.captureHumanTakeoverFrame(grant.interventionId, grant.epoch);
        const bytes = Buffer.from(frame.data, "base64");
        if (bytes.byteLength > 2_000_000) return json(503, { error: "frame_too_large" });
        const headers = new Headers(privateHeaders("image/jpeg"));
        headers.set("x-takeover-width", String(frame.width));
        headers.set("x-takeover-height", String(frame.height));
        headers.set("x-takeover-host", frame.hostname.slice(0, 120));
        return new Response(bytes, { status: 200, headers });
      } catch {
        return json(409, { error: "takeover_state_changed" });
      }
    }

    if (request.method !== "POST") return json(405, { error: "method_not_allowed" });
    if (!this.sameOriginMutation(request)) return json(403, { error: "origin_not_allowed" });

    if (operation === "done") {
      this.sessions.revoke(id);
      return json(200, { done: true });
    }

    const length = Number(request.headers.get("content-length") ?? "0");
    if (Number.isFinite(length) && length > 8_192) return json(413, { error: "request_body_too_large" });
    let body: unknown;
    try {
      const text = await request.text();
      if (Buffer.byteLength(text, "utf8") > 8_192) return json(413, { error: "request_body_too_large" });
      body = JSON.parse(text);
    } catch {
      return json(400, { error: "invalid_json" });
    }

    try {
      await this.dispatchInput(grant.interventionId, grant.epoch, body);
      return json(200, { ok: true });
    } catch {
      return json(409, { error: "takeover_input_rejected" });
    }
  }

  private readCapability(value: string | null): string | undefined {
    const match = /^Takeover ([A-Za-z0-9_-]{32,128})$/.exec(value ?? "");
    return match?.[1];
  }

  private sameOriginMutation(request: Request): boolean {
    if (!this.publicOrigin) return false;
    return request.headers.get("origin") === this.publicOrigin;
  }

  private async dispatchInput(interventionId: string, epoch: number, body: unknown): Promise<void> {
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("invalid_input");
    const input = body as Record<string, unknown>;
    if (input.kind === "tap") {
      const x = Number(input.x);
      const y = Number(input.y);
      if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x > 20_000 || y > 20_000) throw new Error("invalid_tap");
      await this.browser.tapHumanTakeover(interventionId, epoch, x, y);
      return;
    }
    if (input.kind === "scroll") {
      const deltaY = Number(input.deltaY);
      if (!Number.isFinite(deltaY) || Math.abs(deltaY) > 2_000) throw new Error("invalid_scroll");
      await this.browser.scrollHumanTakeover(interventionId, epoch, deltaY);
      return;
    }
    if (input.kind === "text") {
      if (typeof input.text !== "string" || input.text.length === 0 || input.text.length > 2_048) throw new Error("invalid_text");
      await this.browser.insertHumanTakeoverText(interventionId, epoch, input.text);
      return;
    }
    if (input.kind === "key") {
      if (typeof input.key !== "string") throw new Error("invalid_key");
      await this.browser.pressHumanTakeoverKey(interventionId, epoch, input.key);
      return;
    }
    throw new Error("unsupported_input");
  }
}
