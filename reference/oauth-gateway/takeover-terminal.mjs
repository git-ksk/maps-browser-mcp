import { randomBytes } from "node:crypto";

function terminalHeaders(nonce) {
  return {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store, max-age=0",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
    "content-security-policy": `default-src 'none'; style-src 'nonce-${nonce}'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`
  };
}

export function unavailableTopLevelTakeoverPage(method = "GET") {
  const nonce = randomBytes(16).toString("base64");
  const body = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>Human takeover unavailable</title><style nonce="${nonce}">:root{font-family:system-ui,-apple-system,sans-serif;color-scheme:dark}html,body{margin:0;min-height:100%;background:#000;color:#fff}main{min-height:100vh;display:grid;place-items:center;padding:24px;text-align:center;box-sizing:border-box}.card{max-width:34rem;padding:24px;border:1px solid rgba(255,255,255,.18);border-radius:18px;background:rgba(24,24,24,.96)}h1{font-size:20px;margin:0 0 10px}p{margin:0;line-height:1.55;color:rgba(255,255,255,.78)}</style></head><body><main><section class="card" role="status" aria-live="polite"><h1>This Human takeover is unavailable or has expired.</h1><p>Return to the requesting workflow and start a fresh Human takeover if it is still needed.</p></section></main></body></html>`;
  return new Response(method === "HEAD" ? null : body, {
    status: 200,
    headers: terminalHeaders(nonce)
  });
}

export function responseForUnauthenticatedTopLevelProbe(probe, method, loginPage) {
  if (probe.status === 404 || probe.status === 410) {
    return unavailableTopLevelTakeoverPage(method);
  }
  if (probe.status !== 200) return probe;
  const response = loginPage();
  return method === "HEAD"
    ? new Response(null, { status: response.status, headers: response.headers })
    : response;
}
