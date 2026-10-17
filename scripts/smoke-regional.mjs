import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { setTimeout } from "node:timers/promises";
import { readdir, readFile } from "node:fs/promises";

// Exercises the actual production Next server with no provider credentials.
// The random token is in the child environment, never argv or printed output.
const token = randomBytes(32).toString("base64url");
const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", "3141"], {
  env: { ...process.env, REGIONAL_ONLY: "true", GEMINI_RELAY_TOKEN: token, GEMINI_API_KEY: "", GEMINI_MODEL: "gemini-3.1-flash-lite", VERCEL_REGION: "iad1" },
  stdio: "ignore",
});
const base = "http://127.0.0.1:3141";
try {
  let ready = false;
  for (let attempt = 0; attempt < 40; attempt++) {
    try { await fetch(base); ready = true; break; } catch { await setTimeout(250); }
  }
  assert.ok(ready, "Production server did not start");
  for (const path of ["/", "/api/status", "/api/analyze", "/api/connection", "/api/session", "/api/regional/extra"]) {
    assert.equal((await fetch(`${base}${path}`, { redirect: "manual" })).status, 404, path);
  }
  assert.equal((await fetch(`${base}/api/regional`)).status, 401);
  const headers = { Authorization: `Bearer ${token}` };
  const health = await fetch(`${base}/api/regional`, { headers });
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { configured: false, model: "gemini-3.1-flash-lite", region: "iad1" });
  const missing = await fetch(`${base}/api/regional?action=connection`, { method: "POST", headers });
  assert.equal(missing.status, 503);
  assert.equal((await missing.json()).error.code, "MISSING_KEY");
  let files = 0;
  async function scan(dir) {
    for (const item of await readdir(dir, { withFileTypes: true })) {
      const path = `${dir}/${item.name}`;
      if (item.isDirectory()) await scan(path);
      else {
        const text = await readFile(path, "utf8");
        assert.ok(!text.includes(token), "Runtime relay secret present in browser build");
        assert.ok(!text.includes("GEMINI_API_KEY") && !text.includes("GEMINI_RELAY_TOKEN"), "Server configuration imported into browser build");
        files++;
      }
    }
  }
  await scan(".next/static");
  console.log(`Production regional smoke passed: auth, route isolation, health, missing key; ${files} browser artifacts contain no server credential references. No Gemini requests made.`);
} finally { child.kill("SIGTERM"); }
