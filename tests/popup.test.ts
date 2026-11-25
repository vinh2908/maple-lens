import { test } from "node:test";
import assert from "node:assert/strict";
import { detectPopupPixels } from "../src/lib/popup-detection";

function scene(withChoices = true) {
  const width = 640; const height = 480;
  const pixels = new Uint8ClampedArray(width * height * 4);
  function rect(x: number, y: number, w: number, h: number, rgb: number[]) {
    for (let row = y; row < y + h; row++) for (let col = x; col < x + w; col++) {
      const at = (row * width + col) * 4; pixels.set([...rgb, 255], at);
    }
  }
  rect(0, 0, width, height, [31, 37, 29]);
  rect(200, 70, 240, 340, [37, 83, 146]);
  if (withChoices) {
    for (let i = 0; i < 5; i++) rect(220, 150 + i * 44, 200, 25, [190, 202, 218]);
  }
  return { pixels, width, height };
}

test("locates the whole sentence_choice popup and keeps all option rows", () => {
  const { pixels, width, height } = scene(true);
  const found = detectPopupPixels(pixels, width, height);
  assert.equal(found?.typeHint, "sentence_choice");
  assert.equal(found?.alreadyFramed, false);
  assert.ok(found!.bounds.x <= 200 && found!.bounds.y <= 70);
  assert.ok(found!.bounds.x + found!.bounds.width >= 440);
  assert.ok(found!.bounds.y + found!.bounds.height >= 410);
  assert.ok(found!.bounds.width < 300);
});

test("does not crop a plain photo, plain blue background or an invalid pixel buffer", () => {
  const { pixels, width, height } = scene(true);
  for (let at = 0; at < pixels.length; at += 4) pixels.set([37, 83, 146, 255], at);
  assert.equal(detectPopupPixels(pixels, width, height), null);
  pixels.fill(180);
  assert.equal(detectPopupPixels(pixels, width, height), null);
  assert.equal(detectPopupPixels(new Uint8ClampedArray(1), width, height), null);
});
