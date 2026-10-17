import "server-only";
import { createHmac, timingSafeEqual, randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { AppError, providerError } from "./api-errors";
import { limitApi } from "./rate-limit";

export const COOKIE_NAME = "maple_session";
export const DEFAULT_MODEL = "gemini-3.5-flash-lite";
const LOCAL_HOSTS = ["localhost", "127.0.0.1", "[::1]"];
export function isLocal(req: NextRequest) {
  try { return LOCAL_HOSTS.includes(new URL(`http://${req.headers.get("host")}`).hostname); }
  catch { return false; }
}
export function equalsSecret(a: string, b: string) {
  const x = Buffer.from(a); const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
export function signSession() {
  const body = `${Date.now() + 12 * 60 * 60_000}.${randomBytes(16).toString("hex")}`;
  const mac = createHmac("sha256", process.env.APP_PASSWORD!).update(body).digest("hex");
  return `${body}.${mac}`;
}
export function authenticated(req: NextRequest) {
  const password = process.env.APP_PASSWORD;
  if (!password) return true;
  const token = req.cookies.get(COOKIE_NAME)?.value ?? "";
  const [expires, nonce, mac] = token.split(".");
  if (!expires || !nonce || !mac || Number(expires) < Date.now()) return false;
  const expected = createHmac("sha256", password).update(`${expires}.${nonce}`).digest("hex");
  return equalsSecret(mac, expected);
}
export function checkOrigin(req: NextRequest) {
  const origin = req.headers.get("origin");
  if (origin && new URL(origin).host !== req.headers.get("host")) throw new AppError("ORIGIN_REJECTED", "Yêu cầu phải xuất phát từ ứng dụng này.", 403);
  if (req.headers.get("sec-fetch-site") === "cross-site") throw new AppError("ORIGIN_REJECTED", "Yêu cầu khác nguồn đã bị chặn.", 403);
}
export function guard(req: NextRequest) {
  checkOrigin(req);
  if (!authenticated(req)) {
    throw new AppError("AUTH_REQUIRED", "Nhập mật khẩu ứng dụng để sử dụng Gemini.", 401);
  }
  limitApi();
}
export function getGeminiConfig() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === "your_gemini_api_key_here") throw new AppError("MISSING_KEY", "Chưa cấu hình Gemini API key trên máy chủ. Bạn vẫn có thể thử chụp, chọn, cắt và xoay ảnh.", 503);
  return { apiKey, model: process.env.GEMINI_MODEL?.trim() || DEFAULT_MODEL };
}
export function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
}
export function errorResponse(error: unknown) {
  const e = providerError(error);
  const res = json({ error: { code: e.code, message: e.message, ...(e.retryAfter ? { retryAfter: e.retryAfter } : {}) } }, e.status);
  if (e.retryAfter) res.headers.set("Retry-After", String(e.retryAfter));
  return res;
}
export async function boundedBody(req: NextRequest, max: number): Promise<Uint8Array> {
  if (Number(req.headers.get("content-length")) > max) throw new AppError("FILE_TOO_LARGE", "Ảnh gửi lên vượt quá 4 MB.", 413);
  const reader = req.body?.getReader();
  if (!reader) throw new AppError("EMPTY_BODY", "Yêu cầu chưa có dữ liệu.");
  const chunks: Uint8Array[] = []; let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) { await reader.cancel(); throw new AppError("FILE_TOO_LARGE", "Dữ liệu gửi lên vượt giới hạn cho phép.", 413); }
    chunks.push(value);
  }
  const result = new Uint8Array(size); let at = 0;
  for (const chunk of chunks) { result.set(chunk, at); at += chunk.length; }
  return result;
}
