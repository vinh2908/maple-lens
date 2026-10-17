import type { Analysis } from "./contracts";

// Unicode Hangul syllable order; standard Korean 2-Set (두벌식) keys.
const INITIAL = ["r", "R", "s", "e", "E", "f", "a", "q", "Q", "t", "T", "d", "w", "W", "c", "z", "x", "v", "g"];
const VOWEL = ["k", "o", "i", "O", "j", "p", "u", "P", "h", "hk", "ho", "hl", "y", "n", "nj", "np", "nl", "b", "m", "ml", "l"];
const FINAL = ["", "r", "R", "rt", "s", "sw", "sg", "e", "f", "fr", "fa", "fq", "ft", "fx", "fv", "fg", "a", "q", "qt", "t", "T", "d", "w", "c", "z", "x", "v", "g"];

export type TypingGuide = { keys: string; syllables: { text: string; keys: string }[] };

/** No spelling corrections, transliteration, or dropping unreadable characters. */
export function koreanKeys(text: string): TypingGuide | null {
  const normalized = text.normalize("NFC");
  // Spaces are literal; line breaks could submit a game form, so reject them.
  // Standalone jamo / punctuation / OCR placeholders need manual verification.
  if (!/^[가-힣 ]+$/.test(normalized) || !/[가-힣]/.test(normalized)) return null;
  const syllables = Array.from(normalized, text => {
    if (text === " ") return { text, keys: " " };
    const offset = text.charCodeAt(0) - 0xac00;
    return { text, keys: INITIAL[Math.floor(offset / 588)] + VOWEL[Math.floor((offset % 588) / 28)] + FINAL[offset % 28] };
  });
  return { keys: syllables.map(s => s.keys).join(""), syllables };
}

export function typingGuideFor(analysis: Analysis): TypingGuide | null {
  if (analysis.challengeType !== "distorted_text" || analysis.needsClearerImage ||
    analysis.confidence === "low" || analysis.uncertainSegments.length ||
    !analysis.suggestedAnswer ||
    analysis.suggestedAnswer.normalize("NFC") !== analysis.recognizedText.normalize("NFC")) return null;
  return koreanKeys(analysis.recognizedText);
}
