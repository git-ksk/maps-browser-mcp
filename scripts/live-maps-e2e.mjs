import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ChromeProcess } from "../dist/browser/chrome-process.js";
import { MapsBrowserRuntime } from "../dist/browser/runtime.js";
import { VisibleStateReader } from "../dist/browser/visible-state-reader.js";
import { SemanticController } from "../dist/browser/semantic-controller.js";
import { MapsUrlCompiler } from "../dist/maps/url-compiler.js";
import { PolicyEngine } from "../dist/policy/policy-engine.js";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function boundedSummary(summary, maxChars) {
  const totalChars = [
    ...summary.items.map((item) => item.label),
    ...summary.lines
  ].reduce((sum, value) => sum + value.length, 0);
  assert(summary.untrustedExternalText === true, "Reader must mark Maps text as untrusted");
  assert(summary.source === "google_maps_bounded_visible_ui", "Unexpected reader source");
  assert(summary.items.length <= 8, "Reader returned too many indexed items");
  assert(summary.lines.length <= 12, "Reader returned too many UI lines");
  assert(totalChars <= maxChars, `Reader exceeded ${maxChars} character budget`);
  assert(summary.items.length + summary.lines.length > 0, "No bounded place UI content was detected");
}

async function boundedPhotoDiagnostic(runtime, expectedLabel) {
  const client = await runtime.getClient();
  const expected = JSON.stringify(expectedLabel.replace(/\s+/g, " ").trim().toLocaleLowerCase());
  const opened = await client.Runtime.evaluate({
    expression: `(() => {
      const visible = (el) => {
        const r = el.getBoundingClientRect();
        const s = getComputedStyle(el);
        return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
      };
      const normalize = (value) => String(value || '').replace(/\\s+/g, ' ').trim().toLocaleLowerCase();
      const labelOf = (el) => String(el.getAttribute('aria-label') || el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 160);
      const expected = ${expected};
      const photoLike = (value) => /(^|\\b)(photo|photos|pictures?)(\\b|$)|写真|画像/i.test(value);
      const mains = Array.from(document.querySelectorAll('[role="main"]')).filter(visible).slice(0, 8);
      const matches = mains.filter((main) => Array.from(main.querySelectorAll('h1, [role="heading"]'))
        .filter(visible).slice(0, 32).some((heading) => normalize(labelOf(heading)) === expected));
      if (matches.length !== 1) return { ok: false, reason: matches.length === 0 ? 'place_missing' : 'place_ambiguous' };
      const controls = Array.from(matches[0].querySelectorAll('button, [role="button"], a'))
        .filter(visible).slice(0, 120)
        .map((el) => {
          const label = labelOf(el);
          let pathname = '';
          if (el.tagName === 'A') {
            try {
              const url = new URL(el.href, location.href);
              if (url.origin === location.origin && url.pathname.startsWith('/maps/')) pathname = url.pathname.slice(0, 240);
            } catch {}
          }
          return {
            el,
            label,
            tag: String(el.tagName || '').slice(0, 24),
            role: String(el.getAttribute('role') || '').slice(0, 48),
            pathname
          };
        })
        .filter((entry) => entry.label && photoLike(entry.label))
        .slice(0, 12);
      const publicControls = controls.map(({ el, ...entry }) => entry);
      if (controls.length === 1) {
        controls[0].el.click();
        return { ok: true, clicked: publicControls[0], candidates: publicControls };
      }
      return { ok: false, reason: controls.length === 0 ? 'photo_missing' : 'photo_ambiguous', candidates: publicControls };
    })()`,
    returnByValue: true,
    awaitPromise: true
  });
  await sleep(1_200);
  const after = await client.Runtime.evaluate({
    expression: `(() => {
      const visible = (el) => {
        const r = el.getBoundingClientRect();
        const s = getComputedStyle(el);
        return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
      };
      const labelOf = (el) => String(el.getAttribute('aria-label') || el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 160);
      const photoLike = (value) => /(^|\\b)(photo|photos|pictures?)(\\b|$)|写真|画像/i.test(value);
      return {
        pathname: location.pathname.slice(0, 320),
        headings: Array.from(document.querySelectorAll('h1, h2, [role="heading"]')).filter(visible)
          .map(labelOf).filter((label) => label && photoLike(label)).slice(0, 12),
        controls: Array.from(document.querySelectorAll('button, [role="button"], [role="tab"]')).filter(visible)
          .map((el) => ({
            label: labelOf(el),
            role: String(el.getAttribute('role') || '').slice(0, 48),
            pressed: String(el.getAttribute('aria-pressed') || '').slice(0, 12),
            selected: String(el.getAttribute('aria-selected') || '').slice(0, 12)
          }))
          .filter((entry) => entry.label && photoLike(entry.label)).slice(0, 16)
      };
    })()`,
    returnByValue: true,
    awaitPromise: true
  });
  return { open: opened.result.value, after: after.result.value };
}

const profileDir = await fsp.mkdtemp(path.join(os.tmpdir(), "maps-browser-mcp-photo-diagnostic-"));
const chrome = new ChromeProcess({ profileDir, headless: true });
const policy = new PolicyEngine({ interactiveAssist: true, maxActionsPerMinute: 6, maxVisibleReadsPerHour: 3 });
const runtime = new MapsBrowserRuntime(chrome, policy);
const compiler = new MapsUrlCompiler();
const reader = new VisibleStateReader(runtime, { maxNodes: 120, maxChars: 1800 });
const semantic = new SemanticController(runtime, compiler);

try {
  const query = "coffee near Tokyo Station";
  policy.consumeAction();
  policy.assertSearchQuery(query);
  const search = compiler.search(query);
  await runtime.navigate(search.url, search.action);
  await sleep(2_500);

  policy.consumeVisibleRead();
  const summary = await reader.read("place");
  boundedSummary(summary, 1800);
  const first = summary.items[0];
  assert(first, "No selectable place candidate was detected");
  const selected = await semantic.selectResult(first.index, first.label);
  await sleep(1_500);

  policy.consumeVisibleRead();
  const diagnostic = await boundedPhotoDiagnostic(runtime, selected.selected);
  console.log("Bounded place-photo diagnostic:", JSON.stringify(diagnostic));
  assert(diagnostic.open?.candidates?.length > 0, "No bounded photo-like controls were observed");
} finally {
  await runtime.close().catch(() => undefined);
  await fsp.rm(profileDir, { recursive: true, force: true, maxRetries: 8, retryDelay: 150 }).catch(() => undefined);
}
