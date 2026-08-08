import assert from "node:assert/strict";
import test from "node:test";
import { MapsUrlCompiler } from "../src/maps/url-compiler.js";

const compiler = new MapsUrlCompiler();

test("builds an official Maps search URL", () => {
  const { url, action } = compiler.search("横浜駅 カフェ");
  const parsed = new URL(url);
  assert.equal(parsed.origin, "https://www.google.com");
  assert.equal(parsed.pathname, "/maps/search/");
  assert.equal(parsed.searchParams.get("api"), "1");
  assert.equal(parsed.searchParams.get("query"), "横浜駅 カフェ");
  assert.deepEqual(action, { kind: "search", query: "横浜駅 カフェ" });
});

test("builds transit directions and allows an omitted origin", () => {
  const { url, action } = compiler.directions({ destination: "渋谷駅", mode: "transit" });
  const parsed = new URL(url);
  assert.equal(parsed.pathname, "/maps/dir/");
  assert.equal(parsed.searchParams.get("origin"), null);
  assert.equal(parsed.searchParams.get("destination"), "渋谷駅");
  assert.equal(parsed.searchParams.get("travelmode"), "transit");
  assert.deepEqual(action, {
    kind: "directions",
    origin: undefined,
    destination: "渋谷駅",
    mode: "transit"
  });
});

test("rejects invalid map coordinates", () => {
  assert.throws(() => compiler.show({ latitude: 91, longitude: 139 }), /latitude/);
});
