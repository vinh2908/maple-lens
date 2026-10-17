import { test } from "node:test";
import assert from "node:assert/strict";
import { validateAnalysis, type Analysis } from "../src/lib/contracts";
import { providerError, providerDiagnostic } from "../src/lib/api-errors";
import { consumeLimit } from "../src/lib/rate-limit";
import { demoResult } from "../src/lib/demo";
import { validateConnectionResponse } from "../src/lib/gemini-core";
import type { GenerateContentResponse } from "@google/genai";

test("preserves literal Korean character order, including meaningless strings", () => {
  const a = validateAnalysis({ ...demoResult.analysis, recognizedText: "바누리모", suggestedAnswer: "바누리모" });
  assert.equal(a.suggestedAnswer, "바누리모");
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
});
test("unknown challenge cannot produce an answer", () => {
  assert.equal(validateAnalysis({ ...demoResult.analysis, challengeType: "unknown" }).suggestedAnswer, null);
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
