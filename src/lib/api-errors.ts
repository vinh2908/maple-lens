export class AppError extends Error {
  constructor(public code: string, message: string, public status = 400, public retryAfter?: number) {
    super(message);
  }
}

// Only bounded diagnostic categories may enter server logs. Never include the
// provider message, stack, headers, request URL, image or credential values.
export function providerDiagnostic(error: unknown) {
  const e = error as { status?: number; name?: string; message?: string; cause?: { code?: string } };
  const names = ["ApiError", "Error", "TypeError", "AbortError", "TimeoutError"];
  const codes = ["ECONNRESET", "ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "ETIMEDOUT", "UND_ERR_CONNECT_TIMEOUT", "CERT_HAS_EXPIRED", "UNABLE_TO_VERIFY_LEAF_SIGNATURE", "SELF_SIGNED_CERT_IN_CHAIN"];
  const message = String(e?.message ?? "");
  const reasons: [RegExp, string][] = [
    [/fetch failed|network|ECONN|ENOTFOUND|EAI_AGAIN/i, "network"],
    [/certificate|TLS|SSL/i, "tls"],
    [/RESOURCE_EXHAUSTED/i, "quota"],
    [/UNAVAILABLE|overloaded|capacity/i, "service_unavailable"],
    [/UNAUTHENTICATED|PERMISSION_DENIED/i, "authentication"],
    [/INVALID_ARGUMENT/i, "invalid_argument"],
    [/INTERNAL/i, "provider_internal"],
    [/Cannot read properties|is not a function/i, "runtime_type_error"],
  ];
  return {
    event: "gemini_failure", code: providerError(error).code,
    status: Number.isInteger(e?.status) && e.status! >= 100 && e.status! <= 599 ? e.status : null,
    name: names.includes(e?.name ?? "") ? e.name : "Other",
    reason: reasons.find(([pattern]) => pattern.test(message))?.[1] ?? "unclassified",
    networkCode: codes.includes(e?.cause?.code ?? "") ? e.cause!.code : null,
  };
}

export function providerError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  const e = error as { status?: number; message?: string; name?: string };
  const message = String(e?.message ?? "");
  if (e?.status === 504 || e?.status === 408 || e?.name === "AbortError" || e?.name === "TimeoutError" || /timeout|timed out|aborted/i.test(message)) {
    return new AppError("TIMEOUT", "Gemini chưa phản hồi trong thời gian cho phép. Bạn có thể bấm thử lại.", 504);
  }
  if (/API_KEY_EXPIRED|(?:api.?key|token|credential).{0,60}expir|expir.{0,60}(?:api.?key|token|credential)/i.test(message)) return new AppError("KEY_EXPIRED", "Thông tin xác thực Gemini đã hết hạn. Cần cập nhật key riêng trên máy chủ.", 401);
  if (/reported.{0,30}leaked|key.{0,30}leaked/i.test(message)) return new AppError("KEY_REVOKED", "Google đã chặn key do bị lộ. Cần thay key riêng trên máy chủ.", 403);
  if (/(?:location|region|country).{0,80}(?:not supported|unsupported|not available)|(?:not supported|unsupported|not available).{0,80}(?:location|region|country)/i.test(message)) return new AppError("REGION_UNSUPPORTED", "Gemini không hỗ trợ vị trí mạng của máy chủ hiện tại. Cần điều chỉnh nơi chạy backend.", 502);
  if (e?.status === 401 || /API_KEY_INVALID|API key not valid|invalid api key/i.test(message)) {
    return new AppError("INVALID_KEY", "Gemini API key không hợp lệ. Kiểm tra key riêng trên máy chủ.", 401);
  }
  if (e?.status === 403) return new AppError("KEY_PERMISSION", "Key bị từ chối, bị vô hiệu hóa hoặc không có quyền truy cập model. Kiểm tra Google AI Studio.", 403);
  if (e?.status === 429) {
    if (/billing|per.day|daily|limit\s*:\s*0|quota.{0,40}(exceeded|exhausted)/i.test(message) && !/per.minute|per.minute|rate.limit|retry.?delay/i.test(message)) return new AppError("QUOTA_EXCEEDED", "Gemini báo hết hạn mức. Kiểm tra quota và thanh toán trong Google AI Studio.", 429, 60);
    return new AppError("RATE_LIMIT", "Gemini đang giới hạn tốc độ. Chờ ít nhất một phút rồi bấm thử lại.", 429, 60);
  }
  if (e?.status === 404) return new AppError("MODEL_UNAVAILABLE", "Model đã chọn không khả dụng cho key này. Kiểm tra GEMINI_MODEL trên máy chủ.", 502);
  if (e?.status === 503) return new AppError("SERVICE_UNAVAILABLE", "Gemini đang tạm thời quá tải hoặc không khả dụng (HTTP 503). Vui lòng chờ rồi bấm thử lại.", 503, 30);
  if (e?.status === 400) return new AppError("PROVIDER_REQUEST", "Gemini từ chối yêu cầu (HTTP 400). Chưa xác định được nguyên nhân; cần kiểm tra cấu hình API phía máy chủ.", 502);
  return new AppError("PROVIDER_ERROR", "Không nhận được kết quả từ Gemini. Kiểm tra kết nối máy chủ và thử lại sau.", 502);
}
