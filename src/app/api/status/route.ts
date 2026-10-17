import { NextRequest } from "next/server";
import { authenticated, DEFAULT_MODEL, isLocal, json } from "@/lib/server";
export const runtime = "nodejs";
export async function GET(req: NextRequest) {
  return json({
    configured: Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== "your_gemini_api_key_here"),
    model: process.env.GEMINI_MODEL?.trim() || DEFAULT_MODEL,
    authenticated: authenticated(req),
    authRequired: Boolean(process.env.APP_PASSWORD),
    authUnavailable: false,
  });
}
