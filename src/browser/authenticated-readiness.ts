export type AuthenticatedMapsReadiness = "signed_in" | "signed_out" | "unknown";

interface AuthenticatedReadinessProbe {
  mapsSurface?: unknown;
  hasSignInLink?: unknown;
  hasAccountHref?: unknown;
  hasAccountAria?: unknown;
}

export const AUTHENTICATED_READINESS_EXPRESSION = String.raw`(() => {
  const items = [...document.querySelectorAll('a,button,[role="button"]')].map((el) => ({
    href: el.getAttribute('href') || '',
    aria: el.getAttribute('aria-label') || '',
    text: (el.textContent || '').trim().slice(0, 80)
  }));
  const hasSignInLink = items.some((item) =>
    /accounts\.google\.com\/(ServiceLogin|signin)/i.test(item.href) ||
    /^sign in$/i.test(item.text) ||
    /^sign in$/i.test(item.aria)
  );
  const hasAccountHref = items.some((item) =>
    /accounts\.google\.com\/SignOutOptions/i.test(item.href)
  );
  const hasAccountAria = items.some((item) =>
    /google account/i.test(item.aria) || /google アカウント/i.test(item.aria)
  );
  return {
    mapsSurface: location.pathname === '/maps' || location.pathname.startsWith('/maps/'),
    hasSignInLink,
    hasAccountHref,
    hasAccountAria
  };
})()`;

export function parseAuthenticatedReadiness(value: unknown): AuthenticatedMapsReadiness {
  const probe = value as AuthenticatedReadinessProbe | undefined;
  if (probe?.mapsSurface !== true) return "unknown";
  const hasSignInLink = probe.hasSignInLink === true;
  const hasAccountControl = probe.hasAccountHref === true || probe.hasAccountAria === true;
  if (!hasSignInLink && hasAccountControl) return "signed_in";
  if (hasSignInLink && !hasAccountControl) return "signed_out";
  return "unknown";
}

export async function waitForAuthenticatedReadinessAfterHuman(
  read: () => Promise<AuthenticatedMapsReadiness>,
  options: {
    timeoutMs?: number;
    pollMs?: number;
    now?: () => number;
    wait?: (ms: number) => Promise<void>;
  } = {}
): Promise<AuthenticatedMapsReadiness> {
  const timeoutMs = options.timeoutMs ?? 8_000;
  const pollMs = options.pollMs ?? 100;
  const now = options.now ?? Date.now;
  const wait = options.wait ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const deadline = now() + timeoutMs;
  let last: AuthenticatedMapsReadiness = "unknown";
  for (;;) {
    last = await read();
    if (last === "signed_in") return last;
    if (now() >= deadline) return last;
    await wait(pollMs);
  }
}
