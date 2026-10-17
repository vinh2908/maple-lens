import "server-only";
import { getGeminiConfig } from "./server";
import { analyzeWithGemini, testWithGemini } from "./gemini-core";
export { ANALYSIS_INSTRUCTIONS } from "./gemini-core";
export async function analyzeImage(bytes: Buffer, mimeType: string) {
  return analyzeWithGemini(getGeminiConfig(), bytes.toString("base64"), mimeType);
}
export async function testConnection() { return testWithGemini(getGeminiConfig()); }
