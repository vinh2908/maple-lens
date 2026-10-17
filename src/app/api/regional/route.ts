import { handleRegional } from "@/lib/regional-handler";

export const runtime = "nodejs";
// Function placement is configured in vercel.json (iad1).
export const maxDuration = 45;
function handle(request: Request) {
  return handleRegional(request, {
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    GEMINI_MODEL: process.env.GEMINI_MODEL,
    GEMINI_RELAY_TOKEN: process.env.GEMINI_RELAY_TOKEN,
    VERCEL_REGION: process.env.VERCEL_REGION,
  });
}
export const GET = handle;
export const POST = handle;
