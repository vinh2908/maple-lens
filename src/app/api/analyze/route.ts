import { NextRequest } from "next/server";
import sharp from "sharp";
import { AppError } from "@/lib/api-errors";
import { ACCEPTED_TYPES, MAX_UPLOAD_BYTES } from "@/lib/contracts";
import { boundedBody, errorResponse, getGeminiConfig, guard, json } from "@/lib/server";
import { analyzeImage } from "@/lib/gemini";
export const runtime = "nodejs";
export const maxDuration = 45;
export async function POST(req: NextRequest) {
  const started = performance.now();
  try {
    guard(req);
    const type = req.headers.get("content-type") ?? "";
    if (!type.startsWith("multipart/form-data;")) throw new AppError("INVALID_BODY", "Vui lòng gửi một ảnh bằng biểu mẫu tải lên.");
    const body = await boundedBody(req, MAX_UPLOAD_BYTES + 64 * 1024);
    let form: FormData;
    try { form = await new Response(body as BodyInit, { headers: { "Content-Type": type } }).formData(); }
    catch { throw new AppError("INVALID_BODY", "Dữ liệu ảnh gửi lên không hợp lệ."); }
    const file = form.get("image");
    if (!(file instanceof File) || !file.size) throw new AppError("MISSING_IMAGE", "Chưa có ảnh để phân tích.");
    if (file.size > MAX_UPLOAD_BYTES) throw new AppError("FILE_TOO_LARGE", "Ảnh gửi lên không được vượt quá 4 MB.", 413);
    if (!ACCEPTED_TYPES.includes(file.type)) throw new AppError("INVALID_IMAGE_TYPE", "Chỉ chấp nhận ảnh JPEG, PNG hoặc WebP.", 415);
    const bytes = Buffer.from(await file.arrayBuffer());
    const tPrepStart = performance.now();
    let normalized: Buffer;
    try {
      const image = sharp(bytes, { limitInputPixels: 24_000_000, animated: false, failOn: "error" });
      const meta = await image.metadata();
      const formatType = { jpeg: "image/jpeg", png: "image/png", webp: "image/webp" }[meta.format as "jpeg" | "png" | "webp"];
      if (formatType !== file.type || (meta.pages ?? 1) > 1) throw new Error("INVALID_FORMAT");
      if (!meta.width || !meta.height || meta.width < 24 || meta.height < 24) throw new Error("TOO_SMALL");
      normalized = await image.rotate().resize({ width: 1200, height: 1200, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 88 }).toBuffer();
    } catch { throw new AppError("INVALID_IMAGE", "Ảnh hỏng, quá lớn, quá nhỏ hoặc không đúng định dạng. Hãy chọn ảnh JPEG/PNG/WebP rõ hơn.", 415); }
    const imagePrepMs = Math.round(performance.now() - tPrepStart);
    const typeHint = form.get("typeHint")?.toString();
    const validHint = typeHint === "distorted_text" || typeHint === "sentence_choice" ? typeHint : undefined;
    getGeminiConfig();
    const result = await analyzeImage(normalized, "image/jpeg", validHint);
    const serverMs = Math.round(performance.now() - started);
    return json({ ...result, serverMs, imagePrepMs, elapsedMs: serverMs, source: "gemini" });
  } catch (e) { return errorResponse(e); }
}
