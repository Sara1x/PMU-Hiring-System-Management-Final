import { useState } from "react";
import {
  analyzeCandidateAI,
  extractFunctionError,
  type AIStage,
  type AIAnalysisResult,
} from "../services/aiService";

// ── Style maps ─────────────────────────────────────────────────────────────────

const REC_BADGE: Record<string, { bg: string; color: string; border: string }> = {
  Shortlist:         { bg: "#f0fdf4", color: "#15803d", border: "#86efac" },
  Reject:            { bg: "#fef2f2", color: "#dc2626", border: "#fca5a5" },
  Recommended:       { bg: "#f0fdf4", color: "#15803d", border: "#86efac" },
  "Needs Discussion":{ bg: "#fefce8", color: "#92400e", border: "#fde68a"},
  "Not Recommended": { bg: "#fef2f2", color: "#dc2626", border: "#fca5a5" },
  Hire:              { bg: "#f0fdf4", color: "#15803d", border: "#86efac" },
  "Do Not Hire":     { bg: "#fef2f2", color: "#dc2626", border: "#fca5a5" },
  "Highly Recommend": { bg: "#dcfce7", color: "#15803d", border: "#86efac" },
  Recommend:         { bg: "#dbeafe", color: "#1d4ed8", border: "#93c5fd" },
  Neutral:           { bg: "#fefce8", color: "#92400e", border: "#fde68a" },
  "Do Not Recommend":{ bg: "#fef2f2", color: "#dc2626", border: "#fca5a5" },
  "Review Required": { bg: "#f3f4f6", color: "#4b5563", border: "#d1d5db" },
};

function scoreColor(s: number | null) {
  if (s === null || !Number.isFinite(s)) return "#6b7280";
  if (s >= 75) return "#15803d";
  if (s >= 55) return "#1d4ed8";
  if (s >= 40) return "#d97706";
  return "#dc2626";
}
function scoreBg(s: number | null) {
  if (s === null || !Number.isFinite(s)) return "#f3f4f6";
  if (s >= 75) return "#dcfce7";
  if (s >= 55) return "#dbeafe";
  if (s >= 40) return "#fef3c7";
  return "#fee2e2";
}
function scoreBorder(s: number | null) {
  if (s === null || !Number.isFinite(s)) return "#e5e7eb";
  if (s >= 75) return "#86efac";
  if (s >= 55) return "#93c5fd";
  if (s >= 40) return "#fcd34d";
  return "#fca5a5";
}
function scoreLabel(s: number | null) {
  if (s === null || !Number.isFinite(s)) return "Score unavailable";
  if (s >= 75) return "Strong Match";
  if (s >= 55) return "Moderate Match";
  if (s >= 40) return "Weak Match";
  return "Poor Match";
}

/** Detect when structured score and prose disagree — surface honestly without rewriting model output. */
function narrativeSoundsStrongHire(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  return /\b(excellent|strong candidate|highly qualified|top-tier|top tier|exceptional|great fit|excellent fit|robust profile|superb|outstanding|an excellent fit|strong profile)\b/i.test(
    t,
  );
}

function scoreLooksCautious(score: number | null): boolean {
  return score !== null && Number.isFinite(score) && score < 40;
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function LoadingSkeleton() {
  return (
    <div style={{ padding: "1rem" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", marginBottom: "1rem" }}>
        <div style={{ width: "20px", height: "20px", border: "2.5px solid #e5e7eb", borderTopColor: "#002147", borderRadius: "50%", animation: "pmu-spin 0.75s linear infinite", flexShrink: 0 }} />
        <span style={{ fontSize: "0.85rem", color: "#6b7280", fontWeight: "500" }}>
          Analyzing candidate with Gemini AI…
        </span>
      </div>
      {[80, 60, 90].map((w, i) => (
        <div key={i} style={{ height: "10px", backgroundColor: "#f3f4f6", borderRadius: "999px", marginBottom: "0.6rem", width: `${w}%`, animation: "pmu-pulse 1.4s ease-in-out infinite", animationDelay: `${i * 0.2}s` }} />
      ))}
    </div>
  );
}

function ScoreRing({ score }: { score: number | null }) {
  if (score === null || !Number.isFinite(score)) {
    return (
      <div style={{ position: "relative", width: "86px", height: "86px", flexShrink: 0 }}>
        <svg width="86" height="86" viewBox="0 0 86 86">
          <circle cx="43" cy="43" r={34} fill="#f3f4f6" stroke="#e5e7eb" strokeWidth="6" />
        </svg>
        <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
          <span style={{ fontSize: "1.15rem", fontWeight: "800", color: "#6b7280", lineHeight: 1 }}>—</span>
          <span style={{ fontSize: "0.5rem", color: "#9ca3af", fontWeight: "700", textTransform: "uppercase", letterSpacing: "0.02em", textAlign: "center", padding: "0 0.25rem" }}>
            No score
          </span>
        </div>
      </div>
    );
  }
  const c   = scoreColor(score);
  const bg  = scoreBg(score);
  const bd  = scoreBorder(score);
  const r   = 34;
  const circ = 2 * Math.PI * r;
  const dash = circ * (1 - score / 100);

  return (
    <div style={{ position: "relative", width: "86px", height: "86px", flexShrink: 0 }}>
      <svg width="86" height="86" viewBox="0 0 86 86" style={{ transform: "rotate(-90deg)" }}>
        <circle cx="43" cy="43" r={r} fill={bg} stroke="#e5e7eb" strokeWidth="6" />
        <circle
          cx="43" cy="43" r={r}
          fill="none"
          stroke={bd}
          strokeWidth="6"
          strokeDasharray={circ}
          strokeDashoffset={dash}
          strokeLinecap="round"
          style={{ transition: "stroke-dashoffset 0.8s ease" }}
        />
      </svg>
      <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
        <span style={{ fontSize: "1.4rem", fontWeight: "800", color: c, lineHeight: 1 }}>{score}</span>
        <span style={{ fontSize: "0.55rem", color: c, fontWeight: "700", textTransform: "uppercase", letterSpacing: "0.03em" }}>/100</span>
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

interface Props {
  candidateId: string;
  stage: AIStage;
  candidateName?: string;
}

export function AIAnalysisCard({ candidateId, stage, candidateName }: Props) {
  const [result,  setResult]  = useState<AIAnalysisResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);
  const [ran,     setRan]     = useState(false);

  const isInterviewer = stage === "interviewer";
  const headerTitle   = isInterviewer ? "AI EVALUATION ASSIST" : "AI CANDIDATE ANALYSIS";
  const idleTitle     = isInterviewer ? "Get AI drafting support" : "Generate candidate insight";
  const idleSub       = isInterviewer
    ? "Draft strengths, risks, and suggested comments aligned with your evaluation criteria (from profile evidence — you still decide final ratings)."
    : "Use Gemini to summarize strengths, risks, and fit.";
  const scoreCaption  = isInterviewer ? "Draft profile signal" : "AI Match Score";

  const run = async (force = false) => {
    setLoading(true);
    setError(null);
    try {
      const data = await analyzeCandidateAI(candidateId, stage, force);
      setResult(data);
      setRan(true);
    } catch (e) {
      setError(extractFunctionError(e));
    } finally {
      setLoading(false);
    }
  };

  const recStyle = result ? (REC_BADGE[result.recommendation] ?? { bg: "#f3f4f6", color: "#6b7280", border: "#e5e7eb" }) : null;

  return (
    <div style={{
      backgroundColor: "white",
      border: "1px solid #e5e7eb",
      borderRadius: "0.875rem",
      overflow: "hidden",
      boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
      marginTop: "0.75rem",
    }}>
      {/* ── Header ── */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "0.75rem 1.1rem",
        background: "linear-gradient(135deg, #002147 0%, #003a7a 100%)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.55rem" }}>
          {/* Sparkle / AI icon */}
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#93c5fd" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z"/>
          </svg>
          <span style={{ fontSize: "0.8rem", fontWeight: "700", color: "white", letterSpacing: "0.05em" }}>
            {headerTitle}
          </span>
          {candidateName && (
            <span style={{ fontSize: "0.73rem", color: "#93c5fd", fontWeight: "400" }}>
              — {candidateName}
            </span>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="#60a5fa" stroke="none">
            <circle cx="12" cy="12" r="10"/>
          </svg>
          <span style={{ fontSize: "0.65rem", color: "#60a5fa", fontStyle: "italic" }}>Powered by Gemini</span>
        </div>
      </div>

      {/* ── Body ── */}
      <div style={{ padding: "0" }}>

        {/* Not yet triggered */}
        {!ran && !loading && !error && (
          <div style={{ padding: "0.875rem 1.1rem", backgroundColor: "#f8fafc" }}>
            <div
              className="pmu-ai-cta-card"
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "1rem",
                flexWrap: "wrap",
                backgroundColor: "white",
                border: "1px solid #e2e8f0",
                borderRadius: "0.75rem",
                padding: "1rem 1.1rem",
                boxShadow: "0 1px 2px rgba(15, 23, 42, 0.05)",
              }}
            >
              <div style={{ display: "flex", alignItems: "flex-start", gap: "0.75rem", flex: "1 1 220px", minWidth: 0 }}>
                <div
                  style={{
                    width: "38px",
                    height: "38px",
                    borderRadius: "0.5rem",
                    background: "linear-gradient(135deg, #eff6ff 0%, #e0e7ff 100%)",
                    border: "1px solid #c7d2fe",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                  }}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#002147" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z"/>
                  </svg>
                </div>
                <div style={{ minWidth: 0 }}>
                  <p style={{ fontSize: "0.92rem", fontWeight: "700", color: "#0f172a", marginBottom: "0.25rem", letterSpacing: "-0.01em" }}>
                    {idleTitle}
                  </p>
                  <p style={{ fontSize: "0.8rem", color: "#64748b", lineHeight: 1.5, margin: 0 }}>
                    {idleSub}
                  </p>
                </div>
              </div>
              <div style={{ flex: "0 0 auto" }} className="pmu-ai-cta-btn-wrap">
                <button
                  type="button"
                  onClick={() => void run(false)}
                  className="pmu-ai-cta-btn"
                  style={{
                    padding: "0.5rem 1.25rem",
                    backgroundColor: "#002147",
                    color: "white",
                    border: "none",
                    borderRadius: "0.75rem",
                    fontSize: "0.82rem",
                    fontWeight: "600",
                    cursor: "pointer",
                    fontFamily: "inherit",
                    whiteSpace: "nowrap",
                    boxShadow: "0 1px 2px rgba(0, 33, 71, 0.2)",
                    transition: "background-color 0.15s ease, box-shadow 0.15s ease, transform 0.1s ease",
                  }}
                  onMouseEnter={e => {
                    e.currentTarget.style.backgroundColor = "#003366";
                    e.currentTarget.style.boxShadow = "0 2px 6px rgba(0, 33, 71, 0.28)";
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.backgroundColor = "#002147";
                    e.currentTarget.style.boxShadow = "0 1px 2px rgba(0, 33, 71, 0.2)";
                  }}
                  onMouseDown={e => { e.currentTarget.style.transform = "scale(0.98)"; }}
                  onMouseUp={e => { e.currentTarget.style.transform = "scale(1)"; }}
                >
                  Analyze with AI
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Loading */}
        {loading && <LoadingSkeleton />}

        {/* Error */}
        {error && !loading && (
          <div style={{ padding: "0.875rem 1.1rem" }}>
            <div style={{
              backgroundColor: "#fef2f2", border: "1px solid #fecaca",
              borderRadius: "0.6rem", padding: "0.875rem 1rem",
            }}>
              <div style={{ display: "flex", alignItems: "flex-start", gap: "0.6rem" }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#dc2626" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: "0.05rem" }}>
                  <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                </svg>
                <div>
                  <p style={{ fontSize: "0.82rem", fontWeight: "600", color: "#991b1b", marginBottom: "0.25rem" }}>Analysis Failed</p>
                  <p style={{ fontSize: "0.78rem", color: "#dc2626", lineHeight: 1.5, marginBottom: "0.5rem" }}>{error}</p>
                  <button
                    onClick={() => void run(true)}
                    style={{
                      fontSize: "0.78rem", fontWeight: "600",
                      color: "white", backgroundColor: "#dc2626",
                      border: "none", borderRadius: "0.375rem",
                      padding: "0.3rem 0.75rem", cursor: "pointer", fontFamily: "inherit",
                    }}
                    onMouseEnter={e => { e.currentTarget.style.backgroundColor = "#b91c1c"; }}
                    onMouseLeave={e => { e.currentTarget.style.backgroundColor = "#dc2626"; }}
                  >
                    Try Again
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Results */}
        {result && !loading && (
          <div style={{ padding: "1rem 1.1rem" }}>

            {/* Score + recommendation row */}
            <div style={{ display: "flex", alignItems: "center", gap: "1.1rem", marginBottom: "1rem" }}>
              <ScoreRing score={result.score} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontSize: "0.7rem", color: "#9ca3af", fontWeight: "600", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "0.3rem" }}>
                  {scoreCaption}
                </p>
                <p style={{ fontSize: "1.1rem", fontWeight: "800", color: scoreColor(result.score), lineHeight: 1, marginBottom: "0.4rem" }}>
                  {scoreLabel(result.score)}
                </p>
                <span style={{
                  display: "inline-block",
                  backgroundColor: recStyle!.bg,
                  color: recStyle!.color,
                  border: `1px solid ${recStyle!.border}`,
                  padding: "0.22rem 0.75rem",
                  borderRadius: "999px",
                  fontSize: "0.78rem",
                  fontWeight: "700",
                }}>
                  {result.recommendation}
                </span>
              </div>
              <button
                onClick={() => void run(true)}
                style={{
                  alignSelf: "flex-start",
                  fontSize: "0.72rem", color: "#6b7280",
                  background: "white", border: "1px solid #e5e7eb",
                  borderRadius: "0.4rem", padding: "0.28rem 0.65rem",
                  cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap",
                }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = "#002147"; e.currentTarget.style.color = "#002147"; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = "#e5e7eb"; e.currentTarget.style.color = "#6b7280"; }}
              >
                ↺ Regenerate
              </button>
            </div>

            {result.score !== null &&
              scoreLooksCautious(result.score) &&
              narrativeSoundsStrongHire(result.justification) && (
              <div
                style={{
                  backgroundColor: "#fffbeb",
                  border: "1px solid #fcd34d",
                  borderRadius: "0.5rem",
                  padding: "0.55rem 0.75rem",
                  marginBottom: "1rem",
                  fontSize: "0.78rem",
                  color: "#92400e",
                  lineHeight: 1.55,
                }}
              >
                The model gave a cautious draft score but strongly positive language below. Those fragments were not rewritten—treat them as drafts and weigh them against weaknesses and your interview.
              </div>
            )}

            {/* Justification insight box */}
            {result.justification && (
              <div style={{
                backgroundColor: "#eff6ff", border: "1px solid #bfdbfe",
                borderLeft: "3px solid #3b82f6",
                borderRadius: "0.5rem", padding: "0.7rem 0.9rem",
                marginBottom: "1rem",
              }}>
                <p style={{ fontSize: "0.7rem", fontWeight: "700", color: "#1d4ed8", marginBottom: "0.2rem", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                  AI Insight
                </p>
                <p style={{ fontSize: "0.82rem", color: "#1e40af", lineHeight: 1.55 }}>
                  {result.justification}
                </p>
              </div>
            )}

            {/* Strengths */}
            {result.strengths.length > 0 && (
              <div style={{ marginBottom: "0.75rem" }}>
                <p style={{ fontSize: "0.7rem", fontWeight: "700", color: "#15803d", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: "0.5rem" }}>
                  ✓ Strengths
                </p>
                <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
                  {result.strengths.map((s, i) => (
                    <div key={i} style={{
                      display: "flex", alignItems: "flex-start", gap: "0.5rem",
                      backgroundColor: "#f0fdf4", border: "1px solid #bbf7d0",
                      borderRadius: "0.45rem", padding: "0.45rem 0.7rem",
                    }}>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: "0.12rem" }}>
                        <polyline points="20 6 9 17 4 12"/>
                      </svg>
                      <span style={{ fontSize: "0.78rem", color: "#166534", lineHeight: 1.45 }}>{s}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Weaknesses */}
            {result.weaknesses.length > 0 && (
              <div>
                <p style={{ fontSize: "0.7rem", fontWeight: "700", color: "#b45309", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: "0.5rem" }}>
                  ⚠ Weaknesses / Risks
                </p>
                <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
                  {result.weaknesses.map((w, i) => (
                    <div key={i} style={{
                      display: "flex", alignItems: "flex-start", gap: "0.5rem",
                      backgroundColor: "#fff7ed", border: "1px solid #fed7aa",
                      borderRadius: "0.45rem", padding: "0.45rem 0.7rem",
                    }}>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#d97706" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: "0.12rem" }}>
                        <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
                      </svg>
                      <span style={{ fontSize: "0.78rem", color: "#92400e", lineHeight: 1.45 }}>{w}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <style>{`
        @keyframes pmu-spin  { to { transform: rotate(360deg); } }
        @keyframes pmu-pulse { 0%,100% { opacity:1; } 50% { opacity:.4; } }

        /* Idle CTA: desktop = text left, button right; mobile = stack, full-width action */
        @media (min-width: 640px) {
          .pmu-ai-cta-card {
            flex-wrap: nowrap !important;
          }
          .pmu-ai-cta-btn-wrap {
            width: auto !important;
            max-width: none !important;
            display: flex;
            justify-content: flex-end;
          }
        }
        @media (max-width: 639px) {
          .pmu-ai-cta-btn-wrap {
            width: 100% !important;
          }
          .pmu-ai-cta-btn {
            width: 100%;
          }
        }
      `}</style>
    </div>
  );
}
