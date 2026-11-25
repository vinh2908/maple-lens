import { NextRequest } from "next/server";
import { AppError } from "@/lib/api-errors";
import { consumeLimit } from "@/lib/rate-limit";
import {
  boundedBody,
  checkOrigin,
  errorResponse,
  isLocal,
  json,
  REMEMBER_COOKIE_NAME,
  signAuthToken,
} from "@/lib/server";
import {
  getDomainAuthState,
  getFallbackPassword,
  getSiteDomain,
  verifyPasswordAgainstState,
} from "@/lib/kv";

export const runtime = "nodejs";

const THIRTY_DAYS_SECONDS = 30 * 24 * 60 * 60;
const TWELVE_HOURS_MS = 12 * 60 * 60_000;

export async function POST(req: NextRequest) {
  try {
    checkOrigin(req);
    consumeLimit("login", 10, 60_000);
    const domain = getSiteDomain(req);
    const state = await getDomainAuthState(domain);

    if (!state.pwHash && !getFallbackPassword()) {
      throw new AppError("AUTH_NOT_CONFIGURED", "Máy chủ chưa cấu hình ADMIN_PASSWORD.", 503);
    }

    let body: { password?: string; remember?: boolean };
    try {
      body = JSON.parse(new TextDecoder().decode(await boundedBody(req, 2048)));
    } catch (e) {
      if (e instanceof AppError) throw e;
      throw new AppError("INVALID_BODY", "Yêu cầu đăng nhập không hợp lệ.");
    }

    if (!body || typeof body.password !== "string" || !verifyPasswordAgainstState(body.password, state)) {
      throw new AppError("INVALID_PASSWORD", "Mật khẩu chưa đúng.", 401);
    }

    const token = signAuthToken(state, TWELVE_HOURS_MS);
    const res = json({ ok: true, token, locked: state.locked, remembered: Boolean(body.remember) });

    if (body.remember) {
      const rememberToken = signAuthToken(state, THIRTY_DAYS_SECONDS * 1000);
      res.cookies.set(REMEMBER_COOKIE_NAME, rememberToken, {
        httpOnly: true,
        secure: !isLocal(req),
        sameSite: "lax",
        maxAge: THIRTY_DAYS_SECONDS,
        path: "/",
      });
    }

    return res;
  } catch (e) {
    return errorResponse(e);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    checkOrigin(req);
    const res = json({ ok: true });
    res.cookies.set(REMEMBER_COOKIE_NAME, "", {
      httpOnly: true,
      secure: !isLocal(req),
      sameSite: "lax",
      maxAge: 0,
      path: "/",
    });
    return res;
  } catch (e) {
    return errorResponse(e);
  }
}
