import assert from "node:assert/strict";
import test from "node:test";
import type { ChromeProcess } from "../src/browser/chrome-process.js";
import { BrowserRuntimeError, MapsBrowserRuntime } from "../src/browser/runtime.js";
import type { PolicyEngine } from "../src/policy/policy-engine.js";

function makeRuntime() {
  const chrome = {} as ChromeProcess;
  const policy = {
    isAllowedMapsUrl(value: string) {
      try {
        const url = new URL(value);
        return url.protocol === "https:" && url.hostname === "www.google.com" &&
          (url.pathname === "/maps" || url.pathname.startsWith("/maps/"));
      } catch {
        return false;
      }
    }
  } as PolicyEngine;
  return new MapsBrowserRuntime(chrome, policy);
}

function assertBoundaryCode(url: string, code: BrowserRuntimeError["code"]): void {
  const runtime = makeRuntime();
  const boundary = runtime as unknown as { assertAllowedCurrentUrl(value: string): void };
  assert.throws(
    () => boundary.assertAllowedCurrentUrl(url),
    (error: unknown) => error instanceof BrowserRuntimeError && error.code === code
  );
}

test("challenge URLs stop for human intervention", () => {
  assertBoundaryCode("https://www.google.com/sorry/index?continue=x", "HUMAN_INTERVENTION_REQUIRED");
  assertBoundaryCode("https://recaptcha.google.com/recaptcha/api2/anchor", "HUMAN_INTERVENTION_REQUIRED");
});

test("consent or sign-in surfaces outside Maps stop for human intervention", () => {
  assertBoundaryCode("https://accounts.google.com/signin/v2/identifier", "HUMAN_INTERVENTION_REQUIRED");
  assertBoundaryCode("https://consent.google.com/m", "HUMAN_INTERVENTION_REQUIRED");
});

test("blank browser state is not misclassified as a challenge", () => {
  assertBoundaryCode("about:blank", "MAPS_NOT_OPEN");
});

test("an allowed Maps surface passes the navigation boundary", () => {
  const runtime = makeRuntime();
  const boundary = runtime as unknown as { assertAllowedCurrentUrl(value: string): void };
  assert.doesNotThrow(() => boundary.assertAllowedCurrentUrl("https://www.google.com/maps/search/Tokyo"));
});
