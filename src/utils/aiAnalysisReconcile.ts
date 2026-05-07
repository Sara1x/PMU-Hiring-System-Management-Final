import type { AIAnalysisResult } from "../services/aiService";

/**
 * Callable already reconciles score/recommendation server-side; this is a
 * safety net for older cached payloads or future client-only data paths.
 */
export function reconcileAiAnalysisForDisplay(
  data: AIAnalysisResult,
  _stage: "hr" | "chair" | "dean" | "interviewer"
): AIAnalysisResult {
  if (data.score === null || data.score === undefined) {
    return { ...data, score: null };
  }
  if (typeof data.score === "number" && Number.isFinite(data.score)) {
    return { ...data, score: Math.max(0, Math.min(100, data.score)) };
  }
  return { ...data, score: null };
}
