import { after, NextRequest } from "next/server";
import { AppError } from "@/lib/api-errors";
import { ACCEPTED_TYPES, MAX_UPLOAD_BYTES } from "@/lib/contracts";
import { assertValidImageHeader } from "@/lib/image-header";
import { getSiteDomain, recordUsageLog } from "@/lib/kv";
import { boundedBody, errorResponse, getGeminiConfig, guardAsync, json } from "@/lib/server";
import { analyzeImage } from "@/lib/gemini";

export const runtime = "nodejs";
export const maxDuration = 45;

export async function POST(req: NextRequest) {
  const started = performance.now();
  const domain = getSiteDomain(req);
  let shouldLog = false;

  try {
    await guardAsync(req);
    const type = req.headers.get("content-type") ?? "";
    if (!type.startsWith("multipart/form-data;")) {
      throw new AppError("INVALID_BODY", "Vui lòng gửi một ảnh bằng biểu mẫu tải lên.");
    }
    const body = await boundedBody(req, MAX_UPLOAD_BYTES + 64 * 1024);
    let form: FormData;
    try {
      form = await new Response(body as BodyInit, { headers: { "Content-Type": type } }).formData();
    } catch {
      throw new AppError("INVALID_BODY", "Dữ liệu ảnh gửi lên không hợp lệ.");
    }
    const file = form.get("image");
    if (!(file instanceof File) || !file.size) {
      throw new AppError("MISSING_IMAGE", "Chưa có ảnh để phân tích.");
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      throw new AppError("FILE_TOO_LARGE", "Ảnh gửi lên không được vượt quá 4 MB.", 413);
    }
    if (!ACCEPTED_TYPES.includes(file.type)) {
      throw new AppError("INVALID_IMAGE_TYPE", "Chỉ chấp nhận ảnh JPEG, PNG hoặc WebP.", 415);
    }

    const bytes = Buffer.from(await file.arrayBuffer());
    const tPrepStart = performance.now();
    assertValidImageHeader(bytes, file.type);
    const imagePrepMs = Math.round(performance.now() - tPrepStart);

    const typeHint = form.get("typeHint")?.toString();
    const validHint = typeHint === "sentence_choice" ? typeHint : undefined;
    getGeminiConfig();

    shouldLog = true;
    const result = await analyzeImage(bytes, file.type, validHint);
    const serverMs = Math.round(performance.now() - started);

    after(async () => {
      await recordUsageLog(domain, { ts: Date.now(), domain, ok: true, ms: serverMs });
    });

    return json({ ...result, serverMs, imagePrepMs, elapsedMs: serverMs, source: "gemini" });
  } catch (e) {
    if (shouldLog) {
      const failMs = Math.round(performance.now() - started);
      after(async () => {
        await recordUsageLog(domain, { ts: Date.now(), domain, ok: false, ms: failMs });
      });
    }
    return errorResponse(e);
  }
}
