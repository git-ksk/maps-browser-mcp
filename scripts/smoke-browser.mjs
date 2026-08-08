import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ChromeProcess } from "../dist/browser/chrome-process.js";

const profileDir = await fsp.mkdtemp(path.join(os.tmpdir(), "maps-browser-mcp-ci-"));
const chrome = new ChromeProcess({ profileDir, headless: true });

try {
  const port = await chrome.start();
  const response = await fetch(`http://127.0.0.1:${port}/json/version`, {
    signal: AbortSignal.timeout(2_000)
  });
  if (!response.ok) throw new Error(`CDP version endpoint returned ${response.status}`);
  const payload = await response.json();
  if (!/(Chrome|Chromium)/i.test(String(payload.Browser ?? ""))) {
    throw new Error(`Unexpected browser product: ${String(payload.Browser ?? "")}`);
  }
  console.log("Chrome/CDP smoke test passed");
} finally {
  await chrome.close().catch(() => undefined);
  await fsp.rm(profileDir, { recursive: true, force: true });
}
