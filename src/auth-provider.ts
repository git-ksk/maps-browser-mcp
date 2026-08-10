import type { IncomingHttpHeaders } from "node:http";
import { bearerAllowed } from "./http-security.js";
import type { AppConfig } from "./config.js";

export interface AuthPrincipal {
  subject: string;
  email?: string;
}

export type AuthDecision =
  | { allowed: true; principal: AuthPrincipal }
  | {
      allowed: false;
      status: 401 | 403;
      code: string;
      headers?: Record<string, string>;
    };

export interface AuthRequestContext {
  method: string;
  url: URL;
  headers: IncomingHttpHeaders;
}

export interface HttpAuthProvider {
  readonly kind: string;
  authorize(request: AuthRequestContext): Promise<AuthDecision>;
  handlesPath?(pathname: string): boolean;
  handle?(request: Request): Promise<Response>;
  close?(): Promise<void>;
}

export interface AuthProviderFactoryContext {
  serverName: "maps-browser-mcp";
  resourcePath: "/mcp";
}

export interface AuthProviderModule {
  createAuthProvider(
    context: AuthProviderFactoryContext
  ): HttpAuthProvider | Promise<HttpAuthProvider>;
}

const STATIC_BEARER_CHALLENGE = 'Bearer realm="maps-browser-mcp"';

function noneProvider(): HttpAuthProvider {
  return {
    kind: "none",
    async authorize() {
      return { allowed: true, principal: { subject: "local" } };
    }
  };
}

function staticBearerProvider(expectedToken: string): HttpAuthProvider {
  return {
    kind: "static-bearer",
    async authorize(request) {
      if (bearerAllowed(request.headers.authorization, expectedToken)) {
        return { allowed: true, principal: { subject: "static-bearer" } };
      }
      return {
        allowed: false,
        status: 401,
        code: "invalid_token",
        headers: { "www-authenticate": STATIC_BEARER_CHALLENGE }
      };
    }
  };
}

function assertProvider(value: unknown, moduleSpecifier: string): HttpAuthProvider {
  if (!value || typeof value !== "object") {
    throw new Error(`Auth provider module ${moduleSpecifier} returned an invalid provider`);
  }
  const provider = value as Partial<HttpAuthProvider>;
  if (typeof provider.kind !== "string" || !provider.kind || typeof provider.authorize !== "function") {
    throw new Error(`Auth provider module ${moduleSpecifier} must return { kind, authorize() }`);
  }
  if ((provider.handlesPath && !provider.handle) || (!provider.handlesPath && provider.handle)) {
    throw new Error(`Auth provider module ${moduleSpecifier} must implement handlesPath() and handle() together`);
  }
  return provider as HttpAuthProvider;
}

export async function createHttpAuthProvider(config: AppConfig): Promise<HttpAuthProvider> {
  if (config.auth.provider === "none") return noneProvider();
  if (config.auth.provider === "static-bearer") {
    if (!config.http.bearerToken) throw new Error("static-bearer auth requires MCP_BEARER_TOKEN");
    return staticBearerProvider(config.http.bearerToken);
  }

  const moduleSpecifier = config.auth.module;
  if (!moduleSpecifier) throw new Error("module auth requires MCP_AUTH_PROVIDER_MODULE");

  const imported = (await import(moduleSpecifier)) as Partial<AuthProviderModule>;
  if (typeof imported.createAuthProvider !== "function") {
    throw new Error(`Auth provider module ${moduleSpecifier} must export createAuthProvider()`);
  }

  return assertProvider(
    await imported.createAuthProvider({ serverName: "maps-browser-mcp", resourcePath: "/mcp" }),
    moduleSpecifier
  );
}
