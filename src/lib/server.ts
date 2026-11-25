import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { AppError, providerError } from "./api-errors";
import { limitApi } from "./rate-limit";
import {
  type DomainAuthState,
  getAuthSigningSecret,
  getDomainAuthState,
  getDomainsList,
  getFallbackPassword,
  getSiteDomain,
} from "./kv";

export const COOKIE_NAME = "maple_session";
export const REMEMBER_COOKIE_NAME = "maple_remember";
export const APP_TOKEN_HEADER = "x-app-token";
export const ADMIN_PASSWORD_HEADER = "x-admin-password";
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

export function signAuthToken(state: DomainAuthState, ttlMs: number) {
  const body = `${Date.now() + ttlMs}.${randomBytes(16).toString("hex")}`;
  const mac = createHmac("sha256", getAuthSigningSecret(state)).update(body).digest("hex");
  return `${body}.${mac}`;
}

export function verifyAuthToken(token: string, state: DomainAuthState): boolean {
  if (!token) return false;
  const [expires, nonce, mac] = token.split(".");
  if (!expires || !nonce || !mac || Number(expires) < Date.now()) return false;
  const expected = createHmac("sha256", getAuthSigningSecret(state)).update(`${expires}.${nonce}`).digest("hex");
  return equalsSecret(mac, expected);
}

export function isAuthRequired(state: DomainAuthState): boolean {
  if (process.env.VERCEL_ENV === "production") return true;
  return Boolean(state.pwHash || getFallbackPassword());
}

export function authenticatedWithState(req: NextRequest, state: DomainAuthState): boolean {
  if (!isAuthRequired(state)) return true;
  if (!state.pwHash && !getFallbackPassword()) return false;
  const headerToken = req.headers.get(APP_TOKEN_HEADER) ?? "";
  if (verifyAuthToken(headerToken, state)) return true;
  const rememberCookie = req.cookies.get(REMEMBER_COOKIE_NAME)?.value ?? "";
  if (verifyAuthToken(rememberCookie, state)) return true;
  return false;
}

export function checkOrigin(req: NextRequest) {
  const origin = req.headers.get("origin");
  if (origin && new URL(origin).host !== req.headers.get("host")) {
    throw new AppError("ORIGIN_REJECTED", "Yêu cầu phải xuất phát từ ứng dụng này.", 403);
  }
  if (req.headers.get("sec-fetch-site") === "cross-site") {
    throw new AppError("ORIGIN_REJECTED", "Yêu cầu khác nguồn đã bị chặn.", 403);
  }
}

export async function guardAsync(req: NextRequest) {
  checkOrigin(req);
  const domain = getSiteDomain(req);
  const state = await getDomainAuthState(domain);
  if (state.locked) {
    throw new AppError("DOMAIN_LOCKED", "Miền này hiện đã khóa.", 403);
  }
  if (!isAuthRequired(state)) {
    limitApi();
    return { domain, state };
  }
  if (!state.pwHash && !getFallbackPassword()) {
    throw new AppError("AUTH_NOT_CONFIGURED", "Máy chủ chưa cấu hình ADMIN_PASSWORD.", 503);
  }
  if (!authenticatedWithState(req, state)) {
    throw new AppError("AUTH_REQUIRED", "Vui lòng nhập mật khẩu để sử dụng.", 401);
  }
  limitApi();
  return { domain, state };
}

export function getGeminiConfig() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === "your_gemini_api_key_here") {
    throw new AppError("MISSING_KEY", "Chưa cấu hình Gemini API key trên máy chủ.", 503);
  }
  return { apiKey, model: process.env.GEMINI_MODEL?.trim() || DEFAULT_MODEL };
}

export function allowedCorsOrigin(req: NextRequest): string | null {
  const origin = req.headers.get("origin");
  if (!origin) return null;
  try {
    const originUrl = new URL(origin);
    if (originUrl.host === req.headers.get("host")) return originUrl.origin;
    const allowed = getDomainsList().map(d => {
      try { return new URL(d.startsWith("http") ? d : `https://${d}`).origin; }
      catch { return ""; }
    });
    if (allowed.includes(originUrl.origin)) return originUrl.origin;
  } catch {}
  return null;
}

export function corsHeaders(req: NextRequest): Record<string, string> {
  const allowed = allowedCorsOrigin(req);
  if (!allowed) return {};
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": `Content-Type, ${ADMIN_PASSWORD_HEADER}`,
    "Vary": "Origin",
  };
}

export function json(data: unknown, status = 200, extraHeaders: Record<string, string> = {}) {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "no-store", ...extraHeaders } });
}

export function errorResponse(error: unknown, extraHeaders: Record<string, string> = {}) {
  const e = providerError(error);
  const res = json({ error: { code: e.code, message: e.message, ...(e.retryAfter ? { retryAfter: e.retryAfter } : {}) } }, e.status, extraHeaders);
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
