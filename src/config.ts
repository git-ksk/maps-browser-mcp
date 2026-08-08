import os from "node:os";
import path from "node:path";

function envBool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  return ["1", "true", "yes", "on"].includes(raw.toLowerCase());
}

function envInt(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return parsed;
}

function envList(name: string, fallback: string[]): string[] {
  const raw = process.env[name];
  if (!raw) return fallback;
  return raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

export interface AppConfig {
  http: {
    host: string;
    port: number;
    allowedHosts: string[];
    allowedOrigins: string[];
    bearerToken?: string;
  };
  browser: {
    executable?: string;
    profileDir: string;
    externalCdpPort?: number;
    headless: boolean;
  };
  policy: {
    interactiveAssist: boolean;
    maxActionsPerMinute: number;
    maxAxNodes: number;
    maxReadChars: number;
  };
}

export function loadConfig(): AppConfig {
  const externalPortRaw = process.env.MAPS_CDP_PORT;
  const externalCdpPort = externalPortRaw
    ? envInt("MAPS_CDP_PORT", 9222, 1, 65535)
    : undefined;

  return {
    http: {
      host: process.env.MCP_HTTP_HOST ?? "127.0.0.1",
      port: envInt("MCP_HTTP_PORT", 8787, 1, 65535),
      allowedHosts: envList("MCP_ALLOWED_HOSTS", ["localhost", "127.0.0.1"]),
      allowedOrigins: envList("MCP_ALLOWED_ORIGINS", []),
      bearerToken: process.env.MCP_BEARER_TOKEN || undefined
    },
    browser: {
      executable: process.env.MAPS_CHROME_EXECUTABLE || undefined,
      profileDir:
        process.env.MAPS_CHROME_PROFILE_DIR ??
        path.join(os.homedir(), ".maps-browser-mcp", "chrome-profile"),
      externalCdpPort,
      headless: envBool("MAPS_HEADLESS", false)
    },
    policy: {
      interactiveAssist: envBool("INTERACTIVE_ASSIST_MODE", false),
      maxActionsPerMinute: envInt("MAPS_MAX_ACTIONS_PER_MINUTE", 30, 1, 300),
      maxAxNodes: envInt("MAPS_MAX_AX_NODES", 120, 20, 500),
      maxReadChars: envInt("MAPS_MAX_READ_CHARS", 1800, 300, 8000)
    }
  };
}
