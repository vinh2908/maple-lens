import { NextRequest } from "next/server";
import { errorResponse, guard, json } from "@/lib/server";
import { testConnection } from "@/lib/gemini";
export const runtime = "nodejs";
export const maxDuration = 40;
export async function POST(req: NextRequest) {
  const started = performance.now();
  try {
    guard(req);
    const model = await testConnection();
    return json({ ok: true, model, elapsedMs: Math.round(performance.now() - started), message: "Kết nối văn bản thành công. Điều này chưa kiểm chứng khả năng đọc ảnh hay giải đúng thử thách." });
  } catch (e) { return errorResponse(e); }
}
