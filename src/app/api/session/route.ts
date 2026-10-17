import { NextRequest } from "next/server";
import { AppError } from "@/lib/api-errors";
import { consumeLimit } from "@/lib/rate-limit";
import { boundedBody, checkOrigin, COOKIE_NAME, equalsSecret, errorResponse, json, signSession } from "@/lib/server";
export const runtime = "nodejs";
export async function POST(req: NextRequest) {
  try {
    checkOrigin(req);
    consumeLimit("login", 5, 60_000);
    if (!process.env.APP_PASSWORD) throw new AppError("AUTH_NOT_CONFIGURED", "Máy chủ chưa cấu hình mật khẩu ứng dụng.", 503);
    let body: { password?: string };
    try { body = JSON.parse(new TextDecoder().decode(await boundedBody(req, 2048))); }
    catch (e) { if (e instanceof AppError) throw e; throw new AppError("INVALID_BODY", "Yêu cầu đăng nhập không hợp lệ."); }
    if (!body || typeof body.password !== "string" || !equalsSecret(body.password, process.env.APP_PASSWORD)) throw new AppError("INVALID_PASSWORD", "Mật khẩu ứng dụng chưa đúng.", 401);
    const res = json({ ok: true });
    res.cookies.set(COOKIE_NAME, signSession(), { httpOnly: true, secure: !["localhost", "127.0.0.1", "[::1]"].includes(req.nextUrl.hostname), sameSite: "strict", maxAge: 12 * 60 * 60, path: "/" });
    return res;
  } catch (e) { return errorResponse(e); }
}
