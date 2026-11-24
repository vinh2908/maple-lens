import { test, expect } from "@playwright/test";
import sharp from "sharp";
import { demoResult } from "../../src/lib/demo";

const choice = { ...demoResult, analysis: { ...demoResult.analysis,
  challengeType: "sentence_choice", recognizedText: "첫째 문장\n둘째 문장",
  selectedOption: 2, suggestedAnswer: "둘째 문장",
  options: [1, 2].map(index => ({ index, text: index === 1 ? "첫째 문장" : "둘째 문장", grammar: "grammar fixture", meaning: "meaning fixture", assessment: "assessment fixture" })),
}};

async function paste(page: import("@playwright/test").Page, valid = true) {
  const buffer = valid ? await sharp({ create: { width: 900, height: 600, channels: 3, background: "#304238" } }).png().toBuffer() : Buffer.from("invalid image");
  await page.locator(".image-panel").evaluate((panel, encoded) => {
    const bytes = Uint8Array.from(atob(encoded), c => c.charCodeAt(0));
    const clipboard = new DataTransfer();
    clipboard.items.add(new File([bytes], "clipboard.png", { type: "image/png" }));
    (panel as HTMLElement).focus();
    panel.dispatchEvent(new ClipboardEvent("paste", { clipboardData: clipboard, bubbles: true, cancelable: true }));
  }, buffer.toString("base64"));
}

test.beforeEach(async ({ page }) => {
  await page.route("**/api/status", route => route.fulfill({ json: { configured: true, authenticated: true, authRequired: false } }));
});

test("paste + immediate Enter sends once; sentence result shows line and answer only", async ({ page }) => {
  let calls = 0;
  await page.route("**/api/analyze", async route => { calls++; await route.fulfill({ json: choice }); });
  await page.goto("/");
  await paste(page);
  await page.keyboard.press("Enter");
  await expect(page.locator(".choice-line")).toContainText("Dòng 2");
  await expect(page.locator(".answer-box strong")).toHaveText("둘째 문장");
  await expect(page.locator(".explanation, .options-list, .recognized, .typing-guide")).toHaveCount(0);
  expect(calls).toBe(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  await page.screenshot({ path: "/tmp/maple-choice-mobile.png", fullPage: true });
  await page.getByRole("button", { name: "Xóa ảnh", exact: true }).click();
  await expect(page.locator(".choice-line")).toHaveCount(0);
  await expect(page.getByRole("img", { name: "Ảnh thử thách đã chọn để xem trước" })).toHaveCount(0);
});

test("paste alone does not send; typing guide copies keys and clears with image", async ({ page, context }) => {
  let calls = 0;
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.route("**/api/analyze", async route => { calls++; await route.fulfill({ json: demoResult }); });
  await page.goto("/");
  await paste(page);
  await expect(page.getByRole("button", { name: "Phân tích ảnh", exact: true })).toBeEnabled();
  expect(calls).toBe(0);
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("Chuỗi phím Latin")).toHaveText("qksnflah");
  await page.getByRole("button", { name: "Sao chép chuỗi phím", exact: true }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("qksnflah");
  expect(calls).toBe(1);
  await page.screenshot({ path: "/tmp/maple-keys-mobile.png", fullPage: true });
  await page.getByRole("button", { name: "Xóa ảnh", exact: true }).click();
  await expect(page.locator(".typing-guide")).toHaveCount(0);
});

test("invalid pasted image cannot submit the previous image on Enter", async ({ page }) => {
  let calls = 0;
  await page.route("**/api/analyze", async route => { calls++; await route.fulfill({ json: demoResult }); });
  await page.goto("/");
  await paste(page);
  await expect(page.getByRole("button", { name: "Phân tích ảnh", exact: true })).toBeEnabled();
  await paste(page, false);
  await page.keyboard.press("Enter");
  await expect(page.locator(".notice[role=alert]")).toContainText("Không đọc được ảnh");
  await expect(page.getByRole("img", { name: "Ảnh thử thách đã chọn để xem trước" })).toHaveCount(0);
  expect(calls).toBe(0);
});

test("unclear choice and unclear Korean text never present a certain answer or keys", async ({ page }) => {
  await page.goto("/");
  await paste(page);
  await page.route("**/api/analyze", route => route.fulfill({ json: { ...choice, analysis: { ...choice.analysis, needsClearerImage: true } } }));
  await page.keyboard.press("Enter");
  await expect(page.locator(".answer-box")).toContainText("CẦN ẢNH RÕ HƠN");
  await expect(page.locator(".choice-line")).toHaveCount(0);
  await page.route("**/api/analyze", route => route.fulfill({ json: { ...demoResult, analysis: { ...demoResult.analysis, uncertainSegments: [{ text: "바", reason: "Mờ", alternatives: ["파"] }] } } }));
  await page.getByRole("button", { name: "Phân tích ảnh", exact: true }).click();
  await expect(page.locator(".typing-guide")).toContainText("Chưa tạo chuỗi phím");
  await expect(page.getByLabel("Chuỗi phím Latin")).toHaveCount(0);
});
