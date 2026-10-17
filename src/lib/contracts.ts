import { z } from "zod";

// Below the Vercel Function 4.5 MB body limit, including multipart overhead.
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
export const MAX_SOURCE_BYTES = 15 * 1024 * 1024;
export const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp"];

export const analysisSchema = z.object({
  challengeType: z.enum(["distorted_text", "sentence_choice", "unknown"]),
  recognizedText: z.string().max(6000),
  suggestedAnswer: z.string().max(2000).nullable(),
  selectedOption: z.number().int().min(1).max(12).nullable(),
  options: z.array(z.object({
    index: z.number().int().min(1).max(12),
    text: z.string().max(1500),
    grammar: z.string().max(1500),
    meaning: z.string().max(1500),
    assessment: z.string().max(1000),
  })).max(12),
  explanation: z.string().min(1).max(4000),
  confidence: z.enum(["high", "medium", "low"]),
  uncertainSegments: z.array(z.object({
    text: z.string().max(1000),
    reason: z.string().max(1000),
    alternatives: z.array(z.string().max(300)).max(8),
  })).max(20),
  needsClearerImage: z.boolean(),
});

export type Analysis = z.infer<typeof analysisSchema>;
export type AnalysisResult = { analysis: Analysis; elapsedMs: number; model: string; source: "gemini" | "demo" };
export type ApiErrorBody = { error: { code: string; message: string; retryAfter?: number } };
export type ServerStatus = { configured: boolean; model: string; authenticated: boolean; authRequired: boolean; authUnavailable: boolean };

export function validateAnalysis(raw: unknown): Analysis {
  const result = analysisSchema.parse(raw);
  if (result.challengeType === "sentence_choice") {
    if (result.options.length < 2 || result.options.some((o, i) => o.index !== i + 1)) {
      throw new Error("INVALID_OPTIONS");
    }
    if (result.selectedOption !== null) {
      const option = result.options.find(o => o.index === result.selectedOption);
      if (!option || option.text !== result.suggestedAnswer) throw new Error("INVALID_SELECTION");
    } else if (result.suggestedAnswer !== null) throw new Error("INVALID_SELECTION");
  } else if (result.options.length || result.selectedOption !== null) {
    throw new Error("INVALID_OPTIONS");
  }
  if (result.needsClearerImage || result.confidence === "low" || result.challengeType === "unknown") {
    result.suggestedAnswer = null;
    result.selectedOption = null;
    result.needsClearerImage = true;
  }
  if (result.suggestedAnswer !== null && !result.suggestedAnswer.trim()) throw new Error("EMPTY_ANSWER");
  return result;
}
