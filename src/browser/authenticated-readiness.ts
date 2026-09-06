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
    signedInStableMs?: number;
    now?: () => number;
    wait?: (ms: number) => Promise<void>;
    onStateChange?: (state: AuthenticatedMapsReadiness, elapsedMs: number) => void;
    onComplete?: (summary: {
      finalState: AuthenticatedMapsReadiness;
      elapsedMs: number;
      samples: number;
      signedInSamples: number;
      signedOutSamples: number;
      unknownSamples: number;
      transitions: number;
    }) => void;
  } = {}
): Promise<AuthenticatedMapsReadiness> {
  const timeoutMs = options.timeoutMs ?? 8_000;
  const pollMs = options.pollMs ?? 100;
  const signedInStableMs = options.signedInStableMs ?? 1_000;
  const now = options.now ?? Date.now;
  const wait = options.wait ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const deadline = now() + timeoutMs;
  let last: AuthenticatedMapsReadiness = "unknown";
  let prior: AuthenticatedMapsReadiness | undefined;
  let signedInSince: number | undefined;
  let samples = 0;
  let signedInSamples = 0;
  let signedOutSamples = 0;
  let unknownSamples = 0;
  let transitions = 0;
  const startedAt = now();

  const finish = (finalState: AuthenticatedMapsReadiness, elapsedMs: number) => {
    options.onComplete?.({
      finalState, elapsedMs, samples, signedInSamples, signedOutSamples, unknownSamples, transitions
    });
    return finalState;
  };

  for (;;) {
    last = await read();
    const observedAt = now();
    samples += 1;
    if (last === "signed_in") signedInSamples += 1;
    else if (last === "signed_out") signedOutSamples += 1;
    else unknownSamples += 1;
    if (prior !== last) {
      transitions += 1;
      options.onStateChange?.(last, observedAt - startedAt);
      prior = last;
    }
    if (last === "signed_in") {
      signedInSince ??= observedAt;
      if (observedAt - signedInSince >= signedInStableMs) return finish("signed_in", observedAt - startedAt);
    } else {
      signedInSince = undefined;
    }

    if (observedAt >= deadline) {
      return finish(last === "signed_out" ? "signed_out" : "unknown", observedAt - startedAt);
    }
    await wait(pollMs);
  }
}
