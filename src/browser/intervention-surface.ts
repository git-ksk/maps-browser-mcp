export type GoogleInterventionSurface = "access_challenge" | "sign_in" | "consent";

const GOOGLE_SORRY_HOSTS = new Set([
  "www.google.com",
  "google.com",
  "www.google.co.jp",
  "google.co.jp"
]);

const GOOGLE_RECAPTCHA_HOSTS = new Set([
  "www.google.com",
  "recaptcha.google.com"
]);

const ACCOUNT_EXACT_PATHS = new Set([
  "/",
  "/ServiceLogin",
  "/AccountChooser",
  "/InteractiveLogin"
]);

const ACCOUNT_PATH_PREFIXES = [
  "/signin/",
  "/v3/signin/"
] as const;

function hasPathPrefix(pathname: string, prefixes: readonly string[]): boolean {
  return prefixes.some((prefix) => pathname.startsWith(prefix));
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
  const { pathname } = url;

  if (GOOGLE_SORRY_HOSTS.has(hostname) && pathname.startsWith("/sorry/")) {
    return "access_challenge";
  }
  if (GOOGLE_RECAPTCHA_HOSTS.has(hostname) && pathname.startsWith("/recaptcha/")) {
    return "access_challenge";
  }
  if (
    hostname === "accounts.google.com" &&
    (ACCOUNT_EXACT_PATHS.has(pathname) || hasPathPrefix(pathname, ACCOUNT_PATH_PREFIXES))
  ) {
    return "sign_in";
  }
  if (
    hostname === "consent.google.com" &&
    (pathname === "/m" || pathname.startsWith("/m/"))
  ) {
    return "consent";
  }
  return undefined;
}
