import { assets } from "@site-assets";
import { analyzeWithGemini, testWithGemini } from "../src/lib/gemini-core";
import { AppError, providerError } from "../src/lib/api-errors";
import { MAX_UPLOAD_BYTES } from "../src/lib/contracts";
import { jpegDimensions } from "./image-validation";
import { relayConfig, regionalAnalyze, regionalConnection, regionalHealth } from "../src/lib/regional-client";

type D1Result = { results: unknown[]; success: boolean };
type Statement = { bind(...values: (string | number)[]): Statement };
type Env = { GEMINI_API_KEY?: string; GEMINI_MODEL?: string; GEMINI_BACKEND_URL?: string; GEMINI_RELAY_TOKEN?: string; DB?: { prepare(sql: string): Statement; batch(statements: Statement[]): Promise<D1Result[]> } };

function placement(request: Request) {
  const value = request.headers.get("cf-placement");
  return value && /^(?:remote|local)-[A-Z]{3}$/.test(value) ? value : null;
}

function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
}
function config(env: Env) {
  if (!env.GEMINI_API_KEY) throw new AppError("MISSING_KEY", "Máy chủ chưa có Gemini API key.", 503);
  return { apiKey: env.GEMINI_API_KEY, model: env.GEMINI_MODEL || "gemini-3.1-flash-lite" };
}
export async function limitHosted(env: Env, now = Date.now()) {
  if (!env.DB) throw new AppError("LIMITER_UNAVAILABLE", "Bộ giới hạn yêu cầu chưa sẵn sàng. Chưa gửi yêu cầu đến Gemini.", 503);
  const statement = `INSERT INTO request_limits (bucket, count, reset_at) VALUES (?, 1, ?) ON CONFLICT(bucket) DO UPDATE SET count = request_limits.count + 1 WHERE request_limits.count < ? RETURNING count`;
  const minute = Math.floor(now / 60_000); const day = Math.floor(now / 86_400_000);
  let result: D1Result[];
  try {
    result = await env.DB.batch([
      env.DB.prepare(statement).bind(`minute:${minute}`, (minute + 1) * 60_000, 12),
      env.DB.prepare(statement).bind(`day:${day}`, (day + 1) * 86_400_000, 100),
      env.DB.prepare("DELETE FROM request_limits WHERE reset_at < ?").bind(now - 86_400_000),
    ]);
  } catch { throw new AppError("LIMITER_UNAVAILABLE", "Chưa kiểm tra được giới hạn yêu cầu. Chưa gửi ảnh đến Gemini.", 503); }
  if (!result[0]?.results?.length || !result[1]?.results?.length) {
    const retry = !result[1]?.results?.length ? Math.ceil(((day + 1) * 86_400_000 - now) / 1000) : Math.ceil(((minute + 1) * 60_000 - now) / 1000);
    throw new AppError("LOCAL_RATE_LIMIT", "Đã đạt giới hạn thử nghiệm (12 yêu cầu/phút, 100/ngày). Vui lòng chờ rồi thử lại.", 429, retry);
  }
}
async function readBody(request: Request, max: number) {
  if (Number(request.headers.get("Content-Length")) > max) throw new AppError("FILE_TOO_LARGE", "Ảnh gửi lên vượt giới hạn 4 MB.", 413);
  const reader = request.body?.getReader();
  if (!reader) throw new AppError("EMPTY_BODY", "Yêu cầu chưa có dữ liệu ảnh.");
  const chunks: Uint8Array[] = []; let length = 0;
  while (true) {
    const part = await reader.read(); if (part.done) break;
    length += part.value.length;
    if (length > max) { await reader.cancel(); throw new AppError("FILE_TOO_LARGE", "Ảnh gửi lên vượt giới hạn 4 MB.", 413); }
    chunks.push(part.value);
  }
  const data = new Uint8Array(length); let at = 0;
  for (const chunk of chunks) { data.set(chunk, at); at += chunk.length; }
  return data;
}
function base64(bytes: Uint8Array) {
  let text = "";
  for (let at = 0; at < bytes.length; at += 8192) text += String.fromCharCode(...bytes.subarray(at, at + 8192));
  return btoa(text);
}
function checkOrigin(request: Request) {
  const origin = request.headers.get("Origin");
  if ((origin && origin !== new URL(request.url).origin) || request.headers.get("Sec-Fetch-Site") === "cross-site") throw new AppError("ORIGIN_REJECTED", "Yêu cầu khác nguồn đã bị chặn.", 403);
}

// Hosting remains owner-private. Sites dispatch authenticates every browser/API
// request before invoking this Worker, including supported service requests.
// No separate app OAuth/password flow is added to this private hosted adapter.
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url); const started = performance.now();
    try {
      if (url.pathname.startsWith("/api/")) {
        if (url.pathname === "/api/status" && request.method === "GET") return json({
          configured: Boolean(relayConfig(env) || env.GEMINI_API_KEY), model: env.GEMINI_MODEL || "gemini-3.1-flash-lite",
          authenticated: true, authRequired: false, authUnavailable: false,
          observedPlacement: placement(request),
        });
        // Owner-private hosting authenticates this diagnostic route. It never
        // sends credentials or photos, and does not consume Gemini quota.
        if (url.pathname === "/api/runtime" && request.method === "GET") {
          const relay = relayConfig(env);
          if (relay) return json({ backend: "vercel", ...await regionalHealth(relay) });
          let outboundLocation: { country: string | null; colo: string | null } | null = null;
          try {
            const response = await fetch("https://www.cloudflare.com/cdn-cgi/trace", { signal: AbortSignal.timeout(3000), redirect: "error" });
            if (response.ok) {
              const trace = await response.text();
              outboundLocation = { country: /^loc=([A-Z]{2})$/m.exec(trace)?.[1] ?? null, colo: /^colo=([A-Z]{3})$/m.exec(trace)?.[1] ?? null };
            }
          } catch { /* A trace failure is not proof of a Gemini failure. */ }
          return json({ observedPlacement: placement(request), outboundLocation });
        }
        if (!["/api/connection", "/api/analyze"].includes(url.pathname)) return json({ error: { code: "NOT_FOUND", message: "API không tồn tại." } }, 404);
        if (request.method !== "POST") return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Chỉ chấp nhận yêu cầu POST." } }, 405);
        checkOrigin(request);
        const relay = relayConfig(env);
        // A configured regional backend is authoritative. Never retry at the
        // edge if it fails (that would reintroduce region errors and API cost).
        if (!relay) config(env);
        await limitHosted(env);
        if (url.pathname === "/api/connection") {
          const model = relay ? await regionalConnection(relay) : await testWithGemini(config(env));
          return json({ ok: true, model, elapsedMs: Math.round(performance.now() - started), message: "Kết nối văn bản thành công. Điều này chưa kiểm chứng khả năng đọc ảnh hay giải đúng thử thách." });
        }
        const type = request.headers.get("Content-Type") || "";
        if (!type.startsWith("multipart/form-data;")) throw new AppError("INVALID_BODY", "Vui lòng chọn ảnh trong ứng dụng trước khi phân tích.");
        const data = await readBody(request, MAX_UPLOAD_BYTES + 64 * 1024);
        let form: FormData;
        try { form = await new Response(data as BodyInit, { headers: { "Content-Type": type } }).formData(); }
        catch { throw new AppError("INVALID_BODY", "Biểu mẫu ảnh không hợp lệ."); }
        const file = form.get("image");
        if (!file || typeof file === "string" || !file.size) throw new AppError("MISSING_IMAGE", "Chưa có ảnh để phân tích.");
        if (file.size > MAX_UPLOAD_BYTES) throw new AppError("FILE_TOO_LARGE", "Ảnh gửi lên không được vượt quá 4 MB.", 413);
        if (file.type !== "image/jpeg") throw new AppError("INVALID_IMAGE_TYPE", "Hãy dùng bộ chọn ảnh của ứng dụng để chuyển ảnh JPEG/PNG/WebP sang JPEG an toàn.", 415);
        const bytes = new Uint8Array(await file.arrayBuffer()); jpegDimensions(bytes);
        const result = relay ? await regionalAnalyze(relay, bytes) : await analyzeWithGemini(config(env), base64(bytes), "image/jpeg");
        return json({ ...result, elapsedMs: Math.round(performance.now() - started), source: "gemini" });
      }
      if (!["GET", "HEAD"].includes(request.method)) return new Response("Method not allowed", { status: 405 });
      const path = url.pathname === "/" ? "/index.html" : url.pathname;
      const asset = assets[path];
      if (!asset) return new Response("Not found", { status: 404 });
      const raw = atob(asset.body); const bytes = Uint8Array.from(raw, c => c.charCodeAt(0));
      return new Response(request.method === "HEAD" ? null : bytes, { headers: {
        "Content-Type": asset.type, "Cache-Control": path.startsWith("/_next/static/") ? "private, max-age=31536000, immutable" : "private, no-cache",
        "X-Content-Type-Options": "nosniff", "Referrer-Policy": "same-origin", "Permissions-Policy": "camera=(self), microphone=()", "X-Frame-Options": "DENY",
      } });
    } catch (error) {
      const e = providerError(error); const res = json({ error: { code: e.code, message: e.message, ...(e.retryAfter ? { retryAfter: e.retryAfter } : {}) } }, e.status);
      // Log only bounded app codes and placement metadata, never provider text,
      // headers, API keys, images or recognized content.
      if (url.pathname === "/api/analyze" || url.pathname === "/api/connection") console.warn(JSON.stringify({ event: "api_failure", route: url.pathname, code: e.code, status: e.status, placement: placement(request) }));
      if (e.retryAfter) res.headers.set("Retry-After", String(e.retryAfter));
      return res;
    }
  },
};
