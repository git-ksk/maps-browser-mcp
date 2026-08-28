import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { access, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
import { RTCPeerConnection, useH264 } from "werift";
import { SystemBrowserCredentialSession } from "/app/dist/browser/system-browser-credential-session.js";
import { ChromeProcess } from "/app/dist/browser/chrome-process.js";
import {
  SpawnedWebRtcRuntimeProvider
} from "/app/node_modules/mcp-execution-handoff/dist/browser-takeover/webrtc-runtime.js";
async function exists(value) {
  return access(value).then(() => true, () => false);
}
async function firstExecutable(values) {
  for (const value of values) if (await exists(value)) return value;
  throw new Error(`required executable not found: ${values.join(", ")}`);
}
async function waitFor(label, predicate, timeoutMs = 12e3) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Linux WebRTC acceptance timed out at ${label}`);
}
async function waitForX(displayNumber) {
  const socket = `/tmp/.X11-unix/X${displayNumber}`;
  await waitFor("xvfb-socket", () => exists(socket), 5e3);
}
async function waitForStableAcceptanceWindow(browser, chromePid, xEnv, timeoutMs = 3e4) {
  const deadline = Date.now() + timeoutMs;
  let stableId;
  let stableCount = 0;
  while (Date.now() < deadline) {
    if (!browser?.isActive()) throw new Error("credential-safe normal Chromium exited before window readiness");
    const result = spawnSync("/usr/bin/xdotool", ["search", "--onlyvisible", "--pid", String(chromePid)], { env: xEnv, encoding: "utf8" });
    const ids = result.status === 0 ? result.stdout.trim().split(/\s+/).filter(Boolean) : [];
    if (ids.length === 1) {
      const id = ids[0];
      const title = spawnSync("/usr/bin/xdotool", ["getwindowname", id], { env: xEnv, encoding: "utf8" });
      if (title.status === 0 && title.stdout.includes("Handoff Linux Acceptance")) {
        if (stableId === id) stableCount += 1;
        else { stableId = id; stableCount = 1; }
        if (stableCount >= 3) return id;
      } else {
        stableId = undefined;
        stableCount = 0;
      }
    } else {
      stableId = undefined;
      stableCount = 0;
    }
    await new Promise((resolve) => setTimeout(resolve, 75));
  }
  throw new Error("Linux WebRTC acceptance timed out at stable chrome-window");
}
async function within(label, promise, timeoutMs = 5e3) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`Linux WebRTC acceptance timed out at ${label}`)), timeoutMs))
  ]);
}
async function stopAndWait(child) {
  if (!child || child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    once(child, "exit").catch(() => void 0),
    new Promise((resolve) => setTimeout(resolve, 1e3))
  ]);
  if (child.exitCode === null) {
    child.kill("SIGKILL");
    await Promise.race([
      once(child, "exit").catch(() => void 0),
      new Promise((resolve) => setTimeout(resolve, 500))
    ]);
  }
}
async function cmdline(pid) {
  return (await readFile(`/proc/${pid}/cmdline`)).toString("utf8").replaceAll("\0", " ");
}
async function markerInAnyProcess(marker) {
  for (const entry of await readdir("/proc")) {
    if (!/^\d+$/.test(entry)) continue;
    const value = await readFile(`/proc/${entry}/cmdline`).catch(() => Buffer.alloc(0));
    if (value.includes(Buffer.from(marker))) return true;
  }
  return false;
}
async function main() {
  if (process.platform !== "linux") throw new Error("Linux acceptance must run on Linux");
  const chromeExecutable = await firstExecutable([
    "/usr/bin/google-chrome-stable",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser"
  ]);
  for (const executable of ["/usr/bin/Xvfb", "/usr/bin/xdotool", "/usr/bin/ffmpeg", "/usr/bin/fc-match"]) {
    assert.equal(await exists(executable), true, `${executable} is required`);
  }
  const openboxExecutable = await firstExecutable(["/usr/bin/openbox"]);
  const helper = "/app/node_modules/.bin/handoff-linux-webrtc-host";
  assert.equal(await exists(helper), true, "compiled Linux helper is required");
  const cjkFont = spawnSync("/usr/bin/fc-match", ["-f", "%{family}\n", ":lang=ja"], { encoding: "utf8" });
  assert.equal(cjkFont.status, 0, "CJK font fallback lookup failed");
  assert.match(cjkFont.stdout, /Noto (?:Sans|Serif) CJK/i, "CJK font fallback must resolve to Noto CJK");
  process.stdout.write("LINUX_WEBRTC_STAGE cjk-font-ready\n");
  const root = await mkdtemp(path.join(os.tmpdir(), "handoff-linux-webrtc-"));
  const profile = path.join(root, "profile");
  const home = path.join(root, "home");
  const runtimeDir = path.join(root, "runtime");
  await import("node:fs/promises").then(({ mkdir }) => Promise.all([
    mkdir(profile, { recursive: true, mode: 448 }),
    mkdir(home, { recursive: true, mode: 448 }),
    mkdir(runtimeDir, { recursive: true, mode: 448 })
  ]));
  let formOpened = false;
  let typedLength = 0;
  let submitted;
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    res.setHeader("cache-control", "no-store");
    res.setHeader("content-type", "text/html; charset=utf-8");
    if (url.pathname === "/form") {
      formOpened = true;
      res.end(`<!doctype html><html><body style="margin:0;font-family:sans-serif"><form action="/submitted" method="get"><input id="field" name="value" autocomplete="off" style="position:fixed;inset:0;width:100%;height:100%;box-sizing:border-box;font-size:32px"></form><script>const f=document.getElementById('field');f.addEventListener('input',()=>fetch('/typed?length='+encodeURIComponent(String(f.value.length)),{cache:'no-store'}).catch(()=>{}));</script></body></html>`);
      return;
    }
    if (url.pathname === "/typed") {
      const length = Number(url.searchParams.get("length"));
      if (Number.isSafeInteger(length) && length >= 0 && length <= 4096) typedLength = length;
      res.end("ok");
      return;
    }
    if (url.pathname === "/submitted") {
      submitted = url.searchParams.get("value") ?? void 0;
      res.end("<!doctype html><html><body>submitted</body></html>");
      return;
    }
    res.end(`<!doctype html><html><head><title>Handoff Linux Acceptance</title></head><body style="margin:0"><button onclick="location.href='/form'" style="position:fixed;inset:0;border:0;font-size:32px">Open form</button></body></html>`);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const pageUrl = `http://127.0.0.1:${address.port}/`;
  const displayNumber = 99;
  const display = ":99";
  const xEnv = { DISPLAY: display, HOME: home, XDG_RUNTIME_DIR: runtimeDir, LANG: "C.UTF-8", LC_ALL: "C.UTF-8" };
  let xvfb;
  let openbox;
  let browser;
  let chromePid;
  const provider = new SpawnedWebRtcRuntimeProvider({
    hostExecutable: helper,
    displayName: display
  });
  const client = new RTCPeerConnection({ codecs: { video: [useH264()] }, iceServers: [], maxMessageSize: 4096 });
  client.addTransceiver("video", { direction: "recvonly" });
  const critical = client.createDataChannel("human-critical", { ordered: true });
  const realtime = client.createDataChannel("human-realtime", { ordered: false, maxRetransmits: 0 });
  let rtpPackets = 0;
  let inputUses = 0;
  let endedUses = 0;
  client.onTrack.subscribe((track) => track.onReceiveRtp.subscribe(() => {
    rtpPackets += 1;
  }));
  try {
    xvfb = spawn("/usr/bin/Xvfb", [display, "-screen", "0", "1280x800x24", "-nolisten", "tcp", "-ac"], {
      stdio: ["ignore", "ignore", "ignore"]
    });
    xvfb.once("error", () => void 0);
    await waitForX(displayNumber);
    openbox = spawn(openboxExecutable, ["--sm-disable"], { env: xEnv, stdio: ["ignore", "ignore", "ignore"] });
    openbox.once("error", () => void 0);
    await new Promise((resolve) => setTimeout(resolve, 250));
    process.env.DISPLAY = display;
    process.env.HOME = home;
    process.env.XDG_RUNTIME_DIR = runtimeDir;
    process.stdout.write("LINUX_WEBRTC_STAGE agent-human-transition\n");
    const agentBrowser = new ChromeProcess({
      executable: chromeExecutable,
      profileDir: profile,
      headless: true,
      allowUnsandboxedChromium: true
    });
    await agentBrowser.start();
    await agentBrowser.close();
    browser = new SystemBrowserCredentialSession({
      executable: chromeExecutable,
      profileDir: profile,
      startUrl: pageUrl,
      allowUnsandboxedChromium: true
    });
    await browser.start();
    chromePid = browser.getPid();
    assert.ok(chromePid, "credential-safe normal Chromium PID is required");
    process.stdout.write("LINUX_WEBRTC_STAGE chrome-window\n");
    const windowId = await waitForStableAcceptanceWindow(browser, chromePid, xEnv);
    assert.ok(windowId);
    process.stdout.write("LINUX_WEBRTC_STAGE page-ready\n");
    const liveCmdline = await cmdline(chromePid);
    assert.match(liveCmdline, /--no-sandbox/);
    assert.doesNotMatch(liveCmdline, /--remote-debugging(?:-port|-pipe)?|--enable-automation|--headless/i);
    const binding = {
      takeoverSessionId: "linux-host-acceptance",
      interventionId: "linux-normal-browser",
      epoch: 1,
      principalBinding: "acceptance-principal",
      clientBinding: "acceptance-client-binding-1234567890",
      clientGeneration: 1,
      expiresAt: Date.now() + 6e4,
      targetProcessId: chromePid,
      targetWindowId: Number(windowId)
    };
    process.stdout.write("LINUX_WEBRTC_STAGE provider-prepare\n");
    await provider.prepare(binding);
    const offer = await client.createOffer();
    await client.setLocalDescription(offer);
    assert.ok(client.localDescription?.sdp);
    process.stdout.write("LINUX_WEBRTC_STAGE provider-start\n");
    const answer = await provider.start(binding, { type: "offer", sdp: client.localDescription.sdp }, {
      beginInput() {
        inputUses += 1;
        return () => {
          endedUses += 1;
        };
      },
      disconnected() {
      }
    });
    process.stdout.write("LINUX_WEBRTC_STAGE client-remote-description\n");
    await client.setRemoteDescription(answer);
    await waitFor("webrtc-connected", () => client.connectionState === "connected" && critical.readyState === "open" && realtime.readyState === "open");
    process.stdout.write("LINUX_WEBRTC_STAGE rtp\n");
    try {
      await waitFor("rtp", () => rtpPackets > 0);
    } catch (error) {
      const stages = provider.diagnosticsSnapshot().events.map((event) => event.stage).join(",");
      throw new Error(`${error instanceof Error ? error.message : "RTP timeout"}; diagnostics=${stages}`);
    }
    critical.send(JSON.stringify({ kind: "tap", x: 0.5, y: 0.55 }));
    process.stdout.write("LINUX_WEBRTC_STAGE tap-form\n");
    try {
      await waitFor("tap-form", () => inputUses >= 1 && endedUses >= 1 && formOpened);
    } catch (error) {
      const stages = provider.diagnosticsSnapshot().events.map((event) => event.stage).join(",");
      throw new Error(`${error instanceof Error ? error.message : "tap timeout"}; diagnostics=${stages}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
    critical.send(JSON.stringify({ kind: "tap", x: 0.5, y: 0.5 }));
    process.stdout.write("LINUX_WEBRTC_STAGE tap-input\n");
    await waitFor("tap-input", () => inputUses >= 2 && endedUses >= 2);
    await new Promise((resolve) => setTimeout(resolve, 150));
    const marker = `handoff-linux-${process.pid}-dummy`;
    critical.send(JSON.stringify({ kind: "text", text: marker }));
    process.stdout.write("LINUX_WEBRTC_STAGE text-input\n");
    await waitFor("text-input", () => inputUses >= 3 && endedUses >= 3);
    await waitFor("text-field-value", () => typedLength === marker.length);
    process.stdout.write("LINUX_WEBRTC_STAGE text-field-value\n");
    assert.equal(await markerInAnyProcess(marker), false, "Human text leaked into a process command line");
    critical.send(JSON.stringify({ kind: "key", key: "Backspace" }));
    process.stdout.write("LINUX_WEBRTC_STAGE backspace-input\n");
    await waitFor("backspace-input", () => inputUses >= 4 && endedUses >= 4 && typedLength === marker.length - 1);
    critical.send(JSON.stringify({ kind: "text", text: marker.slice(-1) }));
    process.stdout.write("LINUX_WEBRTC_STAGE text-restore\n");
    await waitFor("text-restore", () => inputUses >= 5 && endedUses >= 5 && typedLength === marker.length);
    critical.send(JSON.stringify({ kind: "key", key: "Enter" }));
    process.stdout.write("LINUX_WEBRTC_STAGE enter-submit\n");
    await waitFor("enter-submit", () => inputUses >= 6 && endedUses >= 6 && submitted === marker);
    assert.ok(rtpPackets > 0, "no H264 RTP reached the WebRTC peer");
    process.stdout.write(`LINUX_WEBRTC_HOST_ACCEPTANCE_PASS rtp=${rtpPackets} inputs=${inputUses}
`);
  } finally {
    process.stdout.write("LINUX_WEBRTC_STAGE cleanup-client\n");
    await within("cleanup-client", client.close().catch(() => void 0));
    process.stdout.write("LINUX_WEBRTC_STAGE cleanup-provider\n");
    await within("cleanup-provider", provider.revoke("linux-host-acceptance").catch(() => void 0));
    process.stdout.write("LINUX_WEBRTC_STAGE cleanup-chrome\n");
    try {
      await within("cleanup-chrome", browser?.close() ?? Promise.resolve(), 12_000);
      await browser?.assertProfileUnlocked();
    } catch (error) {
      const ps = spawnSync("ps", ["-eo", "comm="], { encoding: "utf8" });
      const chromeProcesses = ps.status === 0
        ? ps.stdout.split(/\r?\n/).filter((line) => /^(?:chromium|chrome_crashpad)$/.test(line.trim())).length
        : 0;
      process.stdout.write(`LINUX_WEBRTC_CLEANUP_DIAG stage=profile-unlock-failed chrome_processes=${Math.min(chromeProcesses, 99)}\n`);
      throw error;
    }
    await within("cleanup-openbox", stopAndWait(openbox));
    await within("cleanup-xvfb", stopAndWait(xvfb));
    process.stdout.write("LINUX_WEBRTC_STAGE cleanup-server\n");
    server.closeAllConnections?.();
    if (server.listening) {
      await within("cleanup-server", new Promise((resolve) => server.close(() => resolve())));
    }
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }).catch(() => void 0);
    process.stdout.write("LINUX_WEBRTC_STAGE cleanup-complete\n");
  }
}
main().then(() => {
  process.exit(0);
}).catch((error) => {
  process.stderr.write(`LINUX_WEBRTC_HOST_ACCEPTANCE_FAIL ${error instanceof Error ? error.message : "unknown"}
`);
  process.exit(1);
});
