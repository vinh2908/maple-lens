import assert from "node:assert/strict";
import test from "node:test";
import { koreanKeys, typingGuideFor } from "../src/lib/korean-keyboard";
import { demoResult } from "../src/lib/demo";

test("2-Set preserves syllable order and literal spaces", () => {
  assert.equal(koreanKeys("바누리모")?.keys, "qksnflah");
  assert.deepEqual(koreanKeys("한 글")?.syllables, [{ text: "한", keys: "gks" }, { text: " ", keys: " " }, { text: "글", keys: "rmf" }]);
  assert.equal(koreanKeys("안녕하세요")?.keys, "dkssudgktpdy");
  assert.equal(koreanKeys("  가  나 ")?.keys, "  rk  sk ");
  assert.equal(koreanKeys("한글".normalize("NFD"))?.keys, "gksrmf");
});
test("compound vowels, final clusters and shifted keys", () => {
  assert.equal(koreanKeys("까 따 빠 싸 짜 얘 예")?.keys, "Rk Ek Qk Tk Wk dO dP");
  assert.equal(koreanKeys("과 괘 괴 궈 궤 귀 긔")?.keys, "rhk rho rhl rnj rnp rnl rml");
  assert.equal(koreanKeys("갃 갅 갆 갉 갊 갋 갌 갍 갎 갏 값 갔 갂")?.keys, "rkrt rksw rksg rkfr rkfa rkfq rkft rkfx rkfv rkfg rkqt rkT rkR");
  assert.equal(koreanKeys("힣")?.keys, "glg");
});
test("unreadable and unsupported characters never become partial answers", () => {
  for (const text of ["", " ", "가?나", "가[?]나", "가/나", "가\n나", "가\t나", "ㄱㅏ", "가abc", "가�", "가1", "가🙂"]) assert.equal(koreanKeys(text), null, text);
});
test("guide requires an unambiguous matching text-entry answer", () => {
  const base = demoResult.analysis;
  assert.equal(typingGuideFor(base)?.keys, "qksnflah");
  for (const change of [
    { challengeType: "sentence_choice" as const }, { challengeType: "unknown" as const },
    { confidence: "low" as const }, { needsClearerImage: true }, { suggestedAnswer: null },
    { suggestedAnswer: "바누리무" },
    { uncertainSegments: [{ text: "바", reason: "Mờ", alternatives: ["파"] }] },
  ]) assert.equal(typingGuideFor({ ...base, ...change }), null);
});
