import "server-only";
import { NextRequest } from "next/server";
import { AppError } from "./api-errors";
import {
  getDomainAuthState,
  getFallbackPassword,
  getSiteDomain,
  verifyPasswordAgainstState,
} from "./kv";
import { ADMIN_PASSWORD_HEADER, allowedCorsOrigin } from "./server";

export async function requireAdminHeader(req: NextRequest) {
  const origin = req.headers.get("origin");
  if (origin && !allowedCorsOrigin(req)) {
    throw new AppError("ORIGIN_REJECTED", "Nguồn truy cập không được phép.", 403);
  }
  const domain = getSiteDomain(req);
  const state = await getDomainAuthState(domain);
  if (!state.pwHash && !getFallbackPassword()) {
    throw new AppError("AUTH_NOT_CONFIGURED", "Máy chủ chưa cấu hình ADMIN_PASSWORD.", 503);
  }
  const candidate = req.headers.get(ADMIN_PASSWORD_HEADER) ?? "";
  if (!verifyPasswordAgainstState(candidate, state)) {
    throw new AppError("INVALID_PASSWORD", "Mật khẩu quản trị chưa đúng.", 401);
  }
  return { domain, state };
}
