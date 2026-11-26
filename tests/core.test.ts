import { test } from "node:test";
import assert from "node:assert/strict";
import { validateAnalysis, type Analysis } from "../src/lib/contracts";
import { providerError, providerDiagnostic, AppError } from "../src/lib/api-errors";
import { consumeLimit } from "../src/lib/rate-limit";
import { demoResult } from "../src/lib/demo";
import { validateConnectionResponse, shouldFallback503, FALLBACK_MODEL, runHedgedWithFallback } from "../src/lib/gemini-core";
import { assertValidImageHeader } from "../src/lib/image-header";
import {
  getAuthSigningSecret,
  hashPassword,
  verifyHash,
  verifyPasswordAgainstState,
} from "../src/lib/kv";
import type { GenerateContentResponse } from "@google/genai";

test("validates pure TS magic-bytes headers for JPEG, PNG, WebP and rejects mismatches", () => {
  const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00]);
  const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
  const webp = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50]);

  assert.doesNotThrow(() => assertValidImageHeader(jpeg, "image/jpeg"));
  assert.doesNotThrow(() => assertValidImageHeader(png, "image/png"));
  assert.doesNotThrow(() => assertValidImageHeader(webp, "image/webp"));

  assert.throws(() => assertValidImageHeader(png, "image/jpeg"), (e: unknown) => e instanceof AppError && e.code === "INVALID_IMAGE" && e.status === 415);
  assert.throws(() => assertValidImageHeader(jpeg, "image/png"), (e: unknown) => e instanceof AppError && e.code === "INVALID_IMAGE" && e.status === 415);
  assert.throws(() => assertValidImageHeader(Buffer.from("not an image"), "image/webp"), (e: unknown) => e instanceof AppError && e.code === "INVALID_IMAGE" && e.status === 415);
  assert.throws(() => assertValidImageHeader(Uint8Array.from([0xff, 0xd8]), "image/jpeg"), (e: unknown) => e instanceof AppError && e.code === "INVALID_IMAGE" && e.status === 415);
});

test("password hashing and signing secret invalidates old tokens on password change", () => {
  process.env.ADMIN_PASSWORD = "initial-admin-password";
  const initialState = { pwHash: null, locked: false };
  assert.equal(verifyPasswordAgainstState("initial-admin-password", initialState), true);
  assert.equal(verifyPasswordAgainstState("wrong", initialState), false);

  const nextHash = hashPassword("new-domain-password");
  assert.equal(verifyHash("new-domain-password", nextHash), true);
  assert.equal(verifyHash("initial-admin-password", nextHash), false);

  const updatedState = { pwHash: nextHash, locked: false };
  assert.equal(verifyPasswordAgainstState("new-domain-password", updatedState), true);
  assert.equal(verifyPasswordAgainstState("initial-admin-password", updatedState), false);
  assert.notEqual(getAuthSigningSecret(initialState), getAuthSigningSecret(updatedState));
});

test("accepts ultra-compact sentence_choice payload without recognizedText or options", () => {
  const a = validateAnalysis({
    challengeType: "sentence_choice",
    selectedOption: 2,
    suggestedAnswer: "저는 학교에 갑니다.",
    confidence: "high",
    needsClearerImage: false,
  });
  assert.equal(a.selectedOption, 2);
  assert.equal(a.suggestedAnswer, "저는 학교에 갑니다.");
  assert.equal(a.recognizedText, "");
  assert.deepEqual(a.options, []);

  const rowOnly = validateAnalysis({
    challengeType: "sentence_choice",
    selectedOption: 3,
    confidence: "high",
    needsClearerImage: false,
  });
  assert.equal(rowOnly.selectedOption, 3);
  assert.equal(rowOnly.suggestedAnswer, null);
  assert.equal(rowOnly.needsClearerImage, false);
});

test("unclear image removes suggestions instead of guessing", () => {
  const a = validateAnalysis({ ...demoResult.analysis, needsClearerImage: true, confidence: "low" });
  assert.equal(a.suggestedAnswer, null);
  assert.equal(a.selectedOption, null);
  assert.equal(a.needsClearerImage, true);
});

const choice: Analysis = {
  ...demoResult.analysis, challengeType: "sentence_choice", recognizedText: "1. 저는 학교에 갑니다.\n2. 저는 학교를 갑니다.",
  suggestedAnswer: "저는 학교에 갑니다.", selectedOption: 1,
  options: [
    { index: 1, text: "저는 학교에 갑니다.", grammar: "에 đánh dấu đích đến.", meaning: "Tôi đi đến trường.", assessment: "Phù hợp." },
    { index: 2, text: "저는 학교를 갑니다.", grammar: "를 chỉ tân ngữ; cách dùng phụ thuộc ngữ cảnh.", meaning: "Tôi đi trường.", assessment: "Cần xét yêu cầu của câu hỏi." },
  ],
};
test("sentence choices remain numbered from top to bottom", () => {
  assert.equal(validateAnalysis(choice).selectedOption, 1);
  assert.throws(() => validateAnalysis({ ...choice, options: [...choice.options].reverse() }));
});
test("rejects mismatched answer / option and malformed output", () => {
  assert.throws(() => validateAnalysis({ ...choice, suggestedAnswer: "a fabricated answer" }));
  assert.throws(() => validateAnalysis({ ...choice, selectedOption: 3 }));
  assert.throws(() => validateAnalysis({ answer: "guess" }));
  assert.throws(() => validateAnalysis({ ...choice, suggestedAnswer: "", selectedOption: null }));
  assert.throws(() => validateAnalysis({ ...demoResult.analysis, challengeType: "distorted_text" }));
});
test("unknown challenge cannot produce an answer", () => {
  assert.equal(validateAnalysis({ ...demoResult.analysis, challengeType: "unknown", selectedOption: null, options: [] }).suggestedAnswer, null);
});
test("maps provider errors to specific safe messages without leaking key", () => {
  const cases: [unknown, string][] = [
    [{ status: 400, message: "API key not valid: PRIVATE_KEY_MARKER" }, "INVALID_KEY"],
    [{ status: 403 }, "KEY_PERMISSION"],
    [{ status: 400, message: "API key expired. PRIVATE_KEY_MARKER" }, "KEY_EXPIRED"],
    [{ status: 403, message: "Your API key was reported as leaked PRIVATE_KEY_MARKER" }, "KEY_REVOKED"],
    [{ status: 400, message: "User location is not supported for the API use." }, "REGION_UNSUPPORTED"],
    [{ status: 400, message: "Unrecognized provider detail PRIVATE_KEY_MARKER" }, "PROVIDER_REQUEST"],
    [{ status: 429, message: "Rate limit exceeded per minute" }, "RATE_LIMIT"],
    [{ status: 429, message: "Daily quota exceeded" }, "QUOTA_EXCEEDED"],
    [{ status: 404 }, "MODEL_UNAVAILABLE"],
    [{ status: 503, message: "UNAVAILABLE PRIVATE_KEY_MARKER" }, "SERVICE_UNAVAILABLE"],
    [{ name: "TimeoutError" }, "TIMEOUT"],
    [{ status: 500, message: "PRIVATE_KEY_MARKER" }, "PROVIDER_ERROR"],
  ];
  for (const [error, expected] of cases) {
    const e = providerError(error); assert.equal(e.code, expected); assert.ok(!e.message.includes("PRIVATE_KEY_MARKER"));
  }
});
test("rate limit rejects overflow and resets only after its window", () => {
  consumeLimit("test-window", 2, 60_000, 1000); consumeLimit("test-window", 2, 60_000, 1001);
  assert.throws(() => consumeLimit("test-window", 2, 60_000, 2000), /giới hạn/);
  assert.doesNotThrow(() => consumeLimit("test-window", 2, 60_000, 61_000));
});
test("provider diagnostics contain only bounded codes, never raw credentials or messages", () => {
  const diagnostic = providerDiagnostic({ status: 503, name: "ApiError", message: "UNAVAILABLE PRIVATE_KEY_MARKER", cause: { code: "PRIVATE_KEY_MARKER" } });
  assert.equal(diagnostic.status, 503);
  assert.equal(diagnostic.reason, "service_unavailable");
  assert.equal(diagnostic.networkCode, null);
  assert.ok(!JSON.stringify(diagnostic).includes("PRIVATE_KEY_MARKER"));
  const network = providerDiagnostic({ name: "TypeError", message: "fetch failed", cause: { code: "ECONNRESET" } });
  assert.equal(network.networkCode, "ECONNRESET");
});
test("503 fallback triggers only for SERVICE_UNAVAILABLE on non-fallback model", () => {
  assert.equal(shouldFallback503({ status: 503, message: "UNAVAILABLE" }, "gemini-3.5-flash-lite"), true);
  assert.equal(shouldFallback503({ status: 503, message: "UNAVAILABLE" }, FALLBACK_MODEL), false);
  assert.equal(shouldFallback503({ status: 429, message: "Rate limit" }, "gemini-3.5-flash-lite"), false);
  assert.equal(shouldFallback503({ status: 401, message: "API key not valid" }, "gemini-3.5-flash-lite"), false);
  assert.equal(shouldFallback503({ name: "TimeoutError" }, "gemini-3.5-flash-lite"), false);
});

test("hedged race uses only primary when fast, hedges on delay, rescues 503 early, and enforces hard cap", async () => {
  // 0. 0ms hedge launches both primary and fallback immediately and takes the faster one
  const launchedZero: string[] = [];
  const zeroRes = await runHedgedWithFallback({
    primaryModel: "gemini-3.5-flash-lite",
    fallbackModel: FALLBACK_MODEL,
    hedgeDelayMs: 0,
    hardCapMs: 500,
    runAttempt: (model, signal) => new Promise((resolve, reject) => {
      launchedZero.push(model);
      signal.addEventListener("abort", () => reject(Object.assign(new Error("Aborted"), { name: "AbortError" })), { once: true });
      setTimeout(() => resolve("win-" + model), model === FALLBACK_MODEL ? 10 : 120);
    }),
  });
  assert.equal(launchedZero.length, 2);
  assert.equal(zeroRes.model, FALLBACK_MODEL);
  assert.equal(zeroRes.value, `win-${FALLBACK_MODEL}`);

  // 1. Fast primary (< hedgeDelayMs) -> fallback never called
  const seenFast: string[] = [];
  const fastRes = await runHedgedWithFallback({
    primaryModel: "gemini-3.5-flash-lite",
    fallbackModel: FALLBACK_MODEL,
    hedgeDelayMs: 60,
    hardCapMs: 400,
    runAttempt: async model => {
      seenFast.push(model);
      return "ok-" + model;
    },
  });
  assert.equal(fastRes.model, "gemini-3.5-flash-lite");
  assert.equal(fastRes.primaryFailed, false);
  assert.deepEqual(seenFast, ["gemini-3.5-flash-lite"]);

  // 2. Slow primary (> hedgeDelayMs) -> fallback starts, wins, and aborts primary
  let primaryAborted = false;
  const hedgedRes = await runHedgedWithFallback({
    primaryModel: "gemini-3.5-flash-lite",
    fallbackModel: FALLBACK_MODEL,
    hedgeDelayMs: 25,
    hardCapMs: 500,
    runAttempt: (model, signal) => new Promise((resolve, reject) => {
      if (model === "gemini-3.5-flash-lite") {
        signal.addEventListener("abort", () => { primaryAborted = true; reject(Object.assign(new Error("Aborted"), { name: "AbortError" })); }, { once: true });
        setTimeout(() => resolve("late"), 300);
      } else {
        setTimeout(() => resolve("fast-fallback"), 10);
      }
    }),
  });
  assert.equal(hedgedRes.model, FALLBACK_MODEL);
  assert.equal(hedgedRes.value, "fast-fallback");
  assert.equal(primaryAborted, true);

  // 3. Primary fails with 503 before hedgeDelayMs -> fallback starts immediately without waiting
  const t0 = Date.now();
  const rescuedRes = await runHedgedWithFallback({
    primaryModel: "gemini-3.5-flash-lite",
    fallbackModel: FALLBACK_MODEL,
    hedgeDelayMs: 500,
    hardCapMs: 800,
    runAttempt: async model => {
      if (model === "gemini-3.5-flash-lite") throw { status: 503, message: "UNAVAILABLE" };
      return "rescued";
    },
  });
  assert.equal(rescuedRes.model, FALLBACK_MODEL);
  assert.equal(rescuedRes.primaryFailed, true);
  assert.ok(Date.now() - t0 < 200);

  // 4. Non-retryable 401 -> fails immediately without calling fallback
  const seenAuth: string[] = [];
  await assert.rejects(
    () => runHedgedWithFallback({
      primaryModel: "gemini-3.5-flash-lite",
      fallbackModel: FALLBACK_MODEL,
      hedgeDelayMs: 100,
      hardCapMs: 400,
      runAttempt: async model => {
        seenAuth.push(model);
        throw { status: 401, message: "API key not valid" };
      },
    }),
    (e: unknown) => e instanceof AppError && e.code === "INVALID_KEY"
  );
  assert.deepEqual(seenAuth, ["gemini-3.5-flash-lite"]);

  // 5. Hard cap aborts hung attempts cleanly with TIMEOUT
  await assert.rejects(
    () => runHedgedWithFallback({
      primaryModel: "gemini-3.5-flash-lite",
      fallbackModel: FALLBACK_MODEL,
      hedgeDelayMs: 20,
      hardCapMs: 80,
      runAttempt: (_model, signal) => new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(Object.assign(new Error("Aborted"), { name: "AbortError" })), { once: true });
      }),
    }),
    (e: unknown) => e instanceof AppError && e.code === "TIMEOUT" && e.status === 504
  );
});

test("connection checks accept completed text without requiring exact OK, but reject refusals/empty/truncated replies", () => {
  for (const text of ["OK", "OK.", "Kết nối hoạt động."]) {
    assert.doesNotThrow(() => validateConnectionResponse({ text, candidates: [{ finishReason: "STOP" }] } as GenerateContentResponse));
  }
  for (const response of [
    { text: "" },
    { text: "OK", promptFeedback: { blockReason: "SAFETY" } },
    { text: "OK", candidates: [{ finishReason: "MAX_TOKENS" }] },
    { text: "OK", candidates: [{ finishReason: "SAFETY" }] },
  ]) assert.throws(() => validateConnectionResponse(response as GenerateContentResponse));
});
