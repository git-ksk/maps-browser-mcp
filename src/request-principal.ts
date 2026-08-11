import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import type { AuthPrincipal } from "./auth-provider.js";

const principalContext = new AsyncLocalStorage<AuthPrincipal>();

export function runWithRequestPrincipal<T>(principal: AuthPrincipal, callback: () => T): T {
  return principalContext.run(principal, callback);
}

export function currentRequestPrincipal(): AuthPrincipal | undefined {
  return principalContext.getStore();
}

export function principalBinding(principal: AuthPrincipal): string {
  return createHash("sha256")
    .update("maps-browser-mcp/principal/v1\0")
    .update(principal.subject)
    .digest("base64url");
}
