import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ChromeProcess } from "../dist/browser/chrome-process.js";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function removeDirectoryWithRetry(directory) {
  let lastError;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      await fsp.rm(directory, { recursive: true, force: true });
      return;
    } catch (error) {
      lastError = error;
      const code = error && typeof error === "object" ? error.code : undefined;
      if (!["ENOTEMPTY", "EBUSY", "EPERM"].includes(code)) throw error;
      await sleep(100 * (attempt + 1));
    }
  }
  throw lastError;
}

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
  await sleep(200);
  await removeDirectoryWithRetry(profileDir);
}
