import * as admin from "firebase-admin";
import * as crypto from "crypto";
import * as nodemailer from "nodemailer";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { GoogleGenerativeAI } from "@google/generative-ai";

admin.initializeApp();
const db = admin.firestore();

const GEMINI_API_KEY = defineSecret("GEMINI_API_KEY");
const SMTP_USER      = defineSecret("SMTP_USER");   // Gmail address used to send OTPs
const SMTP_PASS      = defineSecret("SMTP_PASS");   // Gmail App Password

/** Unpinned IDs like gemini-1.5-flash often 404; keep fallbacks per Firebase AI docs. */
function geminiModelCandidates(): string[] {
  const env = process.env.GEMINI_MODEL?.trim();
  const defaults = [
    "gemini-2.0-flash",
    "gemini-flash-latest",
    "gemini-2.5-flash",
    "gemini-1.5-flash-002",
  ];
  const list = env ? [env, ...defaults] : defaults;
  return [...new Set(list)];
}

function isGeminiModel404(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /\b404\b/.test(msg) && /not\s+found|NOT_FOUND/i.test(msg);
}

/** Try stable v1 then v1beta and multiple model IDs until generateContent succeeds. */
async function geminiGenerateText(
  genAI: GoogleGenerativeAI,
  prompt: string,
  generationConfig: { temperature: number; maxOutputTokens: number; responseMimeType?: string }
): Promise<string> {
  let lastErr: unknown;
  const models = geminiModelCandidates();
  for (const modelId of models) {
    for (const apiVersion of ["v1", "v1beta"] as const) {
      try {
        const cfg = { ...generationConfig };
        if (apiVersion === "v1" && cfg.responseMimeType) delete cfg.responseMimeType;

        const model = genAI.getGenerativeModel(
          { model: modelId, generationConfig: cfg },
          { apiVersion }
        );
        const result = await model.generateContent(prompt);
        console.log(`[AI] Gemini OK model=${modelId} api=${apiVersion}`);
        return result.response.text();
      } catch (e) {
        lastErr = e;
        if (isGeminiModel404(e)) {
          console.warn(`[AI] Gemini 404 model=${modelId} api=${apiVersion}, trying next…`);
          continue;
        }
        throw e;
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

// ── Types ─────────────────────────────────────────────────────────────────────

type Stage = "hr" | "chair" | "dean" | "interviewer";

interface AIResult {
  score: number | null;
  strengths: string[];
  weaknesses: string[];
  recommendation: string;
  justification: string;
}

interface CallInput {
  candidateId: string;
  stage: Stage;
  force?: boolean;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

// Prepended to every prompt so Gemini returns clean, parseable JSON.
const STRICT_JSON_RULE = `Return ONLY valid JSON.
No markdown.
No backticks.
No explanations.
All strings must be properly closed and escaped.`;

// Safe JSON parser: extracts the substring between the first "{" and the
// last "}", parses it, and returns null on any failure (logging the raw
// response so we can diagnose later). The caller decides what to do when
// null is returned (typically: fall back to a non-zero score from
// evaluation averages instead of crashing the UI).
function safeParseJSON(text: string): unknown | null {
  const stripFences = (s: string) =>
    s.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();

  const tryParse = (raw: string): unknown => JSON.parse(raw);

  let cleaned = stripFences(text);
  try {
    return tryParse(cleaned);
  } catch {
    /* fall through */
  }

  try {
    const start = cleaned.indexOf("{");
    const end   = cleaned.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) throw new Error("No JSON object");
    return tryParse(cleaned.substring(start, end + 1));
  } catch (err) {
    console.error("[AI PARSE ERROR]", err);
    console.error("[RAW RESPONSE]", text);
    return null;
  }
}


function clipPromptField(v: unknown, maxLen: number): string {
  const s = String(v ?? "").replace(/\s+/g, " ").trim();
  if (s.length <= maxLen) return s;
  return `${s.slice(0, maxLen)}…`;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/** Gemini sometimes omits `score` or uses alternate keys — avoid defaulting to 0 blindly. */
function extractScoreFlexible(obj: Record<string, unknown>): number | null {
  const keys = ["score", "matchScore", "match_score", "overallScore", "overall_fit", "fitScore", "fit"];
  for (const k of keys) {
    const v = obj[k];
    if (v === undefined || v === null || v === "") continue;
    const n = typeof v === "string" ? Number(String(v).trim()) : Number(v);
    if (!Number.isFinite(n)) continue;
    return clamp(n, 0, 100);
  }
  return null;
}

function validateResult(raw: unknown, stage: Stage): AIResult {
  // Degrade gracefully — never throw, always return something sensible
  const obj: Record<string, unknown> =
    typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};

  const parsedScore = extractScoreFlexible(obj);
  const fallbackNum = Number(obj.score ?? obj.matchScore ?? 0);
  const fallbackScore = Number.isFinite(fallbackNum) ? clamp(fallbackNum, 0, 100) : 0;

  const strengths = Array.isArray(obj.strengths) ? obj.strengths.map(String)
    : [];
  const weaknesses = Array.isArray(obj.weaknesses) ? obj.weaknesses.map(String)
    : Array.isArray(obj.risks) ? (obj.risks as unknown[]).map(String)
    : [];

  const recommendation = String(obj.recommendation ?? "").trim() || "Review Required";
  const justification  = String(obj.justification  ?? "").trim()
    || "AI analysis could not provide a complete explanation. Please review manually.";

  const score =
    stage === "interviewer"
      ? parsedScore
      : parsedScore !== null
        ? parsedScore
        : fallbackScore;

  return reconcileAIResult({ score, strengths, weaknesses, recommendation, justification }, stage);
}

// Keep match score (0–100) and categorical recommendation aligned so the UI
// never shows contradictory labels (e.g. "Poor Match" with "Recommend").
// We do not invent scores from recommendation text (that would be misleading).

const INTERVIEWER_RANK_LABEL: Record<number, string> = {
  4: "Highly Recommend",
  3: "Recommend",
  2: "Neutral",
  1: "Do Not Recommend",
};

function normalizeInterviewerRecRank(raw: string): number | null {
  const s = raw.trim().toLowerCase().replace(/\s+/g, " ");
  if (s === "highly recommend") return 4;
  if (s === "recommend") return 3;
  if (s === "neutral") return 2;
  if (s === "do not recommend") return 1;
  return null;
}

function interviewerRecBounds(score: number): { min: number; max: number } {
  if (score >= 75) return { min: 3, max: 4 };
  if (score >= 55) return { min: 2, max: 3 };
  if (score >= 40) return { min: 2, max: 2 };
  return { min: 1, max: 1 };
}

function reconcileInterviewerRecommendation(score: number, recommendation: string): string {
  let rank = normalizeInterviewerRecRank(recommendation);
  const { min, max } = interviewerRecBounds(score);
  if (rank === null) {
    rank = min;
  } else {
    rank = clamp(rank, min, max);
  }
  return INTERVIEWER_RANK_LABEL[rank];
}

function reconcileHRRecommendation(score: number, recommendation: string): string {
  const t = recommendation.trim();
  if (t !== "Shortlist" && t !== "Reject") {
    return score >= 50 ? "Shortlist" : "Reject";
  }
  if (t === "Shortlist" && score < 40) return "Reject";
  return t;
}

const CHAIR_RANK_LABEL: Record<number, string> = {
  3: "Recommended",
  2: "Needs Discussion",
  1: "Not Recommended",
};

function normalizeChairRecRank(raw: string): number | null {
  const s = raw.trim().toLowerCase();
  if (s === "recommended") return 3;
  if (s === "needs discussion") return 2;
  if (s === "not recommended") return 1;
  return null;
}

function chairRecBounds(score: number): { min: number; max: number } {
  if (score >= 72) return { min: 2, max: 3 };
  if (score >= 48) return { min: 1, max: 3 };
  return { min: 1, max: 2 };
}

function reconcileChairRecommendation(score: number, recommendation: string): string {
  let rank = normalizeChairRecRank(recommendation);
  const { min, max } = chairRecBounds(score);
  if (rank === null) {
    rank = min;
  } else {
    rank = clamp(rank, min, max);
  }
  return CHAIR_RANK_LABEL[rank];
}

function reconcileDeanRecommendation(score: number, recommendation: string): string {
  const s = recommendation.trim().toLowerCase();
  let rec =
    s === "hire"
      ? "Hire"
      : s === "do not hire"
        ? "Do Not Hire"
        : score >= 55
          ? "Hire"
          : "Do Not Hire";
  if (rec === "Hire" && score < 42) rec = "Do Not Hire";
  if (rec === "Do Not Hire" && score >= 72) rec = "Hire";
  return rec;
}

function reconcileAIResult(result: AIResult, stage: Stage): AIResult {
  if (stage === "interviewer") {
    const raw = result.score;
    if (raw === null || raw === undefined || !Number.isFinite(raw)) {
      return {
        ...result,
        score: null,
        recommendation: "Review Required",
      };
    }
    const score = clamp(raw, 0, 100);
    const recommendation = reconcileInterviewerRecommendation(score, result.recommendation);
    return { ...result, score, recommendation };
  }

  const score = clamp(
    result.score === null || result.score === undefined || !Number.isFinite(result.score)
      ? 0
      : result.score,
    0,
    100,
  );
  let recommendation = result.recommendation;

  if (stage === "hr") {
    recommendation = reconcileHRRecommendation(score, recommendation);
  } else if (stage === "chair") {
    recommendation = reconcileChairRecommendation(score, recommendation);
  } else if (stage === "dean") {
    recommendation = reconcileDeanRecommendation(score, recommendation);
  }

  return { ...result, score, recommendation };
}

function cachedDocToAIResult(d: FirebaseFirestore.DocumentData): AIResult {
  let score: number | null = null;
  if (d.score !== undefined && d.score !== null && String(d.score).trim() !== "") {
    const n = Number(d.score);
    if (Number.isFinite(n)) score = clamp(n, 0, 100);
  }

  return {
    score,
    strengths: Array.isArray(d.strengths) ? d.strengths.map(String) : [],
    weaknesses: Array.isArray(d.weaknesses) ? d.weaknesses.map(String) : [],
    recommendation: String(d.recommendation ?? "").trim() || "Review Required",
    justification:
      String(d.justification ?? "").trim() ||
      "AI analysis could not provide a complete explanation. Please review manually.",
  };
}

// Average of (per-evaluator average rating). Returns null when no usable
// numeric ratings exist. Ratings are stored on a 4-point scale to match the
// UI ("AVERAGE SCORE x.x/4").
function computeAverageScore(
  evaluations: FirebaseFirestore.QueryDocumentSnapshot[] | undefined
): number | null {
  if (!evaluations || evaluations.length === 0) return null;
  const perEvalAverages: number[] = [];
  for (const e of evaluations) {
    const d = e.data();
    const ratings = Object.values((d.ratings as Record<string, number>) ?? {})
      .map((v) => Number(v))
      .filter((v) => Number.isFinite(v));
    if (ratings.length > 0) {
      perEvalAverages.push(ratings.reduce((a, b) => a + b, 0) / ratings.length);
    }
  }
  if (perEvalAverages.length === 0) return null;
  return perEvalAverages.reduce((a, b) => a + b, 0) / perEvalAverages.length;
}

// Safe JSON fallback so the function never returns a 500. When interview
// evaluations are available, the score is derived from the average rating
// (averageScore / 4 * 100) instead of defaulting to 0 — this prevents the UI
// from showing "Poor Match 0/100" for a candidate who actually interviewed
// well but whose AI response failed to parse.
function fallbackResult(
  reason: string,
  evaluations?: FirebaseFirestore.QueryDocumentSnapshot[]
): AIResult {
  const avg = computeAverageScore(evaluations);

  if (avg !== null) {
    const score = clamp(Math.round((avg / 4) * 100), 0, 100);
    return {
      score,
      strengths: [],
      weaknesses: [],
      recommendation: "Review Required",
      justification:
        `AI analysis unavailable (${reason}). ` +
        `Score derived from interview average ${avg.toFixed(1)}/4. ` +
        `Please review this candidate manually.`,
    };
  }

  return {
    score: 0,
    strengths: [],
    weaknesses: [],
    recommendation: "Review Required",
    justification: `AI analysis unavailable (${reason}). Please review this candidate manually.`,
  };
}

// ── Prompt builders ───────────────────────────────────────────────────────────

function buildPromptHR(
  candidate: FirebaseFirestore.DocumentData,
  requisition: FirebaseFirestore.DocumentData
): string {
  const positionTitle = requisition.positionTitle ?? requisition.title ?? requisition.position ?? "N/A";
  return `You are an expert academic recruitment AI for a university.

Evaluate this candidate for shortlisting based ONLY on their CV profile.

## JOB REQUIREMENTS
- Position Title: ${positionTitle}
- Department: ${requisition.department ?? "N/A"}
- Specialization: ${requisition.specialization ?? requisition.department ?? "N/A"}
${requisition.jobDescription || requisition.description ? `- Description: ${requisition.jobDescription ?? requisition.description}` : ""}

## CANDIDATE PROFILE
- Name: ${candidate.full_name ?? "N/A"}
- Education: ${candidate.degree ?? "N/A"}
- Experience: ${candidate.years_experience ?? 0} years
- Current Title: ${candidate.current_title ?? "N/A"}
- Applied Position: ${candidate.position_applied ?? "N/A"}
- Skills: ${candidate.skills ?? "N/A"}
- Certifications: ${candidate.certifications ?? "None listed"}
- Publications: ${candidate.publications_count ?? 0} peer-reviewed publications
- Summary: ${candidate.summary ?? "N/A"}

## INSTRUCTIONS
Return ONLY a valid JSON object — no markdown, no explanation, no code fences.
Score 0-100 for role fit (must agree with recommendation: Shortlist only if profile reasonably fits the role; Reject when clearly unsuitable).
Recommendation must be exactly "Shortlist" or "Reject".
Justification: 1-2 sentences, evidence-based.

{"score":number,"strengths":[string],"weaknesses":[string],"recommendation":"Shortlist","justification":"string"}`;
}

function buildPromptInterviewer(
  candidate: FirebaseFirestore.DocumentData,
  requisition: FirebaseFirestore.DocumentData
): string {
  const job = [
    clipPromptField(requisition.positionTitle ?? requisition.title ?? requisition.position, 200),
    clipPromptField(requisition.department, 120),
    requisition.description ? clipPromptField(requisition.description, 600) : "",
  ].filter(Boolean).join(" | ");

  const dean = candidate.deanNote ? clipPromptField(candidate.deanNote, 400) : "";

  return `Help a faculty interviewer draft evaluation notes from application materials (not the live interview yet).

JOB: ${job || "N/A"}
CANDIDATE: ${clipPromptField(candidate.full_name, 120)} | Edu: ${clipPromptField(candidate.degree, 120)} | Exp: ${candidate.years_experience ?? 0}y | Applied: ${clipPromptField(candidate.position_applied, 160)} | Skills: ${clipPromptField(candidate.skills, 300)} | Pubs: ${candidate.publications_count ?? 0} | Summary: ${clipPromptField(candidate.summary, 700)}${dean ? ` | Dean note: ${dean}` : ""}

Align strengths/weaknesses with: Teaching, Research, Communication, Domain expertise, Collaboration.

Rules for internal consistency (mandatory):
- Never claim a strength that your weaknesses deny (e.g. do not praise a "strong publication record" if you also cite zero or missing publications — say evidence is absent from the CV instead).
- Strengths must be factual claims you still endorse after listing weaknesses.
- justification must agree with score and recommendation (no glowing hire language if score is below 55).

Include a numeric JSON field "score" (0–100) whenever you can justify it from the materials. If a fair number is not possible, omit "score" entirely (do not use 0 as a silent placeholder). Do not contradict yourself: if score is low, recommendation and prose must reflect real concerns.

recommendation must be exactly one of: Highly Recommend, Recommend, Neutral, Do Not Recommend — and MUST stay consistent with score:
  score 75–100 → Highly Recommend or Recommend only
  score 55–74 → Recommend or Neutral only
  score 40–54 → Neutral only
  score 0–39 → Do Not Recommend only

strengths: 3-5 short strings. weaknesses: 2-4 short strings. justification: 2-4 professional sentences for Additional Comments.

Return a single JSON object only (the response schema enforces the shape).`;
}

function buildPromptChair(
  candidate: FirebaseFirestore.DocumentData,
  requisition: FirebaseFirestore.DocumentData,
  evaluations: FirebaseFirestore.QueryDocumentSnapshot[]
): string {
  const positionTitle = requisition.positionTitle ?? requisition.title ?? requisition.position ?? "N/A";
  const evalLines = evaluations.map((e, i) => {
    const d       = e.data();
    const ratings = Object.values((d.ratings as Record<string, number>) ?? {});
    const avg     = ratings.length
      ? (ratings.reduce((a, b) => a + b, 0) / ratings.length).toFixed(1)
      : "N/A";
    return `  Evaluator ${i + 1}: Recommendation=${d.recommendation ?? "N/A"}, Score=${avg}/5, Comments="${d.comments ?? "none"}".`;
  }).join("\n");

  return `You are an expert academic recruitment AI for a university.

Evaluate this candidate after their interview process.

## JOB REQUIREMENTS
- Position Title: ${positionTitle}
- Department: ${requisition.department ?? "N/A"}
- Specialization: ${requisition.specialization ?? requisition.department ?? "N/A"}

## CANDIDATE PROFILE
- Name: ${candidate.full_name ?? "N/A"}
- Education: ${candidate.degree ?? "N/A"}
- Experience: ${candidate.years_experience ?? 0} years
- Applied Position: ${candidate.position_applied ?? "N/A"}
- Skills: ${candidate.skills ?? "N/A"}
- Publications: ${candidate.publications_count ?? 0}

## INTERVIEW EVALUATIONS (${evaluations.length})
${evalLines || "  No evaluations submitted yet."}

## INSTRUCTIONS
Return ONLY a valid JSON object — no markdown, no code fences.
score is 0-100 reflecting overall evidence from evaluations — keep recommendation consistent with score (Recommended only when reasonably positive overall; Not Recommended when concerns dominate; Needs Discussion when mixed).
Recommendation must be exactly one of: "Recommended", "Needs Discussion", "Not Recommended".
Justification: 1-2 sentences, evidence-based.

{"score":number,"strengths":[string],"weaknesses":[string],"recommendation":"Recommended","justification":"string"}`;
}

function buildPromptDean(
  candidate: FirebaseFirestore.DocumentData,
  requisition: FirebaseFirestore.DocumentData,
  evaluations: FirebaseFirestore.QueryDocumentSnapshot[],
  committee: FirebaseFirestore.DocumentData | null
): string {
  const positionTitle = requisition.positionTitle ?? requisition.title ?? requisition.position ?? "N/A";
  const evalLines = evaluations.map((e, i) => {
    const d       = e.data();
    const ratings = Object.values((d.ratings as Record<string, number>) ?? {});
    const avg     = ratings.length
      ? (ratings.reduce((a, b) => a + b, 0) / ratings.length).toFixed(1)
      : "N/A";
    return `  Evaluator ${i + 1}: Recommendation=${d.recommendation ?? "N/A"}, Score=${avg}/5.`;
  }).join("\n");

  return `You are an expert academic recruitment AI supporting a Dean's final hiring decision.

## JOB REQUIREMENTS
- Position Title: ${positionTitle}
- Department: ${requisition.department ?? "N/A"}
- Specialization: ${requisition.specialization ?? requisition.department ?? "N/A"}
- Open Positions: ${requisition.numberOfPositions ?? 1}

## CANDIDATE PROFILE
- Name: ${candidate.full_name ?? "N/A"}
- Education: ${candidate.degree ?? "N/A"}
- Experience: ${candidate.years_experience ?? 0} years
- Applied Position: ${candidate.position_applied ?? "N/A"}
- Skills: ${candidate.skills ?? "N/A"}
- Publications: ${candidate.publications_count ?? 0}

## INTERVIEW EVALUATIONS (${evaluations.length})
${evalLines || "  No evaluations."}

## CHAIR RECOMMENDATION
- Decision: ${committee?.chairRecommendation ?? "N/A"}
- Comments: ${committee?.chairComments ?? "None."}

## INSTRUCTIONS
Return ONLY a valid JSON object — no markdown, no code fences.
score is 0-100 reflecting evidence — keep recommendation consistent with score (Hire when reasonably favorable overall; Do Not Hire when substantial reservations dominate).
Recommendation must be exactly one of: "Hire", "Do Not Hire".
Justification: 1-2 sentences maximum.

{"score":number,"strengths":[string],"weaknesses":[string],"recommendation":"Hire","justification":"string"}`;
}

// ── Cloud Function ─────────────────────────────────────────────────────────────

export const analyzeCandidate = onCall<CallInput>(
  {
    region: "us-central1",
    timeoutSeconds: 60,
    memory: "256MiB",
    secrets: [GEMINI_API_KEY],
    invoker: "public", // allow unauthenticated Cloud Run invocations
    cors: true,        // emit Access-Control-Allow-Origin for browser preflight
  },
  async (request) => {
    const { candidateId, stage, force = false } = request.data;
    console.log(`[AI] start — candidateId=${candidateId} stage=${stage} force=${force}`);

    // ── Input validation (outside try so they surface as typed errors) ─────
    if (!candidateId || typeof candidateId !== "string") {
      throw new HttpsError("invalid-argument", "candidateId is required and must be a string.");
    }
    if (!["hr", "chair", "dean", "interviewer"].includes(stage)) {
      throw new HttpsError(
        "invalid-argument",
        `stage must be hr, chair, dean, or interviewer. Got: "${stage}"`
      );
    }

    const cacheId = `${candidateId}_${stage}`;

    // Declared outside the try so the outer catch can still pass them to
    // fallbackResult() for a smarter-than-zero score.
    let evaluations: FirebaseFirestore.QueryDocumentSnapshot[] = [];
    let committee: FirebaseFirestore.DocumentData | null = null;

    // ── Everything else in one safe block ─────────────────────────────────
    try {

      // Cache
      if (!force) {
        const cached = await db.collection("candidateAIAnalysis").doc(cacheId).get().catch(() => null);
        if (cached?.exists) {
          console.log(`[AI] cache hit: ${cacheId}`);
          return reconcileAIResult(cachedDocToAIResult(cached.data()!), stage);
        }
      }

      // API key (inside try so any secret-access error is caught and reported)
      const apiKey = GEMINI_API_KEY.value();
      if (!apiKey) {
        console.error("[AI] GEMINI_API_KEY secret is empty");
        return fallbackResult("API key not configured");
      }
      console.log("[AI] API key present ✓");

      // Fetch candidate
      const candSnap = await db.collection("candidates").doc(candidateId).get();
      if (!candSnap.exists) {
        throw new HttpsError("not-found", `Candidate "${candidateId}" not found.`);
      }
      const candidate = candSnap.data()!;
      console.log(`[AI] candidate: ${candidate.full_name ?? "unknown"}`);

      // Fetch requisition (best-effort)
      const reqId = (candidate.requisitionId as string | undefined) ?? "";
      let requisition: FirebaseFirestore.DocumentData = {};
      if (reqId) {
        const reqSnap = await db.collection("requisitions").doc(reqId).get();
        if (reqSnap.exists) requisition = reqSnap.data()!;
        console.log(`[AI] requisition: ${reqId}`);
      }

      // Fetch evaluations + committee for chair/dean stages
      if (stage === "chair" || stage === "dean") {
        const evalSnap = await db.collection("evaluations")
          .where("candidateId", "==", candidateId)
          .get();
        evaluations = evalSnap.docs;
        console.log(`[AI] evaluations: ${evaluations.length}`);

        if (stage === "dean" && reqId) {
          const commSnap = await db.collection("committees")
            .where("requisitionId", "==", reqId)
            .where("sentToDean", "==", true)
            .limit(1)
            .get();
          if (!commSnap.empty) {
            committee = commSnap.docs[0].data();
            console.log(`[AI] committee: ${commSnap.docs[0].id}`);
          }
        }
      }

      // Build prompt — prefix with strict-JSON rule to minimise truncated
      // or unescaped strings in Gemini's reply.
      let prompt: string;
      if (stage === "hr")             prompt = buildPromptHR(candidate, requisition);
      else if (stage === "interviewer") prompt = buildPromptInterviewer(candidate, requisition);
      else if (stage === "chair")     prompt = buildPromptChair(candidate, requisition, evaluations);
      else                            prompt = buildPromptDean(candidate, requisition, evaluations, committee);
      prompt = STRICT_JSON_RULE + "\n\n" + prompt;

      const genAI = new GoogleGenerativeAI(apiKey);
      const generationConfig =
        stage === "interviewer"
          ? { temperature: 0.15, maxOutputTokens: 2048 }
          : { temperature: 0.2,  maxOutputTokens: 1024 };

      let rawText: string;
      try {
        rawText = await geminiGenerateText(genAI, prompt, generationConfig);
      } catch (geminiErr) {
        const geminiMsg = geminiErr instanceof Error ? geminiErr.message : String(geminiErr);
        console.error("[AI] Gemini API error:", geminiMsg, geminiErr);
        return fallbackResult(`Gemini API error: ${geminiMsg}`, evaluations);
      }

      console.log(`[AI] raw response (first 400): ${rawText.slice(0, 400)}`);

      // Safe parse — returns null on any failure (does NOT throw, does NOT
      // crash). When null we fall back to an evaluation-derived score so
      // the AI Insight card still renders something useful.
      const parsed = safeParseJSON(rawText);
      if (parsed === null) {
        return fallbackResult("AI response could not be parsed", evaluations);
      }
      const aiResult: AIResult = validateResult(parsed, stage);

      console.log(`[AI] result: score=${aiResult.score} rec="${aiResult.recommendation}"`);

      // Persist (non-fatal)
      try {
        await db.collection("candidateAIAnalysis").doc(cacheId).set({
          ...aiResult,
          candidateId,
          stage,
          generatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        console.log(`[AI] saved: candidateAIAnalysis/${cacheId}`);
      } catch (saveErr) {
        // Non-fatal: return result even if save fails
        console.warn("[analyzeCandidate] failed to persist result:", saveErr);
      }

      return aiResult;

    } catch (err) {
      // Re-throw legitimate client-facing errors as-is (invalid-argument,
      // not-found, etc. — these are NOT 500s).
      if (err instanceof HttpsError) throw err;

      // Anything else: log and return a safe JSON fallback so the client
      // never sees a 500 / unhandled crash. Pass evaluations so the score
      // isn't a misleading 0/100 when interview data exists.
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[analyzeCandidate] unexpected error:", msg, err);
      return fallbackResult(msg, evaluations);
    }
  }
);

// ── Generate candidate profiles (Gemini only) ─────────────────────────────────

function normalizeEmailGen(v: unknown): string {
  return String(v ?? "")
    .trim()
    .toLowerCase();
}

function normalizeNameGen(v: unknown): string {
  return String(v ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

/** Only requisitions in Screening may receive HR Gemini-generated applicants (matches HR UI). */

interface GeneratedProfile {
  full_name?: string;
  email?: string;
  degree?: string;
  years_experience?: number;
  skills?: string;
  summary?: string;
  publications?: string;
  position?: string;
  sourceUrl?: string;
  cvUrl?: string;
  matchScore?: number;
}


function hasPublicEmail(v: unknown): boolean {
  const s = normalizeEmailGen(v);
  return s.includes("@") && s !== "not available";
}




const TARGET_SOURCED_CANDIDATES = 10;
const MAX_SOURCING_GEMINI_ATTEMPTS = 6;

function buildSourcingPrompt(params: {
  title: string;
  department: string;
  jobDescription: string;
  requiredQualifications: string;
  keyResponsibilities: string;
  needed: number;
  excludeNames: string[];
  excludeSourceUrls: string[];
}): string {
  const cap = Math.max(params.needed, 10);
  const excludeBlock = params.excludeNames.length
    ? `\n\nDO NOT reuse any of these names (already in the system): ${params.excludeNames.slice(0, 60).join("; ")}`
    : "";

  return `${STRICT_JSON_RULE}

You are an academic HR assistant generating realistic candidate profiles for a university hiring system demonstration.

Generate ${cap} diverse, realistic synthetic academic candidate profiles suitable for the position below.
These profiles are for a demo/thesis hiring system and will be used by HR to practice screening, shortlisting, and interview workflows.

GENERATION RULES:
- Create realistic, diverse profiles (varied names, backgrounds, universities, experience levels).
- Each candidate must be plausibly qualified for the role—mix strong, moderate, and borderline profiles.
- Use realistic Middle Eastern, Western, and Asian academic names (the university is in Saudi Arabia).
- email: use realistic academic-style emails (e.g., firstname.lastname@university.edu).
- degree: PhD, Master's, or Bachelor's as appropriate. PhD preferred for professor/lecturer roles.
- years_experience: 1–20 years, varied across profiles.
- skills: comma-separated list of 4–8 relevant technical and academic skills.
- publications: short summary like "12 peer-reviewed papers in AI/ML venues (NeurIPS, ICML)".
- summary: 2–3 sentence academic profile summary highlighting fit for the role.
- current_title: their current job title (e.g., "Assistant Professor at King Abdulaziz University").
- university: their current or most recent university/institution.
- matchScore: 0–100 honest fit score; strong matches 75–92, moderate 55–74, weak 35–54.
- Make exactly ${cap} candidates, all different people.${excludeBlock}

## REQUISITION
- Position: ${params.title}
- Department: ${params.department}
${params.jobDescription ? `- Description: ${params.jobDescription}` : ""}
${params.requiredQualifications ? `- Required qualifications: ${params.requiredQualifications}` : ""}

Return ONLY JSON matching the schema with key "candidates" (array of ${cap} objects).`;
}

export const generateMatchingCandidates = onCall<{ requisitionId: string }>(
  {
    region: "us-central1",
    timeoutSeconds: 120,
    memory: "512MiB",
    secrets: [GEMINI_API_KEY],
    invoker: "public",
    cors: true,
  },
  async (request) => {
    try {
    const requisitionId = request.data?.requisitionId;
    if (!requisitionId || typeof requisitionId !== "string") {
      throw new HttpsError("invalid-argument", "requisitionId is required.");
    }

    const reqSnap = await db.collection("requisitions").doc(requisitionId).get();
    if (!reqSnap.exists) {
      throw new HttpsError("not-found", `Requisition "${requisitionId}" not found.`);
    }
    const reqData = reqSnap.data()!;
    // Note: status check removed — allow any status so HR can generate candidates freely

    const apiKey = GEMINI_API_KEY.value();
    if (!apiKey) {
      throw new HttpsError("failed-precondition", "GEMINI_API_KEY is not configured.");
    }

    const title =
      String(reqData.positionTitle ?? reqData.title ?? reqData.position ?? "Faculty position");
    const department = String(reqData.department ?? "");
    const jobDescription = String(reqData.jobDescription ?? reqData.description ?? "");
    const requiredQualifications = String(reqData.requiredQualifications ?? "");
    const keyResponsibilities = String(reqData.keyResponsibilities ?? "");

    const [terminalSnap, onReqSnap] = await Promise.all([
      db.collection("candidates").where("status", "in", ["Rejected", "Not Hired"]).get(),
      db.collection("candidates").where("requisitionId", "==", requisitionId).get(),
    ]);

    const blockedEmails = new Set<string>();
    const blockedNames = new Set<string>();
    terminalSnap.forEach((doc) => {
      const d = doc.data();
      const em = normalizeEmailGen(d.email);
      const nm = normalizeNameGen(d.full_name ?? d.name);
      if (hasPublicEmail(em)) blockedEmails.add(em);
      if (nm.length >= 2) blockedNames.add(nm);
    });

    const reqEmails = new Set<string>();
    const reqNames = new Set<string>();
    const blockedSourceUrls = new Set<string>();
    const reqSourceUrls = new Set<string>();
    onReqSnap.forEach((doc) => {
      const d = doc.data();
      const em = normalizeEmailGen(d.email);
      const nm = normalizeNameGen(d.full_name ?? d.name);
      const src = String(d.sourceUrl ?? "").trim().toLowerCase();
      if (hasPublicEmail(em)) reqEmails.add(em);
      if (nm.length >= 2) reqNames.add(nm);
      if (src) reqSourceUrls.add(src);
    });
    terminalSnap.forEach((doc) => {
      const src = String(doc.data().sourceUrl ?? "").trim().toLowerCase();
      if (src) blockedSourceUrls.add(src);
    });

    const genAI = new GoogleGenerativeAI(apiKey);
    const sourcingGenerationConfig = {
      temperature:      0.4,
      maxOutputTokens:  8192,
      responseMimeType: "application/json" as const,
    };

    let batch = db.batch();
    let ops = 0;
    let created = 0;
    let skipped = 0;

    const tryCommit = async () => {
      if (ops === 0) return;
      await batch.commit();
      batch = db.batch();
      ops = 0;
    };

    const enqueueSet = async (data: Record<string, unknown>) => {
      const ref = db.collection("candidates").doc();
      batch.set(ref, data);
      ops++;
      created++;
      if (ops >= 450) await tryCommit();
    };

    let attempts = 0;
    let noProgressStreak = 0;

    while (created < TARGET_SOURCED_CANDIDATES && attempts < MAX_SOURCING_GEMINI_ATTEMPTS) {
      attempts++;
      const needed = TARGET_SOURCED_CANDIDATES - created;
      const excludeNames = [...reqNames].slice(0, 80);
      const excludeSourceUrls = [...reqSourceUrls].slice(0, 40);

      const prompt = buildSourcingPrompt({
        title,
        department,
        jobDescription,
        requiredQualifications,
        keyResponsibilities,
        needed,
        excludeNames,
        excludeSourceUrls,
      });

      let rawText: string;
      try {
        rawText = await geminiGenerateText(genAI, prompt, sourcingGenerationConfig);
      } catch (geminiErr) {
        const geminiMsg = geminiErr instanceof Error ? geminiErr.message : String(geminiErr);
        console.error("[generateMatchingCandidates] Gemini error:", geminiMsg);
        throw new HttpsError("internal", `Gemini failed: ${geminiMsg}`);
      }

      const parsed = safeParseJSON(rawText);
      const root =
        typeof parsed === "object" && parsed !== null
          ? (parsed as Record<string, unknown>)
          : null;
      const list = root && Array.isArray(root.candidates)
        ? (root.candidates as GeneratedProfile[])
        : [];

      const beforeRound = created;

      for (const p of list) {
        if (created >= TARGET_SOURCED_CANDIDATES) break;

        const raw = p as Record<string, unknown>;
        const fullName    = String(raw.full_name    ?? raw.name          ?? "").trim();
        // Accept position from either field Gemini may populate
        const positionStr = String(raw.position     ?? raw.current_title ?? raw.positionTitle ?? "").trim() || title;
        const emailRaw    = String(raw.email        ?? "").trim();
        const em = normalizeEmailGen(emailRaw);
        const nm = normalizeNameGen(fullName);

        // Require at least a name
        if (!fullName) {
          skipped++;
          continue;
        }

        // Dedup by normalized name only when it produces a meaningful key
        if (nm.length >= 2 && reqNames.has(nm)) {
          skipped++;
          continue;
        }
        if (nm.length >= 2) reqNames.add(nm);
        if (hasPublicEmail(em)) reqEmails.add(em);

        const education    = String(raw.degree       ?? raw.education       ?? "").trim();
        const years        = clamp(Math.round(Number(raw.years_experience ?? raw.experience ?? 0)), 0, 45);
        const skillsStr    = String(raw.skills       ?? "").trim();
        const summaryStr   = String(raw.summary      ?? raw.bio            ?? "").trim();
        const pubText      = String(raw.publications ?? raw.research       ?? "").trim();
        const score        = clamp(Math.round(Number(raw.matchScore        ?? raw.match_score ?? 0)), 0, 100);
        const currentTitle = String(raw.current_title ?? raw.currentTitle  ?? "").trim();
        const university   = String(raw.university    ?? raw.institution    ?? "").trim();

        await enqueueSet({
          full_name:           fullName,
          name:                fullName,
          email:               emailRaw,
          degree:              education,
          education,
          years_experience:    years,
          position_applied:    positionStr,
          current_title:       currentTitle,
          university,
          skills:              skillsStr,
          summary:             summaryStr,
          publications:        pubText,
          matchScore:          score,
          sourceType:          "ai_generated",
          linksVerified:       false,

          requisitionId:       requisitionId,
          positionTitle:       title,
          requisitionTitle:    title,
          department:          department,

          status:              "Pending",
          source:              "gemini",
          createdAt:           admin.firestore.FieldValue.serverTimestamp(),
        });
      }

      await tryCommit();

      if (created === beforeRound) noProgressStreak++;
      else noProgressStreak = 0;

      if (noProgressStreak >= 2) {
        console.warn("[generateMatchingCandidates] stopping after repeated rounds with no new saves");
        break;
      }
    }

    await tryCommit();

    const target = TARGET_SOURCED_CANDIDATES;

    if (created === 0) {
      return {
        created: 0,
        skipped,
        suggestRegenerate: true,
        message:
          `No new candidates were saved (${skipped} skipped as duplicates or invalid links after ${attempts} attempts). ` +
          `Use Regenerate to try again—repeat until you have enough real profiles.`,
      };
    }

    const hitTarget = created >= target;
    const message = hitTarget
      ? `Added ${created} real, source-backed candidate${created === 1 ? "" : "s"} for this run (target ${target}).`
      : `Added ${created} real candidate${created === 1 ? "" : "s"} this run (goal up to ${target} per click). ` +
        `You now have more profiles—click Regenerate if you want additional batches until you are satisfied (aim for at least 5–10 strong matches).`;

    return {
      created,
      skipped,
      suggestRegenerate: !hitTarget,
      message,
    };
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[generateMatchingCandidates] unexpected:", msg, err);
      throw new HttpsError(
        "internal",
        `Candidate sourcing crashed: ${msg}. Check logs and GEMINI_API_KEY.`
      );
    }
  }
);

// ── OTP ────────────────────────────────────────────────────────────────────────

const OTP_COLLECTION = "otpVerifications";
/** Must match frontend countdown semantics (shown as MM:SS and in email copy). */
const OTP_TTL_SECONDS = 180;

const KNOWN_OTP_LOGIN_EMAILS = new Set(
  [
    "201902002@pmu.edu.sa",
    "saralsh257@gmail.com",
    "sara25mi@hotmail.com",
    "sarah257mi@icloud.com",
  ].map((e) => e.toLowerCase())
);

/** Only these Firebase Auth identities may receive OTPs. */
function normalizeOtpEmail(email: string): string | null {
  const n = email.trim().toLowerCase();
  return KNOWN_OTP_LOGIN_EMAILS.has(n) ? n : null;
}

/** Millis from Firestore `createdAt`; 0 when missing/unresolved — safe for OTP docs after write. */
function docCreatedMillis(d: FirebaseFirestore.DocumentData): number {
  const c = d.createdAt;
  if (c instanceof admin.firestore.Timestamp) return c.toMillis();
  return 0;
}

export const sendVerificationOTP = onCall<{ email: string; role: string }>(
  {
    region: "us-central1",
    timeoutSeconds: 90,
    memory: "256MiB",
    secrets: [SMTP_USER, SMTP_PASS],
    invoker: "public",
    cors: true,
  },
  async (request) => {
    try {
      const { email, role } = request.data ?? {};
      if (!email || typeof email !== "string") {
        throw new HttpsError("invalid-argument", "email is required.");
      }

      const recipient = normalizeOtpEmail(email);
      if (!recipient) {
        throw new HttpsError("invalid-argument", "This email is not authorized for OTP login.");
      }

      const code = crypto.randomInt(100000, 999999).toString();

      const prevSnap = await db.collection(OTP_COLLECTION)
        .where("email", "==", recipient)
        .get();
      let invalidations = 0;
      const invBatch = db.batch();
      for (const d of prevSnap.docs) {
        if (d.data().used !== true) {
          invBatch.update(d.ref, { used: true });
          invalidations++;
        }
      }
      if (invalidations > 0) await invBatch.commit();

      const user = SMTP_USER.value();
      const pass = SMTP_PASS.value();
      if (!user || !pass) {
        console.error("[OTP] SMTP credentials not configured");
        throw new HttpsError("failed-precondition", "Email service not configured. Set SMTP_USER and SMTP_PASS secrets.");
      }

      const transporter = nodemailer.createTransport({
        service: "gmail",
        auth: { user, pass },
      });

      await transporter.sendMail({
        from: `"PMU Hiring System" <${user}>`,
        to: recipient,
        subject: "Your PMU Login Verification Code",
        html: `
          <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:32px;">
            <h2 style="color:#002147;margin-bottom:8px;">PMU Academic Hiring System</h2>
            <p style="color:#374151;margin-bottom:24px;">Your one-time verification code is:</p>
            <div style="background:#f3f4f6;border-radius:8px;padding:24px;text-align:center;">
              <span style="font-size:40px;font-weight:700;letter-spacing:8px;color:#002147;">${code}</span>
            </div>
            <p style="color:#6b7280;font-size:14px;margin-top:16px;">
              The code is valid for <strong>${OTP_TTL_SECONDS / 60} minutes</strong> after you request it.
              Do not share it with anyone.
            </p>
          </div>
        `,
      });

      const expiresAtMs = Date.now() + OTP_TTL_SECONDS * 1000;

      await db.collection(OTP_COLLECTION).add({
        email: recipient,
        code,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        expiresAt: admin.firestore.Timestamp.fromMillis(expiresAtMs),
        used: false,
        attempts: 0,
        role: role ?? "",
      });

      console.log(`[OTP] sent to ${recipient} role=${role}`);
      return { success: true, expiresAt: expiresAtMs };
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[sendVerificationOTP]", msg);
      throw new HttpsError("internal", `Failed to send OTP: ${msg}`);
    }
  }
);

export const verifyOTP = onCall<{ email: string; code: string }>(
  {
    region: "us-central1",
    timeoutSeconds: 15,
    memory: "256MiB",
    invoker: "public",
    cors: true,
  },
  async (request) => {
    try {
      const { email, code } = request.data ?? {};
      if (!code || typeof code !== "string" || code.length !== 6) {
        throw new HttpsError("invalid-argument", "A 6-digit code is required.");
      }
      const recipient =
        typeof email === "string" ? normalizeOtpEmail(email) : null;
      if (!recipient) {
        throw new HttpsError("invalid-argument", "email must match your login account.");
      }

      const snap = await db.collection(OTP_COLLECTION)
        .where("email", "==", recipient)
        .get();

      const unused = snap.docs.filter((doc) => doc.data().used !== true);
      if (unused.length === 0) {
        return { valid: false, reason: "expired" };
      }
      unused.sort((a, b) => docCreatedMillis(b.data()) - docCreatedMillis(a.data()));

      const docRef = unused[0].ref;
      const data = unused[0].data();

      const now = admin.firestore.Timestamp.now();
      const expiresAt = data.expiresAt as admin.firestore.Timestamp;

      if (now.toMillis() > expiresAt.toMillis()) {
        await docRef.update({ used: true });
        return { valid: false, reason: "expired" };
      }

      if (data.code !== code) {
        const attempts = (data.attempts ?? 0) + 1;
        await docRef.update({ attempts });
        return { valid: false, reason: "invalid" };
      }

      await docRef.update({ used: true, verifiedAt: now });
      return { valid: true };
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[verifyOTP]", msg);
      throw new HttpsError("internal", `OTP verification failed: ${msg}`);
    }
  }
);
