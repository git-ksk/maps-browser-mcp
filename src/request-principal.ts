import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import type { AuthPrincipal } from "./auth-provider.js";

export interface RequestPrincipal extends AuthPrincipal {
  operationScope?: string;
}

const principalContext = new AsyncLocalStorage<RequestPrincipal>();

export function runWithRequestPrincipal<T>(principal: RequestPrincipal, callback: () => T): T {
  return principalContext.run(principal, callback);
}

export function currentRequestPrincipal(): RequestPrincipal | undefined {
  return principalContext.getStore();
}

export function principalBinding(principal: AuthPrincipal): string {
  return createHash("sha256")
    .update("maps-browser-mcp/principal/v1\0")
    .update(principal.subject)
    .digest("base64url");
}
