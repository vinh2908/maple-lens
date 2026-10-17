// Imported only by the Sites Worker, never by the browser.
import { z } from "zod";
import { AppError, providerDiagnostic } from "./api-errors";
import { analysisSchema, MAX_UPLOAD_BYTES, validateAnalysis } from "./contracts";

export type RelayConfig = { url: string; token: string };
export function relayConfig(env: { GEMINI_BACKEND_URL?: string; GEMINI_RELAY_TOKEN?: string }): RelayConfig | null {
  if (!env.GEMINI_BACKEND_URL && !env.GEMINI_RELAY_TOKEN) return null;
  try {
    const url = new URL(env.GEMINI_BACKEND_URL!);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.port || url.pathname !== "/api/regional" || !/^[A-Za-z0-9_-]{43,128}$/.test(env.GEMINI_RELAY_TOKEN ?? "")) throw new Error();
    return { url: url.href, token: env.GEMINI_RELAY_TOKEN! };
  } catch { throw new AppError("BACKEND_NOT_CONFIGURED", "Cấu hình kết nối tới backend Vercel chưa đầy đủ.", 503); }
}

const modelSchema = z.string().min(1).max(100).regex(/^[a-zA-Z0-9._/-]+$/);
const connectionSchema = z.object({ ok: z.literal(true), model: modelSchema });
const resultSchema = z.object({ analysis: analysisSchema, model: modelSchema, source: z.literal("gemini") });
const healthSchema = z.object({ configured: z.boolean(), model: modelSchema, region: z.string().max(30).regex(/^[a-z0-9-]+$/).nullable() });
const errors: Record<string, [number, string]> = {
  MISSING_KEY: [503, "Backend Vercel chưa có Gemini API key."],
  BACKEND_NOT_CONFIGURED: [503, "Backend Vercel chưa được cấu hình đầy đủ."],
  BACKEND_AUTH: [502, "Mã xác thực giữa ứng dụng và backend Vercel chưa khớp."],
  INVALID_KEY: [401, "Gemini API key không hợp lệ. Kiểm tra key riêng trên Vercel."],
  KEY_EXPIRED: [401, "Gemini API key đã hết hạn. Cần cập nhật key riêng trên Vercel."],
  KEY_REVOKED: [403, "Google đã chặn key do bị lộ. Cần thay key riêng trên Vercel."],
  KEY_PERMISSION: [403, "Gemini từ chối quyền truy cập của key hoặc model."],
  REGION_UNSUPPORTED: [502, "Gemini vẫn từ chối vị trí máy chủ Vercel. Cần kiểm tra vùng chạy thực tế."],
  QUOTA_EXCEEDED: [429, "Gemini báo hết hạn mức. Kiểm tra quota trong Google AI Studio."],
  RATE_LIMIT: [429, "Gemini đang giới hạn tốc độ. Chờ ít nhất một phút rồi thử lại."],
  LOCAL_RATE_LIMIT: [429, "Đã đạt giới hạn yêu cầu. Vui lòng chờ rồi thử lại."],
  MODEL_UNAVAILABLE: [502, "Model đã chọn không khả dụng cho key này. Kiểm tra GEMINI_MODEL trên Vercel."],
  PROVIDER_REQUEST: [502, "Gemini từ chối yêu cầu (HTTP 400). Cần kiểm tra cấu hình API trên Vercel."],
  PROVIDER_ERROR: [502, "Backend Vercel không nhận được kết quả từ Gemini. Vui lòng thử lại sau."],
  SERVICE_UNAVAILABLE: [503, "Gemini đang tạm thời quá tải hoặc không khả dụng (HTTP 503). Chờ một lúc rồi bấm thử lại."],
  TIMEOUT: [504, "Gemini chưa phản hồi trong thời gian cho phép. Bạn có thể bấm thử lại."],
  REFUSED: [422, "Gemini đã từ chối xử lý yêu cầu này. Không có đáp án được tạo."],
  EMPTY_RESPONSE: [502, "Gemini không trả nội dung. Không có đáp án để hiển thị."],
  INCOMPLETE_RESPONSE: [502, "Gemini dừng trước khi hoàn tất. Không hiển thị kết quả chưa đầy đủ."],
  INVALID_RESPONSE: [502, "Gemini trả dữ liệu sai định dạng hoặc không nhất quán. Không hiển thị đáp án."],
  UNEXPECTED_TEST_RESPONSE: [502, "API có phản hồi nhưng chưa đạt kiểm tra kết nối."],
  INVALID_IMAGE: [415, "Ảnh bị hỏng hoặc không đọc được. Hãy chọn ảnh khác hoặc chụp lại."],
  INVALID_IMAGE_TYPE: [415, "Backend chỉ nhận ảnh JPEG. Hãy chọn ảnh qua ứng dụng."],
  FILE_TOO_LARGE: [413, "Ảnh gửi lên vượt quá 4 MB. Hãy chọn vùng nhỏ hơn."],
};

async function call(config: RelayConfig, action: "health" | "connection" | "analyze", bytes?: Uint8Array, transport: typeof fetch = fetch): Promise<unknown> {
  if (bytes && bytes.byteLength > MAX_UPLOAD_BYTES) throw new AppError("FILE_TOO_LARGE", "Ảnh gửi lên vượt quá 4 MB.", 413);
  const url = new URL(config.url);
  if (action !== "health") url.searchParams.set("action", action);
  let response: Response; let raw: unknown;
  try {
    response = await transport.call(globalThis, url.href, {
      method: action === "health" ? "GET" : "POST",
      headers: { Authorization: `Bearer ${config.token}`, ...(bytes ? { "Content-Type": "image/jpeg" } : {}) },
      body: bytes as BodyInit | undefined,
      redirect: "manual", signal: AbortSignal.timeout(action === "health" ? 8_000 : 40_000),
    });
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel();
      throw new AppError("BACKEND_REDIRECT", "Backend chuyển hướng yêu cầu. Cần dùng đúng địa chỉ production trên Vercel.", 502);
    }
    // Bound the response too; do not read arbitrary error pages into memory.
    if (!response.headers.get("content-type")?.includes("application/json")) {
      const status = response.status;
      await response.body?.cancel();
      console.warn(JSON.stringify({ event: "regional_non_json_response", status, action }));
      if (status === 408 || status === 504) throw new AppError("TIMEOUT", "Backend chưa trả kết quả trong thời gian cho phép. Bạn có thể bấm thử lại.", 504);
      if (status >= 500) throw new AppError("BACKEND_UNAVAILABLE", `Backend hoặc dịch vụ AI tạm thời không khả dụng (HTTP ${status}). Chờ một lúc rồi bấm thử lại.`, 503, 30);
      throw new AppError("BACKEND_INVALID_RESPONSE", "Backend Vercel không trả dữ liệu JSON. Kiểm tra đường dẫn và quyền truy cập deployment.", 502);
    }
    const reader = response.body?.getReader();
    if (!reader) throw new Error();
    const chunks: Uint8Array[] = []; let length = 0;
    while (true) {
      const part = await reader.read(); if (part.done) break;
      length += part.value.byteLength;
      if (length > 256 * 1024) { await reader.cancel(); throw new AppError("BACKEND_INVALID_RESPONSE", "Phản hồi backend vượt giới hạn cho phép.", 502); }
      chunks.push(part.value);
    }
    const data = new Uint8Array(length); let at = 0;
    for (const chunk of chunks) { data.set(chunk, at); at += chunk.length; }
    try { raw = JSON.parse(new TextDecoder().decode(data)); }
    catch { throw new AppError("BACKEND_INVALID_RESPONSE", "Backend Vercel trả dữ liệu sai định dạng. Không hiển thị đáp án.", 502); }
  } catch (error) {
    if (error instanceof AppError) throw error;
    const message = String((error as Error)?.message ?? "");
    const diagnostic = providerDiagnostic(error);
    const reason = /illegal invocation/i.test(message) ? "unbound_fetch"
      : /redirect/i.test(message) ? "redirect_mode"
      : /denied|blocked|disallowed|prohibited|permission|not allowed/i.test(message) ? "egress_denied"
      : /URL|argument|parameter/i.test(message) ? "invalid_request"
      : diagnostic.reason;
    console.warn(JSON.stringify({ ...diagnostic, event: "regional_transport_failure", reason, action }));
    if (["TimeoutError", "AbortError"].includes((error as Error)?.name)) throw new AppError("TIMEOUT", "Backend Vercel chưa phản hồi kịp. Bạn có thể bấm thử lại.", 504);
    throw new AppError("BACKEND_UNAVAILABLE", "Không kết nối được backend Vercel. Chưa có kết quả phân tích.", 502);
  }
  if (!response.ok) {
    const parsed = z.object({ error: z.object({ code: z.string(), retryAfter: z.number().int().min(1).max(86400).optional() }) }).safeParse(raw);
    const safe = parsed.success ? errors[parsed.data.error.code] : undefined;
    if (safe && parsed.success) throw new AppError(parsed.data.error.code, safe[1], safe[0], parsed.data.error.retryAfter);
    throw new AppError("BACKEND_UNAVAILABLE", "Backend Vercel từ chối yêu cầu hoặc chưa sẵn sàng. Không có đáp án để hiển thị.", 502);
  }
  return raw;
}
function invalidResponse() { return new AppError("BACKEND_INVALID_RESPONSE", "Phản hồi backend không hợp lệ. Không có đáp án để hiển thị.", 502); }
export async function regionalHealth(config: RelayConfig, transport?: typeof fetch) {
  const raw = await call(config, "health", undefined, transport);
  const parsed = healthSchema.safeParse(raw);
  if (!parsed.success) throw invalidResponse();
  return parsed.data;
}
export async function regionalConnection(config: RelayConfig, transport?: typeof fetch) {
  const raw = await call(config, "connection", undefined, transport);
  const parsed = connectionSchema.safeParse(raw);
  if (!parsed.success) throw invalidResponse();
  return parsed.data.model;
}
export async function regionalAnalyze(config: RelayConfig, bytes: Uint8Array, transport?: typeof fetch) {
  const raw = await call(config, "analyze", bytes, transport);
  try {
    const parsed = resultSchema.parse(raw);
    return { analysis: validateAnalysis(parsed.analysis), model: parsed.model };
  } catch { throw invalidResponse(); }
}
