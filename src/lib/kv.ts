// Server-only module: never import runtime helpers from a client component.
import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

export type UsageLogEntry = {
  ts: number;
  domain: string;
  ok: boolean;
  ms: number;
};

export type DomainAuthState = {
  pwHash: string | null;
  locked: boolean;
  preferredModel?: string | null;
};

export type DomainStats = {
  domain: string;
  todayCount: number;
  totalCount: number;
  locked: boolean;
  hasCustomPassword: boolean;
  preferredModel?: string | null;
  logs: UsageLogEntry[];
};

function kvEnv() {
  const url = (process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || "").trim().replace(/\/+$/, "");
  const token = (process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || "").trim();
  return url && token ? { url, token } : null;
}

export function kvConfigured() {
  return Boolean(kvEnv());
}

export function normalizeDomain(raw: string): string {
  return raw.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
}

export function getDomainsList(): string[] {
  const raw = process.env.DOMAINS || "";
  return raw
    .split(",")
    .map(s => s.trim().replace(/\/+$/, ""))
    .filter(Boolean);
}

export function getSiteDomain(req?: { headers: { get(name: string): string | null } }): string {
  if (process.env.SITE_DOMAIN?.trim()) return normalizeDomain(process.env.SITE_DOMAIN);
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim()) return normalizeDomain(process.env.VERCEL_PROJECT_PRODUCTION_URL);
  const host = req?.headers.get("x-forwarded-host") || req?.headers.get("host");
  if (host?.trim()) return normalizeDomain(host.split(",")[0]);
  if (process.env.VERCEL_URL?.trim()) return normalizeDomain(process.env.VERCEL_URL);
  return "localhost";
}

export function vnDateString(ts = Date.now()): string {
  return new Date(ts + 7 * 3600_000).toISOString().slice(0, 10);
}

async function kvPipeline(commands: (string | number)[][]): Promise<unknown[]> {
  const cfg = kvEnv();
  if (!cfg) throw new Error("KV_NOT_CONFIGURED");
  const res = await fetch(`${cfg.url}/pipeline`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(commands),
    cache: "no-store",
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`KV_HTTP_${res.status}`);
  const data = (await res.json()) as { result?: unknown; error?: string }[];
  return data.map(item => item.result ?? null);
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const derived = scryptSync(password, salt, 64).toString("hex");
  return `scrypt$${salt}$${derived}`;
}

export function verifyHash(password: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const [, salt, hex] = parts;
  if (!salt || !hex) return false;
  const expected = Buffer.from(hex, "hex");
  const actual = scryptSync(password, salt, expected.length);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function getFallbackPassword(): string {
  return process.env.ADMIN_PASSWORD || process.env.APP_PASSWORD || "";
}

export async function getDomainAuthState(domain: string): Promise<DomainAuthState> {
  if (!kvConfigured()) return { pwHash: null, locked: false, preferredModel: null };
  try {
    const [pwHash, locked, preferredRaw] = await kvPipeline([
      ["GET", `maple:v1:pw:${domain}`],
      ["GET", `maple:v1:locked:${domain}`],
      ["GET", `maple:v1:prefer-model:${domain}`],
    ]);
    const preferredModel = typeof preferredRaw === "string" && preferredRaw.trim() ? preferredRaw.trim() : null;
    return {
      pwHash: typeof pwHash === "string" && pwHash.startsWith("scrypt$") ? pwHash : null,
      locked: locked === "1" || locked === 1 || locked === true || locked === "true",
      preferredModel,
    };
  } catch {
    return { pwHash: null, locked: false, preferredModel: null };
  }
}

export function verifyPasswordAgainstState(candidate: string, state: DomainAuthState): boolean {
  if (!candidate) return false;
  if (state.pwHash) {
    return verifyHash(candidate, state.pwHash);
  }
  const envPass = getFallbackPassword();
  if (!envPass) return false;
  return safeEqual(candidate, envPass);
}

export function getAuthSigningSecret(state: DomainAuthState): string {
  const base = getFallbackPassword() || "maple-fallback-key";
  const version = state.pwHash || "env-default";
  return createHash("sha256").update(`${base}::${version}`).digest("hex");
}

export async function recordUsageLog(domain: string, entry: UsageLogEntry): Promise<void> {
  if (!kvConfigured()) return;
  try {
    const day = vnDateString(entry.ts);
    const logKey = `maple:v1:logs:${domain}`;
    const totalKey = `maple:v1:total:${domain}`;
    const dayKey = `maple:v1:day:${domain}:${day}`;
    await kvPipeline([
      ["LPUSH", logKey, JSON.stringify(entry)],
      ["LTRIM", logKey, 0, 99],
      ["INCR", totalKey],
      ["INCR", dayKey],
      ["EXPIRE", dayKey, 172_800],
    ]);
  } catch {
    // Requirement 6: skip logging errors without affecting the response
  }
}

export async function getDomainStats(domain: string): Promise<DomainStats> {
  const today = vnDateString();
  if (!kvConfigured()) {
    return { domain, todayCount: 0, totalCount: 0, locked: false, hasCustomPassword: false, logs: [] };
  }
  const [rawLogs, totalRaw, dayRaw, lockedRaw, pwRaw, preferredRaw] = await kvPipeline([
    ["LRANGE", `maple:v1:logs:${domain}`, 0, 99],
    ["GET", `maple:v1:total:${domain}`],
    ["GET", `maple:v1:day:${domain}:${today}`],
    ["GET", `maple:v1:locked:${domain}`],
    ["GET", `maple:v1:pw:${domain}`],
    ["GET", `maple:v1:prefer-model:${domain}`],
  ]);

  const logs: UsageLogEntry[] = Array.isArray(rawLogs)
    ? rawLogs
        .map(item => {
          try {
            const parsed = typeof item === "string" ? JSON.parse(item) : item;
            if (parsed && typeof parsed.ts === "number" && typeof parsed.ms === "number") {
              return {
                ts: parsed.ts,
                domain: String(parsed.domain || domain),
                ok: Boolean(parsed.ok),
                ms: parsed.ms,
              };
            }
            return null;
          } catch {
            return null;
          }
        })
        .filter((x): x is UsageLogEntry => x !== null)
    : [];

  const totalCount = Math.max(Number(totalRaw) || 0, logs.length);
  const todayFromLogs = logs.filter(l => vnDateString(l.ts) === today).length;
  const todayCount = Math.max(Number(dayRaw) || 0, todayFromLogs);

  return {
    domain,
    todayCount,
    totalCount,
    locked: lockedRaw === "1" || lockedRaw === 1 || lockedRaw === true || lockedRaw === "true",
    hasCustomPassword: typeof pwRaw === "string" && pwRaw.startsWith("scrypt$"),
    preferredModel: typeof preferredRaw === "string" && preferredRaw.trim() ? preferredRaw.trim() : null,
    logs,
  };
}

export async function setPreferredModelOverride(domain: string, model: string, ttlSeconds = 300): Promise<void> {
  if (!kvConfigured()) return;
  try {
    await kvPipeline([["SET", `maple:v1:prefer-model:${domain}`, model, "EX", ttlSeconds]]);
  } catch {
    // Non-fatal: never block user flows on KV cooldown writes
  }
}

export async function setDomainPassword(domain: string, newPassword: string): Promise<void> {
  const hash = hashPassword(newPassword);
  await kvPipeline([["SET", `maple:v1:pw:${domain}`, hash]]);
}

export async function setDomainLockedState(domain: string, locked: boolean): Promise<void> {
  await kvPipeline([["SET", `maple:v1:locked:${domain}`, locked ? "1" : "0"]]);
}
