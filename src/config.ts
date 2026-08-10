import os from "node:os";
import path from "node:path";

function envBool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const normalized = raw.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  throw new Error(`${name} must be a boolean (true/false, 1/0, yes/no, on/off)`);
}

function envInt(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const parsed = Number(raw.trim());
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return parsed;
}

function normalizeHostname(value: string): string {
  let normalized = value.trim().toLowerCase();
  if (normalized.startsWith("[") && normalized.endsWith("]")) {
    normalized = normalized.slice(1, -1);
  }
  normalized = normalized.replace(/\.$/, "");
  if (!normalized || normalized.includes("/") || normalized.includes("://")) {
    throw new Error(`Invalid hostname in MCP_ALLOWED_HOSTS: ${value}`);
  }
  return normalized;
}

function envHosts(name: string, fallback: string[]): string[] {
  const raw = process.env[name];
  const values = raw ? raw.split(",") : fallback;
  return [...new Set(values.map(normalizeHostname).filter(Boolean))];
}

function envOrigins(name: string): string[] {
  const raw = process.env[name];
  if (!raw) return [];
  return [...new Set(raw.split(",").map((value) => {
    const trimmed = value.trim();
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error(`${name} entries must use http or https origins`);
    }
    return url.origin;
  }))];
}

function envAuthProvider(bearerToken: string | undefined): "none" | "static-bearer" | "module" {
  const raw = process.env.MCP_AUTH_PROVIDER?.trim().toLowerCase();
  if (!raw) return bearerToken ? "static-bearer" : "none";
  if (raw === "none" || raw === "static-bearer" || raw === "module") return raw;
  throw new Error("MCP_AUTH_PROVIDER must be one of: none, static-bearer, module");
}

export function isLoopbackBind(host: string): boolean {
  const normalized = normalizeHostname(host);
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1";
}

export interface AppConfig {
  auth: {
    provider: "none" | "static-bearer" | "module";
    module?: string;
  };
  http: {
    host: string;
    port: number;
    allowedHosts: string[];
    allowedOrigins: string[];
    bearerToken?: string;
    maxBodyBytes: number;
  };
  browser: {
    executable?: string;
    profileDir: string;
    externalCdpPort?: number;
    allowExternalCdp: boolean;
    headless: boolean;
    allowUnsandboxedChromium: boolean;
  };
  policy: {
    interactiveAssist: boolean;
    maxActionsPerMinute: number;
    maxVisibleReadsPerHour: number;
    maxPendingActions: number;
    operationTimeoutMs: number;
    maxAxNodes: number;
    maxReadChars: number;
  };
}

export function loadConfig(): AppConfig {
  const allowExternalCdp = envBool("MAPS_ALLOW_EXTERNAL_CDP", false);
  const externalPortRaw = process.env.MAPS_CDP_PORT;
  const externalCdpPort = externalPortRaw
    ? envInt("MAPS_CDP_PORT", 9222, 1, 65535)
    : undefined;
  if (externalCdpPort !== undefined && !allowExternalCdp) {
    throw new Error("MAPS_CDP_PORT requires MAPS_ALLOW_EXTERNAL_CDP=true because attaching to an existing CDP endpoint weakens browser-profile isolation");
  }

  const host = process.env.MCP_HTTP_HOST?.trim() || "127.0.0.1";
  const allowNonLoopback = envBool("MCP_ALLOW_NONLOOPBACK", false);
  const bearerToken = process.env.MCP_BEARER_TOKEN?.trim() || undefined;
  if (bearerToken && bearerToken.length < 24) {
    throw new Error("MCP_BEARER_TOKEN must contain at least 24 characters when configured");
  }
  if (bearerToken && /\s/.test(bearerToken)) {
    throw new Error("MCP_BEARER_TOKEN must not contain whitespace");
  }

  const authProvider = envAuthProvider(bearerToken);
  const authModule = process.env.MCP_AUTH_PROVIDER_MODULE?.trim() || undefined;
  if (authProvider === "static-bearer" && !bearerToken) {
    throw new Error("MCP_AUTH_PROVIDER=static-bearer requires MCP_BEARER_TOKEN");
  }
  if (authProvider === "module" && !authModule) {
    throw new Error("MCP_AUTH_PROVIDER=module requires MCP_AUTH_PROVIDER_MODULE");
  }
  if (authProvider !== "module" && authModule) {
    throw new Error("MCP_AUTH_PROVIDER_MODULE requires MCP_AUTH_PROVIDER=module");
  }
  if (authProvider === "module" && bearerToken) {
    throw new Error("MCP_BEARER_TOKEN cannot be combined with MCP_AUTH_PROVIDER=module because both consume the Authorization header");
  }
  if (authProvider === "none" && bearerToken) {
    throw new Error("MCP_BEARER_TOKEN requires MCP_AUTH_PROVIDER=static-bearer or an unset MCP_AUTH_PROVIDER");
  }

  if (!isLoopbackBind(host)) {
    if (!allowNonLoopback) {
      throw new Error(
        "Non-loopback MCP_HTTP_HOST requires explicit MCP_ALLOW_NONLOOPBACK=true. Prefer a loopback Node server behind an HTTPS tunnel/reverse proxy."
      );
    }
    if (authProvider === "none") {
      throw new Error(
        "Non-loopback MCP_HTTP_HOST requires an HTTP auth provider in addition to MCP_ALLOW_NONLOOPBACK=true. Configure static-bearer or a trusted auth provider module and use HTTPS/TLS."
      );
    }
  }

  const httpPort = process.env.MCP_HTTP_PORT === undefined
    ? envInt("PORT", 8787, 1, 65535)
    : envInt("MCP_HTTP_PORT", 8787, 1, 65535);

  return {
    auth: {
      provider: authProvider,
      module: authModule
    },
    http: {
      host,
      port: httpPort,
      allowedHosts: envHosts("MCP_ALLOWED_HOSTS", ["localhost", "127.0.0.1", "::1"]),
      allowedOrigins: envOrigins("MCP_ALLOWED_ORIGINS"),
      bearerToken,
      maxBodyBytes: envInt("MCP_MAX_BODY_BYTES", 262_144, 1_024, 4_194_304)
    },
    browser: {
      executable: process.env.MAPS_CHROME_EXECUTABLE || undefined,
      profileDir:
        process.env.MAPS_CHROME_PROFILE_DIR ??
        path.join(os.homedir(), ".maps-browser-mcp", "chrome-profile"),
      externalCdpPort,
      allowExternalCdp,
      headless: envBool("MAPS_HEADLESS", false),
      allowUnsandboxedChromium: envBool("MAPS_ALLOW_UNSANDBOXED_CHROMIUM", false)
    },
    policy: {
      interactiveAssist: envBool("INTERACTIVE_ASSIST_MODE", false),
      maxActionsPerMinute: envInt("MAPS_MAX_ACTIONS_PER_MINUTE", 30, 1, 300),
      maxVisibleReadsPerHour: envInt("MAPS_MAX_VISIBLE_READS_PER_HOUR", 30, 1, 240),
      maxPendingActions: envInt("MAPS_MAX_PENDING_ACTIONS", 8, 1, 50),
      operationTimeoutMs: envInt("MAPS_OPERATION_TIMEOUT_MS", 25_000, 5_000, 120_000),
      maxAxNodes: envInt("MAPS_MAX_AX_NODES", 120, 20, 500),
      maxReadChars: envInt("MAPS_MAX_READ_CHARS", 1800, 300, 8000)
    }
  };
}
