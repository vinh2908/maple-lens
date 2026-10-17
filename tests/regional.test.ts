import { test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { NextRequest } from "next/server";
import { handleRegional } from "../src/lib/regional-handler";
import { relayConfig, regionalAnalyze, regionalConnection, regionalHealth } from "../src/lib/regional-client";
import { MAX_UPLOAD_BYTES } from "../src/lib/contracts";
import { demoResult } from "../src/lib/demo";
import { AppError } from "../src/lib/api-errors";
import { proxy } from "../src/proxy";

const token = "test-only-relay-token-" + "x".repeat(43);
const env = { GEMINI_RELAY_TOKEN: token, GEMINI_API_KEY: "PRIVATE_KEY_MARKER", GEMINI_MODEL: "gemini-3.1-flash-lite", VERCEL_REGION: "iad1" };
const relay = { url: "https://backend.example/api/regional", token };
function req(action = "connection", init: RequestInit = {}) {
  return new Request(`${relay.url}?action=${action}`, { method: "POST", ...init, headers: { authorization: `Bearer ${token}`, ...init.headers } });
}
function mocks() {
  const calls = { limit: 0, analyze: 0, connection: 0 };
  return { calls, services: {
    limit() { calls.limit++; },
    async connection() { calls.connection++; return env.GEMINI_MODEL; },
    async analyze(_config: unknown, data: string, type: string) {
      calls.analyze++;
      assert.equal(type, "image/jpeg");
      assert.equal((await sharp(Buffer.from(data, "base64")).metadata()).format, "jpeg");
      return { analysis: demoResult.analysis, model: env.GEMINI_MODEL, geminiMs: 42 };
    },
  } };
}
const isCode = (code: string) => (e: unknown) => e instanceof AppError && e.code === code;

test("relay rejects missing/wrong auth and missing configuration before quota or Gemini", async () => {
  const m = mocks();
  for (const [request, config, status] of [
    [new Request(relay.url), env, 401],
    [req("connection", { headers: { authorization: "Bearer wrong" } }), env, 401],
    [req(), { ...env, GEMINI_RELAY_TOKEN: "too-short" }, 503],
  ] as const) {
    const r = await handleRegional(request, config, m.services);
    assert.equal(r.status, status);
    assert.ok(!(await r.text()).includes("PRIVATE_KEY_MARKER"));
  }
  assert.deepEqual(m.calls, { limit: 0, analyze: 0, connection: 0 });
});

test("authenticated health reports actual runtime region without Gemini or quota", async () => {
  const m = mocks();
  const r = await handleRegional(req("", { method: "GET" }), env, m.services);
  assert.deepEqual(await r.json(), { configured: true, model: env.GEMINI_MODEL, region: "iad1" });
  assert.deepEqual(m.calls, { limit: 0, analyze: 0, connection: 0 });
  assert.match(r.headers.get("cache-control")!, /no-store/);
});

test("text test calls configured model once; missing key and bad actions never call Gemini", async () => {
  const m = mocks();
  assert.equal((await handleRegional(req(), env, m.services)).status, 200);
  assert.equal((await handleRegional(req(), { ...env, GEMINI_API_KEY: undefined }, m.services)).status, 503);
  assert.equal((await handleRegional(req("arbitrary-action"), env, m.services)).status, 400);
  assert.equal((await handleRegional(req("", { method: "DELETE" }), env, m.services)).status, 405);
  assert.deepEqual(m.calls, { limit: 1, analyze: 0, connection: 1 });
});

test("JPEG is validated/decoded before Gemini; false MIME, corruption and oversized streams fail", async () => {
  const m = mocks();
  const jpeg = await sharp({ create: { width: 64, height: 64, channels: 3, background: "white" } }).jpeg().toBuffer();
  const r = await handleRegional(req("analyze", { headers: { "content-type": "image/jpeg" }, body: jpeg }), env, m.services);
  assert.equal(r.status, 200);
  assert.equal((await r.json()).source, "gemini");
  for (const [body, headers, status] of [
    [jpeg, { "content-type": "image/png" }, 415],
    [Buffer.from("not a jpeg"), { "content-type": "image/jpeg" }, 415],
    [jpeg, { "content-type": "image/jpeg", "content-length": String(MAX_UPLOAD_BYTES + 1) }, 413],
    [Buffer.alloc(MAX_UPLOAD_BYTES + 1), { "content-type": "image/jpeg" }, 413],
  ] as const) {
    assert.equal((await handleRegional(req("analyze", { headers, body }), env, m.services)).status, status);
  }
  assert.equal(m.calls.analyze, 1);
});

test("provider refusal, quota and timeout are safe errors without results or secret echo", async () => {
  for (const [error, code, status] of [
    [new AppError("REFUSED", "Gemini từ chối.", 422), "REFUSED", 422],
    [{ status: 429, message: "Daily quota exceeded PRIVATE_KEY_MARKER" }, "QUOTA_EXCEEDED", 429],
    [{ name: "TimeoutError", message: "PRIVATE_KEY_MARKER" }, "TIMEOUT", 504],
  ] as const) {
    let calls = 0;
    const m = mocks();
    const r = await handleRegional(req(), env, { ...m.services, async connection() { calls++; throw error; } });
    assert.equal(r.status, status);
    const data = await r.json();
    assert.equal(data.error.code, code);
    assert.ok(!JSON.stringify(data).includes("PRIVATE_KEY_MARKER"));
    assert.equal(data.analysis, undefined);
    assert.equal(calls, 1);
  }
});

test("relay URL requires fixed HTTPS endpoint and complete secret; never silently falls back", () => {
  assert.equal(relayConfig({}), null);
  assert.deepEqual(relayConfig({ GEMINI_BACKEND_URL: relay.url, GEMINI_RELAY_TOKEN: token }), relay);
  for (const url of ["http://example.com/api/regional", "https://x:y@example.com/api/regional", "https://example.com/api/regional?x=1", "https://example.com/other"]) {
    assert.throws(() => relayConfig({ GEMINI_BACKEND_URL: url, GEMINI_RELAY_TOKEN: token }), isCode("BACKEND_NOT_CONFIGURED"));
  }
  assert.throws(() => relayConfig({ GEMINI_RELAY_TOKEN: token }), isCode("BACKEND_NOT_CONFIGURED"));
});

test("gateway relays raw bytes with service auth only, blocks redirects and validates results", async () => {
  let calls = 0;
  const bytes = new Uint8Array([1, 2, 3]);
  const transport: typeof fetch = async function (this: typeof globalThis, url, init) {
    calls++;
    assert.equal(String(url), `${relay.url}?action=analyze`);
    assert.equal(init?.redirect, "manual");
    assert.equal(typeof url, "string");
    assert.equal(this, globalThis);
    assert.equal(init?.method, "POST");
    assert.equal(init?.body, bytes);
    assert.ok(init?.signal);
    assert.deepEqual(init?.headers, { Authorization: `Bearer ${token}`, "Content-Type": "image/jpeg" });
    return Response.json({ analysis: demoResult.analysis, model: env.GEMINI_MODEL, source: "gemini" });
  };
  assert.equal((await regionalAnalyze(relay, bytes, transport)).model, env.GEMINI_MODEL);
  assert.equal(calls, 1);
  await assert.rejects(regionalAnalyze(relay, new Uint8Array(MAX_UPLOAD_BYTES + 1), transport), isCode("FILE_TOO_LARGE"));
  assert.equal(calls, 1);
});

test("gateway rejects demo source, malformed and inconsistent successful results", async () => {
  for (const data of [{ ...demoResult, model: env.GEMINI_MODEL }, { ok: true }, { ...demoResult, model: env.GEMINI_MODEL, source: "gemini", analysis: { ...demoResult.analysis, selectedOption: 3 } }]) {
    await assert.rejects(regionalAnalyze(relay, new Uint8Array(1), async () => Response.json(data)), isCode("BACKEND_INVALID_RESPONSE"));
  }
  const low = await regionalAnalyze(relay, new Uint8Array(1), async () => Response.json({ ...demoResult, model: env.GEMINI_MODEL, source: "gemini", analysis: { ...demoResult.analysis, confidence: "low" } }));
  assert.equal(low.analysis.suggestedAnswer, null);
});

test("gateway bounds backend response and never retries or echoes raw errors", async () => {
  const cases: [() => Response | never, string][] = [
    [() => Response.json({ error: { code: "REFUSED", message: "PRIVATE_KEY_MARKER" } }, { status: 422 }), "REFUSED"],
    [() => new Response("<html>PRIVATE_KEY_MARKER</html>", { status: 401 }), "BACKEND_INVALID_RESPONSE"],
    [() => new Response("PRIVATE_KEY_MARKER", { status: 502 }), "BACKEND_UNAVAILABLE"],
    [() => new Response("PRIVATE_KEY_MARKER", { status: 504 }), "TIMEOUT"],
    [() => Response.json({ error: { code: "SERVICE_UNAVAILABLE", message: "PRIVATE_KEY_MARKER", retryAfter: 30 } }, { status: 503 }), "SERVICE_UNAVAILABLE"],
    [() => new Response("{broken", { headers: { "Content-Type": "application/json" } }), "BACKEND_INVALID_RESPONSE"],
    [() => new Response(null, { status: 302, headers: { Location: "https://untrusted.example/" } }), "BACKEND_REDIRECT"],
    [() => new Response("x".repeat(256 * 1024 + 1), { headers: { "Content-Type": "application/json" } }), "BACKEND_INVALID_RESPONSE"],
    [() => { throw new TypeError("redirect PRIVATE_KEY_MARKER"); }, "BACKEND_UNAVAILABLE"],
    [() => { throw new DOMException("PRIVATE_KEY_MARKER", "TimeoutError"); }, "TIMEOUT"],
  ];
  for (const [respond, code] of cases) {
    let calls = 0;
    await assert.rejects(regionalConnection(relay, async () => { calls++; return respond(); }), (e: unknown) => isCode(code)(e) && !(e as Error).message.includes("PRIVATE_KEY_MARKER"));
    assert.equal(calls, 1);
  }
});

test("authenticated health and connection data cross the bridge", async () => {
  const m = mocks();
  const transport: typeof fetch = async (input, init) => handleRegional(new Request(String(input), init), env, m.services);
  assert.equal((await regionalHealth(relay, transport)).region, "iad1");
  assert.equal(await regionalConnection(relay, transport), env.GEMINI_MODEL);
  assert.deepEqual(m.calls, { limit: 1, analyze: 0, connection: 1 });
});

test("regional deployment blocks public UI, legacy APIs and subpaths", () => {
  const old = process.env.REGIONAL_ONLY;
  process.env.REGIONAL_ONLY = "true";
  try {
    for (const path of ["/", "/api/analyze", "/api/connection", "/api/status", "/api/regional/extra", "/_next/static/example.js"]) {
      assert.equal(proxy(new NextRequest(`https://example.com${path}`)).status, 404);
    }
    assert.equal(proxy(new NextRequest(relay.url)).headers.get("x-middleware-next"), "1");
  } finally { if (old === undefined) delete process.env.REGIONAL_ONLY; else process.env.REGIONAL_ONLY = old; }
});
