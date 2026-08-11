export type GoogleInterventionSurface = "access_challenge" | "sign_in" | "consent";

const SORRY_HOSTS = new Set([
  "www.google.com",
  "google.com",
  "www.google.co.jp",
  "google.co.jp"
]);

const RECAPTCHA_HOSTS = new Set([
  "recaptcha.google.com",
  "www.google.com"
]);

function hasPathPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

function isSignInPath(pathname: string): boolean {
  return pathname === "/" ||
    pathname === "/ServiceLogin" ||
    pathname === "/AccountChooser" ||
    hasPathPrefix(pathname, "/signin") ||
    hasPathPrefix(pathname, "/v3/signin") ||
    hasPathPrefix(pathname, "/challenge") ||
    hasPathPrefix(pathname, "/o/oauth2");
}

function isConsentPath(pathname: string): boolean {
  return pathname === "/" ||
    hasPathPrefix(pathname, "/m") ||
    hasPathPrefix(pathname, "/d") ||
    hasPathPrefix(pathname, "/dl");
}

export function classifyGoogleInterventionSurface(value: string): GoogleInterventionSurface | undefined {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }

  if (url.protocol !== "https:") return undefined;
  const hostname = url.hostname.toLowerCase();

  if (SORRY_HOSTS.has(hostname) && hasPathPrefix(url.pathname, "/sorry")) {
    return "access_challenge";
  }
  if (RECAPTCHA_HOSTS.has(hostname) && hasPathPrefix(url.pathname, "/recaptcha")) {
    return "access_challenge";
  }
  if (hostname === "accounts.google.com" && isSignInPath(url.pathname)) {
    return "sign_in";
  }
  if (hostname === "consent.google.com" && isConsentPath(url.pathname)) {
    return "consent";
  }
  return undefined;
}

export function isAllowedHumanTakeoverSurface(
  value: string,
  isAllowedMapsUrl: (value: string) => boolean
): boolean {
  return isAllowedMapsUrl(value) || classifyGoogleInterventionSurface(value) !== undefined;
}
