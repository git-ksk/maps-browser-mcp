import { timingSafeEqual } from "node:crypto";

function normalizeHostname(value: string): string {
  let normalized = value.trim().toLowerCase();
  if (normalized.startsWith("[") && normalized.endsWith("]")) {
    normalized = normalized.slice(1, -1);
  }
  return normalized.replace(/\.$/, "");
}

function bearerCredential(authorizationHeader: string | undefined): string | undefined {
  if (!authorizationHeader) return undefined;
  const match = /^Bearer +(\S+)$/i.exec(authorizationHeader);
  return match?.[1];
}

export function hostnameFromHostHeader(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    return normalizeHostname(new URL(`http://${value}`).hostname);
  } catch {
    return undefined;
  }
}

export function hostAllowed(hostHeader: string | undefined, allowedHosts: string[]): boolean {
  const hostname = hostnameFromHostHeader(hostHeader);
  if (!hostname) return false;
  return allowedHosts.map(normalizeHostname).includes(hostname);
}

export function originAllowed(
  originHeader: string | undefined,
  allowedOrigins: string[],
  allowedHosts: string[]
): boolean {
  if (!originHeader) return true;
  try {
    const parsed = new URL(originHeader);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    if (allowedOrigins.length > 0) return allowedOrigins.includes(parsed.origin);
    return allowedHosts.map(normalizeHostname).includes(normalizeHostname(parsed.hostname));
  } catch {
    return false;
  }
}

export function bearerAllowed(authorizationHeader: string | undefined, expected?: string): boolean {
  if (!expected) return true;
  const supplied = bearerCredential(authorizationHeader);
  if (!supplied) return false;
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function parseContentLength(value: string | undefined, maxBytes: number): number | undefined {
  if (value === undefined) return undefined;
  if (!/^\d+$/.test(value.trim())) throw new Error("invalid_content_length");
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error("invalid_content_length");
  if (parsed > maxBytes) throw new Error("request_body_too_large");
  return parsed;
}
