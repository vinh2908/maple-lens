import { NextRequest } from "next/server";
import { requireAdminHeader } from "@/lib/admin-auth";
import { AppError } from "@/lib/api-errors";
import { kvConfigured, setDomainPassword, verifyPasswordAgainstState } from "@/lib/kv";
import { boundedBody, corsHeaders, errorResponse, json } from "@/lib/server";

export const runtime = "nodejs";

export async function OPTIONS(req: NextRequest) {
  return new Response(null, { status: 204, headers: corsHeaders(req) });
}

export async function POST(req: NextRequest) {
  const headers = corsHeaders(req);
  try {
    const { domain, state } = await requireAdminHeader(req);
    if (!kvConfigured()) {
      throw new AppError("KV_NOT_CONFIGURED", "Chưa cấu hình Vercel KV nên không thể đổi mật khẩu.", 503);
    }
    let body: { oldPassword?: string; newPassword?: string; confirmPassword?: string };
    try {
      body = JSON.parse(new TextDecoder().decode(await boundedBody(req, 4096)));
    } catch (e) {
      if (e instanceof AppError) throw e;
      throw new AppError("INVALID_BODY", "Dữ liệu gửi lên không hợp lệ.");
    }
    const oldPass = typeof body.oldPassword === "string" ? body.oldPassword : "";
    const newPass = typeof body.newPassword === "string" ? body.newPassword : "";
    if (!verifyPasswordAgainstState(oldPass, state)) {
      throw new AppError("INVALID_PASSWORD", "Mật khẩu cũ chưa đúng.", 401);
    }
    if (newPass.length < 4 || newPass.length > 128) {
      throw new AppError("INVALID_BODY", "Mật khẩu mới phải từ 4 đến 128 ký tự.", 400);
    }
    if (typeof body.confirmPassword === "string" && body.confirmPassword !== newPass) {
      throw new AppError("INVALID_BODY", "Mật khẩu xác nhận không khớp.", 400);
    }
    await setDomainPassword(domain, newPass);
    return json({ ok: true, domain }, 200, headers);
  } catch (e) {
    return errorResponse(e, headers);
  }
}
