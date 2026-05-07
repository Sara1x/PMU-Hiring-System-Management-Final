import { useState, useEffect } from 'react';
import { ChevronDown, ChevronUp, UserCircle } from 'lucide-react';
import { DeanLayout } from '../components/DeanLayout';
import { collection, doc, getDoc, getDocs, onSnapshot, query, updateDoc, where } from 'firebase/firestore';
import { db } from '../firebase';
import { normalizeRequisitionStatus, workflowStageFromStatus } from '../utils/requisitionWorkflow';
import { AIAnalysisCard } from '../components/AIAnalysisCard';
import { getRequisitionNumberOfPositions, getRequisitionPositionTitle } from '../utils/requisitionFields';

interface Recommendation {
  id: string;
  name: string;
  position: string;
  positionTitle: string;
  vacancies: number | null;
  req: string;
  department: string;
  chairRecommendation: string;
  chairComments: string;
  interviewerComments: string[];
  avgScore: number | null;
  evaluationsCount: number;
  /**
   * Badge only: Hire / Not Hire outcome.
   * Firestore `finalDecision` first; if missing, legacy `status` only when Hired/Not Hired (never Completed).
   */
  finalDecision?: 'Hired' | 'Not Hired';
  /** True when `finalDecision` field in Firestore is Hired/Not Hired (AI + buttons hidden). */
  hasFirestoreFinalDecision: boolean;
}

const REC_BADGE: Record<string, { bg: string; color: string }> = {
  'Strongly Agree':    { bg: '#dcfce7', color: '#15803d' },
  'Agree':             { bg: '#dbeafe', color: '#1d4ed8' },
  'Neutral':           { bg: '#fef9c3', color: '#92400e' },
  'Disagree':          { bg: '#fee2e2', color: '#dc2626' },
  'Strongly Disagree': { bg: '#fecaca', color: '#991b1b' },
  'Highly Recommend': { bg: '#dcfce7', color: '#15803d' },
  'Recommend':        { bg: '#dbeafe', color: '#1d4ed8' },
  'Do Not Recommend': { bg: '#fee2e2', color: '#dc2626' },
};

const DECISION_STYLE: Record<string, { bg: string; color: string; border: string }> = {
  'Hired':     { bg: '#dcfce7', color: '#15803d', border: '#86efac' },
  'Not Hired': { bg: '#fee2e2', color: '#dc2626', border: '#fca5a5' },
};

function isFinalCandidateStatus(status: unknown): status is 'Hired' | 'Not Hired' {
  return status === 'Hired' || status === 'Not Hired';
}

function normalizeFinalDecisionValue(fd: unknown): 'Hired' | 'Not Hired' | undefined {
  if (fd === undefined || fd === null) return undefined;
  const v = String(fd).trim();
  if (v === 'Hired') return 'Hired';
  if (v === 'Not Hired') return 'Not Hired';
  return undefined;
}

/** Legacy workflow: only Hired/Not Hired — never use Completed or other statuses for the Dean badge. */
function legacyDecisionFromStatus(st: unknown): 'Hired' | 'Not Hired' | undefined {
  if (st === undefined || st === null) return undefined;
  const v = String(st).trim();
  if (v === 'Hired') return 'Hired';
  if (v === 'Not Hired') return 'Not Hired';
  return undefined;
}

function candidateHasFinalDecisionField(data: Record<string, unknown>): boolean {
  return normalizeFinalDecisionValue(data.finalDecision) !== undefined;
}

function candidateDecided(data: Record<string, unknown>): boolean {
  return candidateHasFinalDecisionField(data) || isFinalCandidateStatus(data.status);
}

/**
 * Move requisition → Completed when Dean has finished everyone who actually reached
 * committee evaluation on this req. (Applicants still linked to the req but never
 * evaluated — e.g. seed/Gemini CVs — no longer block completion.)
 */
async function tryFinalizeRequisitionIfDone(reqId: string): Promise<void> {
  if (!reqId || reqId === '-') return;

  const reqRef = doc(db, 'requisitions', reqId);
  const reqSnap = await getDoc(reqRef);
  if (!reqSnap.exists()) return;

  const currentStatus = normalizeRequisitionStatus((reqSnap.data().status as string) ?? '');
  if (currentStatus !== 'Decision Pending') return;

  const [reqCandSnap, evalSnap] = await Promise.all([
    getDocs(query(collection(db, 'candidates'), where('requisitionId', '==', reqId))),
    getDocs(query(collection(db, 'evaluations'), where('requisitionId', '==', reqId))),
  ]);

  const docsById = new Map(reqCandSnap.docs.map(d => [d.id, d]));

  const idsFromEval = new Set<string>();
  evalSnap.docs.forEach(d => {
    const cid = String((d.data().candidateId as string) ?? '').trim();
    if (cid) idsFromEval.add(cid);
  });

  const cohortIds =
    idsFromEval.size > 0 ? [...idsFromEval] : reqCandSnap.docs.map(d => d.id);

  const allDecided =
    cohortIds.length > 0 &&
    cohortIds.every(cid => {
      const snap = docsById.get(cid);
      if (!snap) return false;
      return candidateDecided(snap.data() as Record<string, unknown>);
    });

  if (!allDecided) return;

  const anyHired = cohortIds.some(cid => {
    const snap = docsById.get(cid);
    if (!snap) return false;
    const x = snap.data() as Record<string, unknown>;
    return x.finalDecision === 'Hired' || x.status === 'Hired';
  });

  await updateDoc(reqRef, {
    status: 'Completed',
    workflowStage: workflowStageFromStatus('Completed'),
    decision: anyHired ? 'Accepted' : 'Rejected',
  });
}

function scoreBadge(score: number): { bg: string; color: string } {
  if (score >= 3.5) return { bg: '#dcfce7', color: '#15803d' };
  if (score >= 2.5) return { bg: '#dbeafe', color: '#1d4ed8' };
  if (score >= 1.5) return { bg: '#fef9c3', color: '#92400e' };
  return { bg: '#fee2e2', color: '#dc2626' };
}

export default function ChairRecommendations() {
  const [recs, setRecs]       = useState<Recommendation[]>([]);
  const [loading, setLoading] = useState(true);
  const [deciding, setDeciding] = useState<string | null>(null);
  const [decisionError, setDecisionError] = useState<string | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    type EvalDoc = {
      candidateId: string;
      committeeId: string;
      candidateName: string;
      candidatePosition: string;
      requisitionId: string;
      recommendation: string;
      comments: string;
      ratings: number[];
    };

    let evals: EvalDoc[] = [];
    let committees: { id: string; data: Record<string, unknown> }[] = [];
    let candidateDecisionDisplay: Map<string, 'Hired' | 'Not Hired'> = new Map();
    let candidateFinalFieldIds: Set<string> = new Set();
    /** Requisitions still in Dean final-decisions workflow: pending decision or completed (history). */
    let deanVisibleReqIds: Set<string> = new Set();
    let requisitionTitleById: Map<string, string> = new Map();
    let requisitionVacanciesById: Map<string, number | null> = new Map();
    let evLoaded = false, comLoaded = false, candLoaded = false, reqLoaded = false;

    const recompute = () => {
      if (!evLoaded || !comLoaded || !candLoaded || !reqLoaded) return;

      // Committees on requisitions in Dean final-decisions phase (pending or completed)
      // with Chair recommendation sent to Dean (sentToDean === true).
      const visibleCommittees = new Map<string, {
        department: string; chairRecommendation: string; chairComments: string; requisitionId: string;
      }>();

      committees.forEach(({ id, data }) => {
        if (data.sentToDean !== true) return;
        const reqId = (data.requisitionId as string) ?? '';
        if (!deanVisibleReqIds.has(reqId)) return;
        visibleCommittees.set(id, {
          department:          (data.department          as string) ?? '-',
          chairRecommendation: (data.chairRecommendation as string) ?? '',
          chairComments:       (data.chairComments       as string) ?? '',
          requisitionId:       reqId,
        });
      });

      // Group evaluations by candidate, but only those tied to a visible committee
      const grouped = new Map<string, {
        name: string; position: string; req: string; committeeId: string;
        latestRec: string; ratings: number[]; comments: string[];
      }>();

      evals.forEach(ev => {
        if (!visibleCommittees.has(ev.committeeId)) return;
        const avg = ev.ratings.length > 0
          ? ev.ratings.reduce((a, b) => a + b, 0) / ev.ratings.length
          : 0;
        if (!grouped.has(ev.candidateId)) {
          grouped.set(ev.candidateId, {
            name:        ev.candidateName,
            position:    ev.candidatePosition,
            req:         ev.requisitionId,
            committeeId: ev.committeeId,
            latestRec:   ev.recommendation,
            ratings:     [],
            comments:    [],
          });
        }
        const entry = grouped.get(ev.candidateId)!;
        if (avg > 0) entry.ratings.push(avg);
        if (ev.recommendation) entry.latestRec = ev.recommendation;
        if (ev.comments?.trim()) entry.comments.push(ev.comments.trim());
      });

      const built: Recommendation[] = [];
      grouped.forEach((val, candidateId) => {
        const cm       = visibleCommittees.get(val.committeeId);
        const reqId    = cm?.requisitionId || val.req;
        const avgScore = val.ratings.length > 0
          ? val.ratings.reduce((a, b) => a + b, 0) / val.ratings.length
          : null;
        const resolved = candidateDecisionDisplay.get(candidateId);
        const fd = resolved;
        const hasFirestoreFinalDecision = candidateFinalFieldIds.has(candidateId);

        built.push({
          id:                  candidateId,
          name:                val.name,
          position:            val.position,
          positionTitle:       requisitionTitleById.get(reqId) ?? val.position,
          vacancies:           requisitionVacanciesById.get(reqId) ?? null,
          req:                 reqId,
          department:          cm?.department          ?? '-',
          chairRecommendation: cm?.chairRecommendation ?? val.latestRec,
          chairComments:       cm?.chairComments       ?? '',
          interviewerComments: val.comments,
          avgScore,
          evaluationsCount:    val.ratings.length,
          finalDecision:       fd,
          hasFirestoreFinalDecision,
        });
      });

      // Dean action needed first: no resolved Hire / Not Hire yet (badge + legacy status).
      built.sort((a, b) => {
        const aPending = a.finalDecision == null ? 0 : 1;
        const bPending = b.finalDecision == null ? 0 : 1;
        if (aPending !== bPending) return aPending - bPending;
        return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
      });

      setRecs(built);
      setLoading(false);
    };

    const u1 = onSnapshot(collection(db, 'evaluations'), (snap) => {
      evals = snap.docs.map(d => {
        const data = d.data() as Record<string, unknown>;
        const ratings = Object.values((data.ratings as Record<string, number>) ?? {});
        return {
          candidateId:        (data.candidateId       as string) ?? '',
          committeeId:        (data.committeeId       as string) ?? '',
          candidateName:      (data.candidateName     as string) ?? '-',
          candidatePosition:  (data.candidatePosition as string) ?? '-',
          requisitionId:      (data.requisitionId     as string) ?? '-',
          recommendation:     (data.recommendation    as string) ?? '',
          comments:           (data.comments          as string) ?? '',
          ratings,
        };
      });
      evLoaded = true; recompute();
    }, e => { console.error(e); evLoaded = true; recompute(); });

    const u2 = onSnapshot(collection(db, 'committees'), (snap) => {
      committees = snap.docs.map(d => ({ id: d.id, data: d.data() as Record<string, unknown> }));
      comLoaded = true; recompute();
    }, e => { console.error(e); comLoaded = true; recompute(); });

    const u3 = onSnapshot(collection(db, 'candidates'), (snap) => {
      const display = new Map<string, 'Hired' | 'Not Hired'>();
      const fieldIds = new Set<string>();
      snap.docs.forEach(d => {
        const data = d.data() as Record<string, unknown>;
        const fromField = normalizeFinalDecisionValue(data.finalDecision);
        if (fromField) {
          display.set(d.id, fromField);
          fieldIds.add(d.id);
          return;
        }
        const fromLegacy = legacyDecisionFromStatus(data.status);
        if (fromLegacy) display.set(d.id, fromLegacy);
      });
      candidateDecisionDisplay = display;
      candidateFinalFieldIds = fieldIds;
      candLoaded = true; recompute();
    }, e => { console.error(e); candLoaded = true; recompute(); });

    const u4 = onSnapshot(collection(db, 'requisitions'), (snap) => {
      const ids = new Set<string>();
      const titleMap = new Map<string, string>();
      const vacanciesMap = new Map<string, number | null>();
      snap.docs.forEach(d => {
        const data = d.data() as Record<string, unknown>;
        const status = normalizeRequisitionStatus((data.status as string) ?? '');
        if (status === 'Decision Pending' || status === 'Completed') ids.add(d.id);
        titleMap.set(d.id, getRequisitionPositionTitle(data).trim());
        const rawVacancies = getRequisitionNumberOfPositions(data);
        vacanciesMap.set(d.id, rawVacancies > 0 ? rawVacancies : null);
      });
      deanVisibleReqIds = ids;
      requisitionTitleById = titleMap;
      requisitionVacanciesById = vacanciesMap;
      reqLoaded = true; recompute();
    }, e => { console.error(e); reqLoaded = true; recompute(); });

    return () => { u1(); u2(); u3(); u4(); };
  }, []);

  // Backfill: when every candidate on Final Decisions has Hire / Not Hire, ensure requisition leaves Decision Pending.
  useEffect(() => {
    if (loading || recs.length === 0) return;
    const byReq = new Map<string, Recommendation[]>();
    for (const r of recs) {
      if (!r.req || r.req === '-') continue;
      if (!byReq.has(r.req)) byReq.set(r.req, []);
      byReq.get(r.req)!.push(r);
    }
    byReq.forEach((rows, reqId) => {
      if (rows.every(row => row.finalDecision != null)) {
        void tryFinalizeRequisitionIfDone(reqId);
      }
    });
  }, [loading, recs]);

  const makeDecision = async (candidateId: string, decision: 'Hired' | 'Not Hired') => {
    setDeciding(candidateId);
    setDecisionError(null);
    try {
      const rec = recs.find(r => r.id === candidateId);
      if (!rec) return;
      const candidateRef = doc(db, 'candidates', candidateId);
      const candidateSnap = await getDoc(candidateRef);
      if (!candidateSnap.exists()) {
        setDecisionError('Candidate record no longer exists.');
        return;
      }
      const cand = candidateSnap.data() as Record<string, unknown>;
      const currentFinal = normalizeFinalDecisionValue(cand.finalDecision);
      const currentStatus = cand.status as string | undefined;
      const resolvedLegacy = isFinalCandidateStatus(currentStatus) ? currentStatus : null;

      if (currentFinal !== undefined) {
        if (currentFinal === decision) {
          setRecs(prev => prev.map(r =>
            r.id === candidateId
              ? { ...r, finalDecision: decision, hasFirestoreFinalDecision: true }
              : r
          ));
          return;
        }
        setDecisionError(`Decision already finalized as "${currentFinal}". Conflicting update blocked.`);
        return;
      }

      if (resolvedLegacy !== null) {
        if (resolvedLegacy === decision) {
          setRecs(prev => prev.map(r =>
            r.id === candidateId
              ? { ...r, finalDecision: resolvedLegacy, hasFirestoreFinalDecision: false }
              : r
          ));
          return;
        }
        setDecisionError(`Decision already finalized as "${resolvedLegacy}". Conflicting update blocked.`);
        return;
      }

      // Enforce max hires per requisition from vacancies/positions.
      if (decision === 'Hired' && rec.vacancies !== null) {
        const reqCandSnap = await getDocs(
          query(collection(db, 'candidates'), where('requisitionId', '==', rec.req))
        );
        const alreadyHired = reqCandSnap.docs.filter(d => {
          const x = d.data() as Record<string, unknown>;
          return x.finalDecision === 'Hired' || x.status === 'Hired';
        }).length;
        const projectedHired = alreadyHired + 1;
        if (projectedHired > rec.vacancies) {
          setDecisionError(`Hiring limit reached for ${rec.req}: max ${rec.vacancies} position${rec.vacancies === 1 ? '' : 's'}.`);
          return;
        }
      }

      await updateDoc(candidateRef, {
        finalDecision: decision,
        status: decision,
      });

      setRecs(prev => prev.map(r =>
        r.id === candidateId ? { ...r, finalDecision: decision, hasFirestoreFinalDecision: true } : r
      ));

      const reqId = rec?.req;
      if (reqId && reqId !== '-') {
        await tryFinalizeRequisitionIfDone(reqId);
      }
    } catch (e) {
      console.error(e);
      setDecisionError('Failed to save decision. Please try again.');
    } finally {
      setDeciding(null);
    }
  };

  const toggleExpanded = (candidateId: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(candidateId)) next.delete(candidateId);
      else next.add(candidateId);
      return next;
    });
  };

  return (
    <DeanLayout>
      <h1 style={{ fontSize: '1.6rem', fontWeight: '700', color: '#111827', marginBottom: '0.25rem' }}>
        Final Decisions
      </h1>
      <p style={{ color: '#6b7280', fontSize: '0.9rem', marginBottom: '1.75rem' }}>
        Review Chair recommendations and make final hiring decisions for each candidate
      </p>
      {decisionError && (
        <div style={{ marginBottom: '1rem', backgroundColor: '#fef2f2', color: '#b91c1c', border: '1px solid #fecaca', borderRadius: '0.6rem', padding: '0.75rem 0.9rem', fontSize: '0.85rem', fontWeight: '600' }}>
          {decisionError}
        </div>
      )}

      {loading ? (
        <div style={{ textAlign: 'center', padding: '3rem', color: '#6b7280' }}>Loading…</div>
      ) : recs.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '3rem', color: '#9ca3af', backgroundColor: 'white', borderRadius: '0.875rem', boxShadow: '0 1px 3px rgba(0,0,0,0.07)' }}>
          No candidates are ready for a final decision yet. The Chair must complete evaluations and send a recommendation first.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {recs.map(r => {
            const recBadge  = REC_BADGE[r.chairRecommendation] ?? { bg: '#f3f4f6', color: '#6b7280' };
            const ds        = r.finalDecision ? DECISION_STYLE[r.finalDecision] : null;
            const sc        = r.avgScore !== null ? scoreBadge(r.avgScore) : null;
            const isPending = r.finalDecision == null;
            const isActing  = deciding === r.id;
            const reqCandidates = recs.filter(x => x.req === r.req);
            const hiredForReq = reqCandidates.filter(x => x.finalDecision === 'Hired').length;
            const hireLimitReached = r.vacancies !== null && hiredForReq >= r.vacancies && r.finalDecision !== 'Hired';
            const isExpanded = expandedIds.has(r.id);

            return (
              <div key={r.id} style={{
                backgroundColor: 'white',
                borderRadius: '0.875rem',
                boxShadow: '0 1px 3px rgba(0,0,0,0.07)',
                overflow: 'hidden',
                border: ds ? `1.5px solid ${ds.border}` : '1.5px solid transparent',
              }}>

                <div style={{ padding: '0.95rem 1.25rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem' }}>
                    <div style={{ width: '46px', height: '46px', borderRadius: '50%', border: '1.5px solid #d1d5db', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <UserCircle size={28} color="#9ca3af" />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontSize: '0.975rem', fontWeight: '700', color: '#111827', marginBottom: '0.1rem' }}>{r.name}</p>
                      <p style={{ fontSize: '0.78rem', color: '#6b7280', marginBottom: '0.1rem' }}>
                        {r.positionTitle || r.position}
                      </p>
                      <p style={{ fontSize: '0.74rem', color: '#9ca3af' }}>{r.req} · {r.department}</p>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', flexShrink: 0, gap: '0.5rem', flexWrap: 'wrap' }}>
                      {isPending && (
                        <span
                          style={{
                            display: 'inline-block',
                            borderRadius: '999px',
                            padding: '0.22rem 0.55rem',
                            fontSize: '0.7rem',
                            fontWeight: '700',
                            letterSpacing: '0.02em',
                            backgroundColor: '#fff7ed',
                            color: '#c2410c',
                            border: '1px solid #fdba74',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          Decision pending
                        </span>
                      )}
                      <button
                        onClick={() => toggleExpanded(r.id)}
                        style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', padding: '0.35rem 0.65rem', border: '1px solid #d1d5db', backgroundColor: 'white', color: '#374151', borderRadius: '0.45rem', fontSize: '0.78rem', fontWeight: '600', cursor: 'pointer', fontFamily: 'inherit' }}
                      >
                        {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                        {isExpanded ? 'Hide Details' : 'View Details'}
                      </button>
                    </div>
                  </div>

                  {isExpanded && (
                    <div style={{ marginTop: '0.95rem', paddingTop: '0.95rem', borderTop: '1px solid #f3f4f6' }}>
                      {/* Context section */}
                      <div style={{ backgroundColor: '#f8fafc', border: '1px solid #e5e7eb', borderRadius: '0.625rem', padding: '0.875rem 1rem', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
                        <div>
                          <p style={{ fontSize: '0.68rem', fontWeight: '600', color: '#9ca3af', marginBottom: '0.4rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                            Chair Recommendation
                          </p>
                          <span style={{ display: 'inline-block', backgroundColor: recBadge.bg, color: recBadge.color, padding: '0.2rem 0.6rem', borderRadius: '999px', fontSize: '0.75rem', fontWeight: '600' }}>
                            {r.chairRecommendation || '—'}
                          </span>
                        </div>
                        <div>
                          <p style={{ fontSize: '0.68rem', fontWeight: '600', color: '#9ca3af', marginBottom: '0.4rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                            Average Score
                          </p>
                          {sc && r.avgScore !== null ? (
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', backgroundColor: sc.bg, color: sc.color, padding: '0.2rem 0.65rem', borderRadius: '999px', fontSize: '0.82rem', fontWeight: '700' }}>
                              {r.avgScore.toFixed(1)}
                              <span style={{ fontSize: '0.68rem', fontWeight: '500', opacity: 0.75 }}>/4</span>
                            </span>
                          ) : (
                            <span style={{ fontSize: '0.82rem', color: '#9ca3af' }}>—</span>
                          )}
                        </div>
                        <div>
                          <p style={{ fontSize: '0.68rem', fontWeight: '600', color: '#9ca3af', marginBottom: '0.4rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                            Final Decision
                          </p>
                          {ds ? (
                            <span style={{ display: 'inline-flex', alignItems: 'center', backgroundColor: ds.bg, color: ds.color, padding: '0.2rem 0.6rem', borderRadius: '999px', fontSize: '0.75rem', fontWeight: '700' }}>
                              {r.finalDecision === 'Hired' ? '✓ Hired' : '✕ Not Hired'}
                            </span>
                          ) : (
                            <span style={{ display: 'inline-flex', alignItems: 'center', backgroundColor: '#f3f4f6', color: '#6b7280', padding: '0.2rem 0.6rem', borderRadius: '999px', fontSize: '0.75rem', fontWeight: '600' }}>
                              Pending
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Chair comments */}
                      {r.chairComments && (
                        <div style={{ marginBottom: '1rem', padding: '0.6rem 0.875rem', backgroundColor: '#fefce8', border: '1px solid #fde68a', borderRadius: '0.5rem' }}>
                          <p style={{ fontSize: '0.68rem', fontWeight: '600', color: '#92400e', marginBottom: '0.15rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                            Chair's Comments
                          </p>
                          <p style={{ fontSize: '0.8rem', color: '#78350f' }}>{r.chairComments}</p>
                        </div>
                      )}

                      {/* Interviewer comments */}
                      {r.interviewerComments.length > 0 && (
                        <div style={{ marginBottom: '1rem', padding: '0.6rem 0.875rem', backgroundColor: '#f8fafc', border: '1px solid #e5e7eb', borderRadius: '0.5rem' }}>
                          <p style={{ fontSize: '0.68rem', fontWeight: '600', color: '#475569', marginBottom: '0.2rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                            Interviewer Comments
                          </p>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                            {r.interviewerComments.map((c, idx) => (
                              <p key={`${r.id}-iv-comment-${idx}`} style={{ fontSize: '0.8rem', color: '#334155' }}>
                                • {c}
                              </p>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* AI Analysis is only mounted while the candidate is
                          still pending a final decision. Once Hire / Not Hire
                          is chosen, no AI-related UI is rendered at all — no
                          card, no button, no placeholder, no container — so
                          the card ends cleanly after the Chair Comments
                          block. The underlying data in Firestore is NOT
                          deleted; only the UI surface is removed. */}
                      {isPending && (
                        <AIAnalysisCard candidateId={r.id} stage="dean" candidateName={r.name} />
                      )}

                      {/* Decision actions */}
                      {isPending && (
                        <div style={{ display: 'flex', gap: '0.6rem', paddingTop: '0.75rem', borderTop: '1px solid #f3f4f6' }}>
                          <button
                            disabled={isActing || hireLimitReached}
                            onClick={() => makeDecision(r.id, 'Hired')}
                            style={{ padding: '0.5rem 1.1rem', backgroundColor: (isActing || hireLimitReached) ? '#9ca3af' : '#16a34a', color: 'white', border: 'none', borderRadius: '0.4rem', fontSize: '0.82rem', fontWeight: '600', cursor: (isActing || hireLimitReached) ? 'not-allowed' : 'pointer', fontFamily: 'inherit' }}
                            onMouseEnter={e => { if (!isActing && !hireLimitReached) e.currentTarget.style.backgroundColor = '#15803d'; }}
                            onMouseLeave={e => { if (!isActing && !hireLimitReached) e.currentTarget.style.backgroundColor = '#16a34a'; }}
                          >
                            Hire
                          </button>
                          <button
                            disabled={isActing}
                            onClick={() => makeDecision(r.id, 'Not Hired')}
                            style={{ padding: '0.5rem 1.1rem', backgroundColor: 'white', color: '#dc2626', border: '1px solid #fca5a5', borderRadius: '0.4rem', fontSize: '0.82rem', fontWeight: '600', cursor: isActing ? 'not-allowed' : 'pointer', fontFamily: 'inherit' }}
                            onMouseEnter={e => { if (!isActing) e.currentTarget.style.backgroundColor = '#fef2f2'; }}
                            onMouseLeave={e => { if (!isActing) e.currentTarget.style.backgroundColor = 'white'; }}
                          >
                            Not Hire
                          </button>
                        </div>
                      )}
                      {isPending && hireLimitReached && (
                        <p style={{ marginTop: '0.55rem', fontSize: '0.78rem', color: '#b91c1c' }}>
                          Hiring limit reached for this requisition ({hiredForReq}/{r.vacancies} hired).
                        </p>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </DeanLayout>
  );
}
