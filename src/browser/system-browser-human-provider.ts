import { randomUUID } from "node:crypto";
import type { ExternalHumanSurfaceProvider } from "mcp-execution-handoff/core";
import { SystemBrowserCredentialSession } from "./system-browser-credential-session.js";

export class SystemBrowserHumanProvider implements ExternalHumanSurfaceProvider {
  readonly kind = "system-browser-credential-safe";

  constructor(
    private readonly browser: SystemBrowserCredentialSession,
    private readonly operatorLocator = "local://dedicated-maps-browser"
  ) {}

  async begin(): Promise<{ sessionId: string; locator: string }> {
    await this.browser.start();
    return { sessionId: randomUUID(), locator: this.operatorLocator };
  }

  async revoke(): Promise<void> {
    await this.browser.close();
  }
}
