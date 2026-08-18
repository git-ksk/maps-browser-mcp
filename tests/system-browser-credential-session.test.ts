import assert from "node:assert/strict";
import test from "node:test";
import { buildCredentialSafeChromeArgs } from "../src/browser/system-browser-credential-session.js";

test("credential-safe normal Chrome uses the dedicated profile without remote debugging or automation flags", () => {
  const args = buildCredentialSafeChromeArgs({
    profileDir: "/tmp/maps-dedicated-profile",
    startUrl: "https://www.google.com/maps"
  });
  assert.ok(args.includes("--user-data-dir=/tmp/maps-dedicated-profile"));
  assert.equal(args.at(-1), "https://www.google.com/maps");
  assert.equal(args.some((value) => value.startsWith("--remote-debugging")), false);
  assert.equal(args.some((value) => /automation/i.test(value)), false);
  assert.equal(args.some((value) => value === "--headless" || value.startsWith("--headless=")), false);
});
