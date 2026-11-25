import { NextRequest } from "next/server";
import { requireAdminHeader } from "@/lib/admin-auth";
import { AppError } from "@/lib/api-errors";
import { kvConfigured, setDomainLockedState } from "@/lib/kv";
import { boundedBody, corsHeaders, errorResponse, json } from "@/lib/server";

export const runtime = "nodejs";

export async function OPTIONS(req: NextRequest) {
  return new Response(null, { status: 204, headers: corsHeaders(req) });
}

export async function POST(req: NextRequest) {
  const headers = corsHeaders(req);
  try {
    const { domain } = await requireAdminHeader(req);
    if (!kvConfigured()) {
      throw new AppError("KV_NOT_CONFIGURED", "Chưa cấu hình Vercel KV nên không thể đổi trạng thái khóa.", 503);
    }
    let body: { locked?: boolean };
    try {
      body = JSON.parse(new TextDecoder().decode(await boundedBody(req, 1024)));
    } catch (e) {
      if (e instanceof AppError) throw e;
      throw new AppError("INVALID_BODY", "Dữ liệu gửi lên không hợp lệ.");
    }
    if (typeof body.locked !== "boolean") {
      throw new AppError("INVALID_BODY", "Trạng thái khóa phải là true hoặc false.", 400);
    }
    await setDomainLockedState(domain, body.locked);
    return json({ ok: true, domain, locked: body.locked }, 200, headers);
  } catch (e) {
    return errorResponse(e, headers);
  }
}
