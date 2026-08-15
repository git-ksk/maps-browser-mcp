import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDirectionsAppHtml,
  MAP_DIRECTIONS_APP_RESOURCE_URI,
  MAP_DIRECTIONS_APP_VERSION,
  MAP_DIRECTIONS_FRAME_DOMAINS,
  MCP_APP_MIME_TYPE,
  MCP_APP_PROTOCOL_VERSION
} from "../src/mcp-apps-map-embed.js";

test("uses the stable MCP Apps resource conventions", () => {
  assert.match(MAP_DIRECTIONS_APP_RESOURCE_URI, /^ui:\/\//);
  assert.equal(MCP_APP_MIME_TYPE, "text/html;profile=mcp-app");
  assert.equal(MCP_APP_PROTOCOL_VERSION, "2026-01-26");
  assert.deepEqual(MAP_DIRECTIONS_FRAME_DOMAINS, ["https://www.google.com"]);
});

test("builds a self-contained directions app using the MCP Apps lifecycle", () => {
  const html = buildDirectionsAppHtml("test-key");
  assert.match(html, /^<!doctype html>/i);
  assert.match(html, /ui\/initialize/);
  assert.match(html, /ui\/notifications\/initialized/);
  assert.match(html, /ui\/notifications\/tool-input/);
  assert.match(html, /ui\/notifications\/tool-result/);
  assert.match(html, /ui\/notifications\/size-changed/);
  assert.match(html, /ui\/notifications\/host-context-changed/);
  assert.match(html, /safeAreaInsets/);
  assert.match(html, /containerDimensions/);
  assert.match(html, /availableDisplayModes: \["inline"\]/);
  assert.match(html, /message.method === "ping"/);
  assert.match(html, /resizeObserver\.disconnect/);
  assert.match(html, /requestAnimationFrame/);
  assert.match(html, /lastReportedWidth/);
  assert.match(html, /Route rendering was cancelled/);
  assert.match(html, /Text error details remain available/);
  assert.match(html, /https:\/\/www\.google\.com\/maps\/embed\/v1\/directions/);
  assert.match(html, /strict-origin-when-cross-origin/);
  assert.match(html, /const API_KEY = "test-key"/);
  assert.match(html, new RegExp(`const APP_VERSION = "${MAP_DIRECTIONS_APP_VERSION.replaceAll(".", "\\.")}"`));
});

test("escapes environment-provided embed keys before placing them in inline JavaScript", () => {
  const dangerous = '</script><script>alert("x")</script>';
  const html = buildDirectionsAppHtml(dangerous);
  assert.equal(html.includes(dangerous), false);
  assert.match(html, /\\u003c\/script>/);
});
