import { NextRequest } from "next/server";
import { requireAdminHeader } from "@/lib/admin-auth";
import { getDomainsList, getDomainStats, kvConfigured } from "@/lib/kv";
import { corsHeaders, DEFAULT_MODEL, errorResponse, json } from "@/lib/server";

export const runtime = "nodejs";

export async function OPTIONS(req: NextRequest) {
  return new Response(null, { status: 204, headers: corsHeaders(req) });
}

export async function GET(req: NextRequest) {
  const headers = corsHeaders(req);
  try {
    const { domain } = await requireAdminHeader(req);
    const stats = await getDomainStats(domain);
    return json(
      {
        ...stats,
        online: true,
        configured: Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== "your_gemini_api_key_here"),
        model: process.env.GEMINI_MODEL?.trim() || DEFAULT_MODEL,
        kvConfigured: kvConfigured(),
        domainsList: getDomainsList(),
      },
      200,
      headers
    );
  } catch (e) {
    return errorResponse(e, headers);
  }
}
