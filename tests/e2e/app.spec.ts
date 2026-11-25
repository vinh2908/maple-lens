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
function chunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 4, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}
function makePng(width: number, height: number, draw: (x: number, y: number) => [number, number, number]): Buffer {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (width * 3 + 1);
    raw[row] = 0;
    for (let x = 0; x < width; x++) {
      const [r, g, b] = draw(x, y);
      raw[row + 1 + x * 3] = r; raw[row + 2 + x * 3] = g; raw[row + 3 + x * 3] = b;
    }
  }
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

test("mobile layout, example image, crop, rotate and minimal answer result", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Dán hoặc chụp ảnh câu hỏi" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  await page.getByRole("button", { name: "Thử ảnh minh họa", exact: true }).click();
  const image = page.getByRole("img", { name: "Ảnh thử thách đã chọn để xem trước" });
  await expect(image).toBeVisible();
  await page.getByRole("button", { name: "Xem kết quả minh họa" }).click();
  await expect(page.locator(".choice-line")).toContainText("Dòng 2");
  await expect(page.locator(".answer-box strong")).toHaveText("저는 학교에 갑니다.");
  await expect(image).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("library upload handles the server missing-key response fixture without inventing an answer", async ({ page }) => {
  await page.route("**/api/analyze", route => route.fulfill({ status: 503, json: { error: { code: "MISSING_KEY", message: "Chưa cấu hình Gemini API key trên máy chủ." } } }));
  await page.goto("/");
  const image = makePng(700, 400, () => [0x39, 0x4f, 0x4d]);
  await page.getByLabel("Chọn ảnh thử thách", { exact: true }).setInputFiles({ name: "challenge.png", mimeType: "image/png", buffer: image });
  await expect(page.locator(".notice[role=alert], .inline-error[role=alert]")).toContainText("Chưa cấu hình Gemini API key");
  await expect(page.getByText("ĐÁP ÁN GỢI Ý", { exact: true })).not.toBeVisible();
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

test("backend validates image content, format, body and rejects cross-origin requests", async ({ request }) => {
  const invalid = await request.post("/api/analyze", { multipart: { image: { name: "fake.jpg", mimeType: "image/jpeg", buffer: Buffer.from("invalid JPEG bytes") } } });
  expect(invalid.status()).toBe(415); expect((await invalid.json()).error.code).toBe("INVALID_IMAGE");
  const type = await request.post("/api/analyze", { multipart: { image: { name: "image.svg", mimeType: "image/svg+xml", buffer: Buffer.from("<svg/>") } } });
  expect(type.status()).toBe(415);
  const body = await request.post("/api/analyze", { data: "invalid" }); expect(body.status()).toBe(400);
  const crossOrigin = await request.post("/api/connection", { headers: { origin: "https://untrusted.example" } }); expect(crossOrigin.status()).toBe(403);
});

test("automatically finds a blue popup, preserves all choices and restores original without API call when auto-solve is off", async ({ page }) => {
  let calls = 0;
  await page.route("**/api/analyze", () => { calls++; });
  const buffer = makePng(900, 650, (x, y) => {
    if (x >= 275 && x < 580 && y >= 100 && y < 555) {
      for (let i = 0; i < 5; i++) {
        const ry = 205 + i * 55;
        if (x >= 300 && x < 555 && y >= ry && y < ry + 27) return [0xbe, 0xca, 0xda];
      }
      return [0x25, 0x53, 0x92];
    }
    return [0x25, 0x30, 0x25];
  });
  await page.goto("/");
  await page.getByRole("button", { name: /Tự giải:/ }).click();
  await page.getByLabel("Chọn ảnh thử thách", { exact: true }).setInputFiles({ name: "full-screen.png", mimeType: "image/png", buffer });
  const status = page.locator(".popup-status");
  await expect(status).toContainText("Đã tự cắt popup");
  await expect(status).toContainText("Nhận diện dạng chọn câu");
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
