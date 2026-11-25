import { NextRequest } from "next/server";
import { authenticatedWithState, corsHeaders, DEFAULT_MODEL, isAuthRequired, isLocal, json } from "@/lib/server";
import { getDomainAuthState, getFallbackPassword, getSiteDomain } from "@/lib/kv";

export const runtime = "nodejs";

export async function OPTIONS(req: NextRequest) {
  return new Response(null, { status: 204, headers: corsHeaders(req) });
}

export async function GET(req: NextRequest) {
  const domain = getSiteDomain(req);
  const state = await getDomainAuthState(domain);
  const authRequired = isAuthRequired(state);
  return json(
    {
      configured: Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== "your_gemini_api_key_here"),
      model: process.env.GEMINI_MODEL?.trim() || DEFAULT_MODEL,
      authenticated: authenticatedWithState(req, state),
      authRequired,
      authUnavailable: !state.pwHash && !getFallbackPassword() && !isLocal(req),
      locked: state.locked,
      domain,
    },
    200,
    corsHeaders(req)
  );
}
