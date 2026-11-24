import { test, expect } from "@playwright/test";
import sharp from "sharp";
import { demoResult } from "../../src/lib/demo";

test("mobile layout, example image, crop, rotate and explicit demo result", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Đọc thử thách." })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  await page.getByRole("button", { name: "Thử ảnh minh họa", exact: true }).click();
  const image = page.getByRole("img", { name: "Ảnh thử thách đã chọn để xem trước" });
  await expect(image).toBeVisible();
  await page.getByRole("button", { name: "Xem kết quả minh họa" }).click();
  await expect(page.getByText("KẾT QUẢ MINH HỌA · VIẾT SẴN")).toBeVisible();
  await page.getByRole("button", { name: "Sao chép chữ Hàn" }).click();
  await page.getByRole("button", { name: "Cắt vùng thử thách", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Cắt vùng thử thách" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Dùng vùng ảnh này" })).toBeEnabled();
  await dialog.getByRole("slider", { name: "Tỉ lệ khung cắt" }).fill("2.5");
  await dialog.getByRole("button", { name: "Dùng vùng ảnh này" }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByText("KẾT QUẢ MINH HỌA · VIẾT SẴN")).not.toBeVisible();
  const before = await image.evaluate((img: HTMLImageElement) => ({ w: img.naturalWidth, h: img.naturalHeight }));
  await page.getByRole("button", { name: "Xoay ảnh 90 độ" }).click();
  await expect.poll(async () => image.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(before.h);
  expect(errors).toEqual([]);
});

test("library upload handles the server missing-key response fixture without inventing an answer", async ({ page }) => {
  await page.route("**/api/analyze", route => route.fulfill({ status: 503, json: { error: { code: "MISSING_KEY", message: "Chưa cấu hình Gemini API key trên máy chủ." } } }));
  await page.goto("/");
  const image = await sharp({ create: { width: 700, height: 400, channels: 3, background: "#394f4d" } }).jpeg().toBuffer();
  await page.getByLabel("Chọn ảnh thử thách", { exact: true }).setInputFiles({ name: "challenge.jpg", mimeType: "image/jpeg", buffer: image });
  await expect(page.getByRole("img", { name: "Ảnh thử thách đã chọn để xem trước" })).toBeVisible();
  await page.getByRole("button", { name: "Phân tích ảnh", exact: true }).click();
  await expect(page.locator(".notice[role=alert], .inline-error[role=alert]")).toContainText("Chưa cấu hình Gemini API key");
  await expect(page.getByText("ĐÁP ÁN ĐỀ XUẤT", { exact: true })).not.toBeVisible();
});

test("invalid and oversized library files are rejected", async ({ page }) => {
  await page.goto("/");
  const input = page.getByLabel("Chọn ảnh thử thách", { exact: true });
  await input.setInputFiles({ name: "fake.jpg", mimeType: "image/jpeg", buffer: Buffer.from("not an image") });
  await expect(page.locator(".notice[role=alert], .inline-error[role=alert]")).toContainText("Không đọc được ảnh");
  await input.setInputFiles({ name: "too-large.jpg", mimeType: "image/jpeg", buffer: Buffer.alloc(15 * 1024 * 1024 + 1) });
  await expect(page.locator(".notice[role=alert], .inline-error[role=alert]")).toContainText("15 MB");
  await input.setInputFiles({ name: "photo.heic", mimeType: "image/heic", buffer: Buffer.from("invalid") });
  await expect(page.locator(".notice[role=alert], .inline-error[role=alert]")).toContainText("HEIC");
});

test("camera denial offers library fallback and does not send images", async ({ page }) => {
  let analyzeCalls = 0;
  await page.route("**/api/analyze", () => { analyzeCalls++; });
  await page.addInitScript(() => { Object.defineProperty(navigator.mediaDevices, "getUserMedia", { value: () => Promise.reject(new DOMException("denied", "NotAllowedError")) }); });
  await page.goto("/");
  await page.getByRole("button", { name: "Mở camera sau" }).click();
  await expect(page.locator(".notice[role=alert], .inline-error[role=alert]")).toContainText("Quyền camera đã bị từ chối");
  await expect(page.getByRole("dialog").getByRole("button", { name: "Chọn ảnh từ thư viện" })).toBeVisible();
  expect(analyzeCalls).toBe(0);
});

test("connection test handles a missing-key fixture clearly", async ({ page }) => {
  await page.route("**/api/connection", route => route.fulfill({ status: 503, json: { error: { code: "MISSING_KEY", message: "Chưa cấu hình Gemini API key trên máy chủ." } } }));
  await page.goto("/");
  await page.getByRole("button", { name: "Kiểm tra kết nối" }).click();
  await expect(page.locator(".notice[role=alert], .inline-error[role=alert]")).toContainText("Chưa cấu hình Gemini API key");
});

test("refusal / malformed transport clears previous result, only one request per click", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Thử ảnh minh họa", exact: true }).click();
  await page.getByRole("button", { name: "Xem kết quả minh họa" }).click();
  let calls = 0;
  await page.route("**/api/analyze", async route => { calls++; await route.fulfill({ status: 422, json: { error: { code: "REFUSED", message: "Gemini đã từ chối xử lý. Không có đáp án." } } }); });
  await page.getByRole("button", { name: "Phân tích ảnh", exact: true }).click();
  await expect(page.locator(".notice[role=alert], .inline-error[role=alert]")).toContainText("từ chối");
  await expect(page.getByText("ĐÁP ÁN ĐỀ XUẤT", { exact: true })).not.toBeVisible();
  expect(calls).toBe(1);
  await page.route("**/api/analyze", async route => route.fulfill({ status: 502, body: "not JSON" }));
  await page.getByRole("button", { name: "Phân tích ảnh", exact: true }).click();
  await expect(page.locator(".notice[role=alert], .inline-error[role=alert]")).toContainText("dữ liệu không hợp lệ");
});

test("successful response rendering is tested with a labeled transport fixture", async ({ page }) => {
  await page.route("**/api/analyze", route => route.fulfill({ json: demoResult }));
  await page.goto("/");
  await page.getByRole("button", { name: "Thử ảnh minh họa", exact: true }).click();
  await page.getByRole("button", { name: "Phân tích ảnh", exact: true }).click();
  await expect(page.getByText("KẾT QUẢ MINH HỌA · VIẾT SẴN")).toBeVisible();
  await expect(page.getByRole("button", { name: "Sao chép chữ Hàn" })).toBeVisible();
});

test("backend validates image content, format, body and rejects cross-origin requests", async ({ request }) => {
  const invalid = await request.post("/api/analyze", { multipart: { image: { name: "fake.jpg", mimeType: "image/jpeg", buffer: Buffer.from("invalid JPEG bytes") } } });
  expect(invalid.status()).toBe(415); expect((await invalid.json()).error.code).toBe("INVALID_IMAGE");
  const type = await request.post("/api/analyze", { multipart: { image: { name: "image.svg", mimeType: "image/svg+xml", buffer: Buffer.from("<svg/>") } } });
  expect(type.status()).toBe(415);
  const body = await request.post("/api/analyze", { data: "invalid" }); expect(body.status()).toBe(400);
  const crossOrigin = await request.post("/api/connection", { headers: { origin: "https://untrusted.example" } }); expect(crossOrigin.status()).toBe(403);
});

test("automatically finds a blue popup, preserves all choices and restores original without any API call", async ({ page }) => {
  let calls = 0;
  await page.route("**/api/analyze", () => { calls++; });
  const rows = Array.from({ length: 5 }, (_, i) => `<rect x="300" y="205" width="255" height="27" fill="#becada" transform="translate(0 ${i * 55})"/>`).join("");
  const scene = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="650"><rect width="900" height="650" fill="#253025"/><rect x="275" y="100" width="305" height="455" fill="#255392"/>${rows}</svg>`;
  const buffer = await sharp(Buffer.from(scene)).png().toBuffer();
  await page.goto("/");
  await page.getByLabel("Chọn ảnh thử thách", { exact: true }).setInputFiles({ name: "full-screen.png", mimeType: "image/png", buffer });
  const status = page.locator(".popup-status");
  await expect(status).toContainText("Đã tự cắt popup");
  await expect(status).toContainText("Dạng 2 · Chọn câu");
  const preview = page.getByRole("img", { name: "Ảnh thử thách đã chọn để xem trước" });
  const cropped = await preview.evaluate((img: HTMLImageElement) => ({ width: img.naturalWidth, height: img.naturalHeight }));
  expect(cropped.width).toBeGreaterThanOrEqual(305);
  expect(cropped.width).toBeLessThan(400);
  expect(cropped.height).toBeGreaterThanOrEqual(455);
  expect(cropped.height).toBeLessThan(530);
  await page.getByRole("button", { name: "Ảnh gốc", exact: true }).click();
  await expect.poll(() => preview.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(900);
  await expect(status).toContainText("Đang xem ảnh gốc");
  await page.getByRole("button", { name: "Quét lại", exact: true }).click();
  await expect(status).toContainText("Đã tự cắt popup");
  expect(calls).toBe(0);
});
