import { httpsCallable } from "firebase/functions";
import { functions } from "../firebase";
import { reconcileAiAnalysisForDisplay } from "../utils/aiAnalysisReconcile";

export type AIStage = "hr" | "chair" | "dean" | "interviewer";

export interface AIAnalysisResult {
  /** Interviewer draft: null when the model returned no usable 0–100 score (honest gap, not fabricated). */
  score: number | null;
  strengths: string[];
  weaknesses: string[];
  recommendation: string;
  justification: string;
}

const callable = httpsCallable<
  { candidateId: string; stage: AIStage; force?: boolean },
  AIAnalysisResult
>(functions, "analyzeCandidate");

/** Bare Firebase/gRPC code words that must never be shown to the user. */
const CODE_WORDS = /^(internal|functions\/internal|unavailable|deadline[-_ ]exceeded|unknown|ok)$/i;

/**
 * Extracts a human-readable message from a Firebase Functions callable error.
 *
 * Firebase v9 surfaces HttpsError as:
 *   error.code    = "functions/internal"
 *   error.message = the message string you passed to HttpsError()
 *
 * In some SDK / emulator combinations the message is replaced with the
 * gRPC status word ("INTERNAL"). We check every field and fall back safely.
 */
export function extractFunctionError(err: unknown): string {
  const isUsable = (s: unknown): s is string =>
    typeof s === "string" && s.trim().length > 0 && !CODE_WORDS.test(s.trim());

  if (err && typeof err === "object") {
    const fe = err as Record<string, unknown>;

    // 1. .message — primary source
    if (isUsable(fe.message)) return (fe.message as string).trim();

    // 2. .details — secondary (HttpsError lets you pass extra data here)
    if (isUsable(fe.details)) return (fe.details as string).trim();

    // 3. .customData.message — some SDK versions nest the real message here
    if (fe.customData && typeof fe.customData === "object") {
      const cd = fe.customData as Record<string, unknown>;
      if (isUsable(cd.message)) return (cd.message as string).trim();
    }
  }

  // 4. Plain Error objects (non-Firebase)
  if (err instanceof Error && isUsable(err.message)) return err.message.trim();

  return "AI analysis failed. Please try again.";
}

export function extractCandidateSourcingError(err: unknown): string {
  if (err && typeof err === "object") {
    const fe = err as Record<string, unknown>;
    const code = typeof fe.code === "string" ? fe.code : "";
    const rawMsg =
      typeof fe.message === "string" ? fe.message.toLowerCase() : "";

    if (code === "functions/not-found" || code === "not-found") {
      return "Candidate sourcing function is not deployed. Deploy generateMatchingCandidates, then try again.";
    }

    if (
      code === "functions/deadline-exceeded" ||
      code === "deadline-exceeded" ||
      rawMsg.includes("deadline") ||
      rawMsg.includes("timeout")
    ) {
      return "Sourcing took too long or the browser cut off the request. Wait a moment and click Regenerate again.";
    }

    if (
      code === "functions/unavailable" ||
      code === "unavailable" ||
      rawMsg.includes("network") ||
      rawMsg.includes("failed to fetch") ||
      rawMsg.includes("connection") ||
      rawMsg.includes("load failed")
    ) {
      return "Network error talking to Cloud Functions (firewall/VPN/antivirus can cause this). Retry, try another network, or run the Firebase Functions emulator locally.";
    }

    if (code === "functions/cancelled" || code === "cancelled") {
      return "Request was cancelled. Try again.";
    }

    const message = extractFunctionError(err);
    if (message !== "AI analysis failed. Please try again.") return message;
  }

  if (err instanceof Error) {
    const m = err.message.toLowerCase();
    if (m.includes("failed to fetch") || m.includes("networkerror") || m.includes("connection reset")) {
      return "Network error reaching Cloud Functions. Retry or check firewall/VPN; sourcing can take several minutes.";
    }
  }

  return "Candidate sourcing failed. Deploy generateMatchingCandidates, set GEMINI_API_KEY on the function, and ensure your browser allows long requests (no 70s cutoff — app timeout is extended).";
}

export async function analyzeCandidateAI(
  candidateId: string,
  stage: AIStage,
  force = false
): Promise<AIAnalysisResult> {
  const result = await callable({ candidateId, stage, force });
  return reconcileAiAnalysisForDisplay(result.data, stage);
}

export interface GenerateCandidatesResult {
  created: number;
  skipped: number;
  message?: string;
  /** True when fewer than the per-run target were saved — HR can run again to add more. */
  suggestRegenerate?: boolean;
}

/** Must exceed Cloud Function timeoutSeconds (300) — Firebase SDK default is only 70s and aborts long sourcing runs. */
const GENERATE_MATCHING_TIMEOUT_MS = 330_000;

const generateCallable = httpsCallable<{ requisitionId: string }, GenerateCandidatesResult>(
  functions,
  "generateMatchingCandidates",
  { timeout: GENERATE_MATCHING_TIMEOUT_MS }
);

export async function generateMatchingCandidates(requisitionId: string): Promise<GenerateCandidatesResult> {
  const result = await generateCallable({ requisitionId });
  return result.data;
}
