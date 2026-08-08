export class PolicyError extends Error {
  constructor(
    public readonly code:
      | "POLICY_BLOCKED"
      | "RATE_LIMITED"
      | "INTERACTIVE_ASSIST_DISABLED"
      | "NAVIGATION_BLOCKED",
    message: string
  ) {
    super(message);
    this.name = "PolicyError";
  }
}

const BULK_PATTERNS = [
  /\b(scrape|crawl|bulk|dataset|hundreds?|thousands?)\b/i,
  /\b(all|every)\s+(restaurants?|places?|shops?|stores?|reviews?|routes?)\b/i,
  /(全件|大量|網羅|収集|スクレイピング|クローリング|データセット)/,
  /(全部|すべての).*(店舗|店|口コミ|経路|場所)/
];

const MAPS_HOSTS = new Set([
  "www.google.com",
  "google.com",
  "maps.google.com",
  "www.google.co.jp",
  "google.co.jp",
  "maps.google.co.jp"
]);

export class PolicyEngine {
  private readonly actions: number[] = [];

  constructor(
    private readonly options: {
      interactiveAssist: boolean;
      maxActionsPerMinute: number;
    }
  ) {}

  consumeAction(): void {
    const now = Date.now();
    const cutoff = now - 60_000;
    while (this.actions[0] !== undefined && this.actions[0] < cutoff) {
      this.actions.shift();
    }
    if (this.actions.length >= this.options.maxActionsPerMinute) {
      throw new PolicyError(
        "RATE_LIMITED",
        `Action limit reached (${this.options.maxActionsPerMinute} per minute)`
      );
    }
    this.actions.push(now);
  }

  assertSearchQuery(query: string): void {
    if (query.length > 500) {
      throw new PolicyError("POLICY_BLOCKED", "Search queries are limited to 500 characters");
    }
    if (BULK_PATTERNS.some((pattern) => pattern.test(query))) {
      throw new PolicyError(
        "POLICY_BLOCKED",
        "Bulk collection of Google Maps content is not supported"
      );
    }
  }

  assertMapUrl(value: string): void {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new PolicyError("NAVIGATION_BLOCKED", "Invalid navigation URL");
    }
    if (url.protocol !== "https:" || !MAPS_HOSTS.has(url.hostname) || !url.pathname.startsWith("/maps")) {
      throw new PolicyError(
        "NAVIGATION_BLOCKED",
        `Navigation outside the Google Maps web surface is blocked: ${url.hostname}${url.pathname}`
      );
    }
  }

  isAllowedMapsUrl(value: string): boolean {
    try {
      this.assertMapUrl(value);
      return true;
    } catch {
      return false;
    }
  }

  assertInteractiveAssistEnabled(): void {
    if (!this.options.interactiveAssist) {
      throw new PolicyError(
        "INTERACTIVE_ASSIST_DISABLED",
        "Visible-state reading is disabled. Set INTERACTIVE_ASSIST_MODE=true to opt in."
      );
    }
  }
}
