import { test, expect } from "@playwright/test";
import { deflateSync } from "node:zlib";
import { demoResult } from "../../src/lib/demo";

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
  }
  return (c ^ 0xffffffff) >>> 0;
}
function makeSolidPng(width: number, height: number, r: number, g: number, b: number): Buffer {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (width * 3 + 1); raw[row] = 0;
    for (let x = 0; x < width; x++) { raw[row + 1 + x * 3] = r; raw[row + 2 + x * 3] = g; raw[row + 3 + x * 3] = b; }
  }
  const chunk = (t: string, d: Buffer) => {
    const h = Buffer.alloc(8); h.writeUInt32BE(d.length, 0); h.write(t, 4, 4, "ascii");
    const c = Buffer.alloc(4); c.writeUInt32BE(crc32(Buffer.concat([h.subarray(4), d])), 0);
    return Buffer.concat([h, d, c]);
  };
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

const choice = { ...demoResult, analysis: { ...demoResult.analysis,
  challengeType: "sentence_choice" as const,
  selectedOption: 2, suggestedAnswer: "둘째 문장",
}};

async function paste(page: import("@playwright/test").Page, valid = true) {
  const buffer = valid ? makeSolidPng(900, 600, 0x30, 0x42, 0x38) : Buffer.from("invalid image");
  await page.locator(".image-panel").evaluate((panel, encoded) => {
    const bytes = Uint8Array.from(atob(encoded), c => c.charCodeAt(0));
    const clipboard = new DataTransfer();
    clipboard.items.add(new File([bytes], "clipboard.png", { type: "image/png" }));
    (panel as HTMLElement).focus();
    panel.dispatchEvent(new ClipboardEvent("paste", { clipboardData: clipboard, bubbles: true, cancelable: true }));
  }, buffer.toString("base64"));
}

test.beforeEach(async ({ page }) => {
  await page.route("**/api/status", route => route.fulfill({ json: { configured: true, authenticated: true, authRequired: false, locked: false } }));
});

test("paste auto-solves and renders only line and answer without cropped image or extra clutter", async ({ page }) => {
  let calls = 0;
  await page.route("**/api/analyze", async route => { calls++; await route.fulfill({ json: choice }); });
  await page.goto("/");
  await paste(page);
  await expect(page.locator(".choice-line")).toContainText("Dòng 2");
  await expect(page.locator(".answer-box strong")).toHaveText("둘째 문장");
  await expect(page.locator(".explanation, .options-list, .recognized, .typing-guide, .image-preview")).toHaveCount(0);
  expect(calls).toBe(1);
  await page.getByRole("button", { name: "Lịch sử" }).click();
  await expect(page.locator(".history-item")).toHaveCount(1);
  await expect(page.locator(".history-item")).toContainText("Dòng 2");
  await expect(page.locator(".history-item img")).toBeVisible();
});

test("unclear choice never presents a certain answer", async ({ page }) => {
  await page.goto("/");
  await page.route("**/api/analyze", route => route.fulfill({ json: { ...choice, analysis: { ...choice.analysis, needsClearerImage: true } } }));
  await paste(page);
  await expect(page.locator(".answer-box")).toContainText("CHƯA ĐỌC RÕ");
  await expect(page.locator(".choice-line")).toHaveCount(0);
});
