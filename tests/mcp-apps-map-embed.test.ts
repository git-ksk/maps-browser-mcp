import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDirectionsAppHtml,
  MAP_DIRECTIONS_APP_RESOURCE_URI,
  MCP_APP_MIME_TYPE
} from "../src/mcp-apps-map-embed.js";

test("uses the stable MCP Apps resource conventions", () => {
  assert.match(MAP_DIRECTIONS_APP_RESOURCE_URI, /^ui:\/\//);
  assert.equal(MCP_APP_MIME_TYPE, "text/html;profile=mcp-app");
});

test("builds a self-contained directions app using the MCP Apps lifecycle", () => {
  const html = buildDirectionsAppHtml("test-key");
  assert.match(html, /^<!doctype html>/i);
  assert.match(html, /ui\/initialize/);
  assert.match(html, /ui\/notifications\/initialized/);
  assert.match(html, /ui\/notifications\/tool-input/);
  assert.match(html, /ui\/notifications\/tool-result/);
  assert.match(html, /ui\/notifications\/size-changed/);
  assert.match(html, /message.method === "ping"/);
  assert.match(html, /https:\/\/www\.google\.com\/maps\/embed\/v1\/directions/);
  assert.match(html, /strict-origin-when-cross-origin/);
  assert.match(html, /const API_KEY = "test-key"/);
});

test("escapes environment-provided embed keys before placing them in inline JavaScript", () => {
  const dangerous = '</script><script>alert("x")</script>';
  const html = buildDirectionsAppHtml(dangerous);
  assert.equal(html.includes(dangerous), false);
  assert.match(html, /\\u003c\/script>/);
});
