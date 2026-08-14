import assert from "node:assert/strict";
import test from "node:test";
import {
  isPhotoViewerPath,
  parsePhotoOpenProbe,
  parsePhotoSurfaceProbe
} from "../src/browser/place-photos.js";
import { BrowserRuntimeError } from "../src/browser/runtime.js";

function isRuntimeCode(code: BrowserRuntimeError["code"]) {
  return (error: unknown) => error instanceof BrowserRuntimeError && error.code === code;
}

test("photo opener revalidates place identity and strips icon glyphs", () => {
  assert.deepEqual(
    parsePhotoOpenProbe(
      { ok: true, placeLabel: "Saza Coffee", controlLabel: "\uE413See photos" },
      " saza   coffee "
    ),
    { placeLabel: "Saza Coffee", controlLabel: "see photos" }
  );

  assert.throws(
    () => parsePhotoOpenProbe(
      { ok: true, placeLabel: "Other Place", controlLabel: "See photos" },
      "Saza Coffee"
    ),
    isRuntimeCode("UI_STATE_CHANGED")
  );

  for (const reason of ["changed", "ambiguous_place", "ambiguous_photo"]) {
    assert.throws(
      () => parsePhotoOpenProbe({ ok: false, reason }, "Saza Coffee"),
      isRuntimeCode("UI_STATE_CHANGED")
    );
  }

  assert.throws(
    () => parsePhotoOpenProbe({ ok: false, reason: "missing_photo" }, "Saza Coffee"),
    isRuntimeCode("UI_ELEMENT_NOT_FOUND")
  );
});

test("photo viewer postcondition keeps exact place identity", () => {
  assert.equal(
    parsePhotoSurfaceProbe({ ok: true, placeLabel: "Saza Coffee" }, "saza coffee"),
    true
  );
  assert.equal(parsePhotoSurfaceProbe({ ok: false, reason: "pending" }, "Saza Coffee"), false);
  assert.throws(
    () => parsePhotoSurfaceProbe({ ok: true, placeLabel: "Other Place" }, "Saza Coffee"),
    isRuntimeCode("UI_STATE_CHANGED")
  );
  assert.throws(
    () => parsePhotoSurfaceProbe({ ok: false, reason: "ambiguous" }, "Saza Coffee"),
    isRuntimeCode("UI_STATE_CHANGED")
  );
});

test("photo viewer URL shape is narrowly recognized", () => {
  assert.equal(
    isPhotoViewerPath("https://www.google.com/maps/@35.68,139.76,3a,75y,90t/data=!3m8!1e2"),
    true
  );
  assert.equal(isPhotoViewerPath("https://www.google.com/maps/place/Saza+Coffee"), false);
  assert.equal(isPhotoViewerPath("https://www.google.com/maps/@35.68,139.76,17z"), false);
  assert.equal(isPhotoViewerPath("not a url"), false);
});
