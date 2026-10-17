import { AppError } from "./api-errors";

// Global process limits prevent untrusted proxy headers from bypassing quotas.
// Use a shared store / gateway when scaling beyond one Node process.
const windows = new Map<string, { count: number; resetAt: number }>();
export function consumeLimit(key: string, limit: number, windowMs: number, now = Date.now()) {
  let entry = windows.get(key);
  if (!entry || entry.resetAt <= now) {
    entry = { count: 0, resetAt: now + windowMs };
    windows.set(key, entry);
  }
  if (entry.count >= limit) throw new AppError("LOCAL_RATE_LIMIT", "Bản thử nghiệm đã đạt giới hạn yêu cầu. Vui lòng chờ rồi thử lại.", 429, Math.ceil((entry.resetAt - now) / 1000));
  entry.count++;
}

export function limitApi() {
  consumeLimit("api-minute", 12, 60_000);
  consumeLimit("api-day", 100, 86_400_000);
}
