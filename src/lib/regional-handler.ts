// Server route only: never import this module from a client component.
import { timingSafeEqual } from "node:crypto";
import { AppError, providerError } from "./api-errors";
import { MAX_UPLOAD_BYTES } from "./contracts";
import { analyzeWithGemini, testWithGemini } from "./gemini-core";
import { assertValidImageHeader } from "./image-header";
import { limitApi } from "./rate-limit";

type RegionalEnv = {
  GEMINI_RELAY_TOKEN?: string; GEMINI_API_KEY?: string;
  GEMINI_MODEL?: string; VERCEL_REGION?: string;
};
const services = { analyze: analyzeWithGemini, connection: testWithGemini, limit: limitApi };
function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
}
async function imageBody(request: Request) {
  if (Number(request.headers.get("content-length")) > MAX_UPLOAD_BYTES) throw new AppError("FILE_TOO_LARGE", "Ảnh gửi lên vượt quá 4 MB.", 413);
  const reader = request.body?.getReader();
  if (!reader) throw new AppError("MISSING_IMAGE", "Chưa có ảnh để phân tích.");
  const chunks: Uint8Array[] = []; let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > MAX_UPLOAD_BYTES) {
      await reader.cancel();
      throw new AppError("FILE_TOO_LARGE", "Ảnh gửi lên vượt quá 4 MB.", 413);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks, length);
}

export async function handleRegional(request: Request, env: RegionalEnv, api = services) {
  const started = performance.now();
  try {
    const token = env.GEMINI_RELAY_TOKEN;
    if (!token || !/^[A-Za-z0-9_-]{43,128}$/.test(token)) throw new AppError("BACKEND_NOT_CONFIGURED", "Backend vùng chưa có mã xác thực hợp lệ.", 503);
    const received = Buffer.from(request.headers.get("authorization") ?? "");
    const expected = Buffer.from(`Bearer ${token}`);
    if (received.length !== expected.length || !timingSafeEqual(received, expected)) throw new AppError("BACKEND_AUTH", "Yêu cầu đến backend vùng chưa được xác thực.", 401);
    const model = env.GEMINI_MODEL?.trim() || "gemini-3.5-flash-lite";
    const configured = Boolean(env.GEMINI_API_KEY && env.GEMINI_API_KEY !== "your_gemini_api_key_here");
    if (request.method === "GET") return json({ configured, model, region: env.VERCEL_REGION || null });
    if (request.method !== "POST") throw new AppError("METHOD_NOT_ALLOWED", "Chỉ chấp nhận GET hoặc POST.", 405);
    const action = new URL(request.url).searchParams.get("action");
    if (action !== "connection" && action !== "analyze") throw new AppError("INVALID_BODY", "Thao tác backend không hợp lệ.");
    if (!configured) throw new AppError("MISSING_KEY", "Backend Vercel chưa được cấu hình Gemini API key.", 503);
    api.limit();
    const gemini = { apiKey: env.GEMINI_API_KEY!, model };
    if (action === "connection") {
      const actualModel = await api.connection(gemini);
      return json({ ok: true, model: actualModel, elapsedMs: Math.round(performance.now() - started) });
    }
    if (request.headers.get("content-type") !== "image/jpeg") throw new AppError("INVALID_IMAGE_TYPE", "Backend chỉ nhận ảnh JPEG đã chuẩn hóa.", 415);
    const bytes = await imageBody(request);
    assertValidImageHeader(bytes, "image/jpeg");
    const result = await api.analyze(gemini, bytes.toString("base64"), "image/jpeg");
    return json({ ...result, source: "gemini", elapsedMs: Math.round(performance.now() - started) });
  } catch (error) {
    const e = providerError(error);
    const response = json({ error: { code: e.code, message: e.message, ...(e.retryAfter ? { retryAfter: e.retryAfter } : {}) } }, e.status);
    if (e.retryAfter) response.headers.set("Retry-After", String(e.retryAfter));
    return response;
  }
}
