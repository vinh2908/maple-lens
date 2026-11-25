import type { AnalysisResult } from "./contracts";
export const demoResult: AnalysisResult = {
  source: "demo", elapsedMs: 0, model: "Dữ liệu minh họa, không gọi API",
  analysis: {
    challengeType: "sentence_choice",
    recognizedText: "",
    suggestedAnswer: "저는 학교에 갑니다.",
    selectedOption: 2,
    options: [],
    confidence: "high",
    uncertainSegments: [],
    needsClearerImage: false,
    explanation: "",
  },
};
