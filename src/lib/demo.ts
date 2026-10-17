import type { AnalysisResult } from "./contracts";
export const demoResult: AnalysisResult = {
  source: "demo", elapsedMs: 0, model: "Dữ liệu minh họa, không gọi API",
  analysis: {
    challengeType: "distorted_text", recognizedText: "바누리모", suggestedAnswer: "바누리모", selectedOption: null,
    options: [], confidence: "medium", uncertainSegments: [], needsClearerImage: false,
    explanation: "Đây là kết quả viết sẵn cho ảnh minh họa tự tạo để bạn xem giao diện. Bốn ký tự được giữ nguyên thứ tự: 바 · 누 · 리 · 모, không sửa thành một từ có nghĩa. Kết quả này không đánh giá khả năng nhận diện của Gemini.",
  },
};
