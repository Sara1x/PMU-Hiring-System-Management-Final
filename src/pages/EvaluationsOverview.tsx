import { useState, useEffect } from 'react';
import { UserCircle, CheckCircle, X, ChevronDown, ChevronUp } from 'lucide-react';
import { ChairLayout } from '../components/ChairLayout';
import { AIAnalysisCard } from '../components/AIAnalysisCard';
import { collection, getDocs, doc, writeBatch, serverTimestamp, onSnapshot, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { normalizeRequisitionStatus, workflowStageFromStatus, type RequisitionStatus } from '../utils/requisitionWorkflow';
import { getRequisitionPositionTitle } from '../utils/requisitionFields';

const CHAIR_RECOMMENDATION_OPTIONS = [
  'Strongly Agree',
  'Agree',
  'Neutral',
  'Disagree',
  'Strongly Disagree',
];

const CHAIR_REC_BADGE: Record<string, { bg: string; color: string }> = {
  'Strongly Agree':    { bg: '#dcfce7', color: '#15803d' },
  'Agree':             { bg: '#dbeafe', color: '#1d4ed8' },
  'Neutral':           { bg: '#fef9c3', color: '#92400e' },
  'Disagree':          { bg: '#fee2e2', color: '#dc2626' },
  'Strongly Disagree': { bg: '#fecaca', color: '#991b1b' },
  'Pending':           { bg: '#f3f4f6', color: '#6b7280' },
};

const INTERVIEWER_REC_BADGE: Record<string, { bg: string; color: string }> = {
  'Highly Recommend': { bg: '#dcfce7', color: '#15803d' },
  'Recommend':        { bg: '#dbeafe', color: '#1d4ed8' },
  'Neutral':          { bg: '#fef9c3', color: '#92400e' },
  'Do Not Recommend': { bg: '#fee2e2', color: '#dc2626' },
  'Pending':          { bg: '#f3f4f6', color: '#6b7280' },
};

const FINAL_BADGE: Record<'Hired' | 'Not Hired' | 'Pending Decision', { bg: string; color: string }> = {
  'Hired':            { bg: '#dcfce7', color: '#15803d' },
  'Not Hired':        { bg: '#fee2e2', color: '#dc2626' },
  'Pending Decision': { bg: '#f3f4f6', color: '#6b7280' },
};

function normalizeFinalDecision(raw: unknown): 'Hired' | 'Not Hired' | 'Pending Decision' {
  const v = (raw as string | undefined) ?? '';
  if (v === 'Hired') return 'Hired';
  if (v === 'Not Hired') return 'Not Hired';
  return 'Pending Decision';
}

interface CandidateEvalRow {
  candidateId: string;
  name: string;
  position: string;
  recommendations: string[];
  comments: string[];
  avgRating: number | null;
  evalCount: number;
  /** Present when evaluation doc was submitted as committee representative */
  committeeLoggedBy?: string;
}

interface CommitteeMember {
  id: string;
  name: string;
  title: string;
}

interface CommitteeCard {
  committeeId: string;
  requisitionId: string;
  title: string;
  department: string;
  status: string;
  sentToDean: boolean;
  chairRecommendation?: string;
  interviewers: CommitteeMember[];
  candidateRows: CandidateEvalRow[];
}

interface ModalState {
  committeeId: string;
  requisitionId: string;
  title: string;
  department: string;
}

export default function EvaluationsOverview() {
  const [cards, setCards]           = useState<CommitteeCard[]>([]);
  const [loading, setLoading]       = useState(true);
  const [modal, setModal]           = useState<ModalState | null>(null);
  const [chairRec, setChairRec]     = useState('');
  const [chairComments, setChairComments] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);
  const [sentId, setSentId]         = useState<string | null>(null); // committeeId of latest success
  const [finalDecisionByCandidateId, setFinalDecisionByCandidateId] = useState<Record<string, unknown>>({});
  const [reqStatusById, setReqStatusById] = useState<Map<string, RequisitionStatus>>(() => new Map());
  const [expandedCommitteeIds, setExpandedCommitteeIds] = useState<Set<string>>(() => new Set());

  // Live requisition status map — used to gate which committees appear in the overview
  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, 'requisitions'),
      (snap) => {
        const m = new Map<string, RequisitionStatus>();
        snap.docs.forEach(d => {
          m.set(d.id, normalizeRequisitionStatus((d.data().status as string) ?? 'Pending HR'));
        });
        setReqStatusById(m);
      },
      (e) => console.error(e)
    );
    return unsub;
  }, []);

  useEffect(() => {
    // committees drive the list — use onSnapshot so status changes appear live
    const unsub = onSnapshot(collection(db, 'committees'), async committeeSnap => {
      try {
        // Auto-heal legacy records:
        // if a committee was already sent to Dean but still marked as Scheduled/Active,
        // normalize it to Completed for workflow consistency.
        const stale = committeeSnap.docs.filter(d => {
          const raw = d.data();
          return raw.sentToDean === true && (raw.status as string) !== 'Completed';
        });
        if (stale.length > 0) {
          await Promise.all(
            stale.map(d =>
              updateDoc(doc(db, 'committees', d.id), {
                status: 'Completed',
                completedAt: serverTimestamp(),
              })
            )
          );
        }

        const evalSnap = await getDocs(collection(db, 'evaluations'));

        // Group evaluations by committeeId → candidateId
        const evalMap = new Map<string, Map<string, {
          recommendations: string[];
          comments: string[];
          ratings: number[];
          evalCount: number;
          committeeLoggedBy?: string;
        }>>();

        evalSnap.docs.forEach(d => {
          const data      = d.data();
          const cid       = (data.committeeId  as string) ?? '';
          const candId    = (data.candidateId  as string) ?? '';
          const rec       = (data.recommendation as string) ?? '';
          const comment   = ((data.comments as string) ?? '').trim();
          const ratings   = Object.values((data.ratings as Record<string, number>) ?? {});
          const avg       = ratings.length > 0
            ? ratings.reduce((a: number, b: number) => a + b, 0) / ratings.length
            : null;
          const onBehalf  = data.submittedOnBehalfOfCommittee === true;
          const loggedName = String((data.submitterDisplayName as string) ?? '').trim();
          const loggedEmail = String((data.interviewerEmail as string) ?? '').trim();
          const loggedBy = onBehalf ? (loggedName || loggedEmail || '') : '';

          if (!evalMap.has(cid)) evalMap.set(cid, new Map());
          const candMap = evalMap.get(cid)!;
          if (!candMap.has(candId)) {
            candMap.set(candId, { recommendations: [], comments: [], ratings: [], evalCount: 0 });
          }
          const entry = candMap.get(candId)!;
          if (rec) entry.recommendations.push(rec);
          if (comment) entry.comments.push(comment);
          if (avg !== null) entry.ratings.push(avg);
          entry.evalCount += 1;
          if (loggedBy && !entry.committeeLoggedBy) entry.committeeLoggedBy = loggedBy;
        });

        const built: CommitteeCard[] = committeeSnap.docs.map(d => {
          const raw        = d.data();
          const candidates = (raw.candidates  as { id: string; name: string; position: string }[]) ?? [];
          const interviewers = ((raw.interviewers ?? []) as CommitteeMember[]);
          const candMap    = evalMap.get(d.id) ?? new Map();

          const candidateRows: CandidateEvalRow[] = candidates.map(c => {
            const entry = candMap.get(c.id);
            const avgRating = entry && entry.ratings.length > 0
              ? Math.round((entry.ratings.reduce((a: number, b: number) => a + b, 0) / entry.ratings.length) * 10) / 10
              : null;
            return {
              candidateId:     c.id,
              name:            c.name,
              position:        c.position,
              recommendations: entry?.recommendations ?? [],
              comments:        entry?.comments ?? [],
              avgRating,
              evalCount:       entry?.evalCount ?? 0,
              committeeLoggedBy: entry?.committeeLoggedBy,
            };
          });

          return {
            committeeId:         d.id,
            requisitionId:       (raw.requisitionId        as string)  ?? '-',
            title:               getRequisitionPositionTitle(raw as Record<string, unknown>),
            department:          (raw.department           as string)  ?? '-',
            status:              (raw.status               as string)  ?? 'Active',
            sentToDean:          (raw.sentToDean           as boolean) ?? false,
            chairRecommendation: raw.chairRecommendation   as string | undefined,
            interviewers,
            candidateRows,
          };
        });

        // Sort: Completed first, then others
        built.sort((a, b) => {
          if (a.status === 'Completed' && b.status !== 'Completed') return -1;
          if (b.status === 'Completed' && a.status !== 'Completed') return  1;
          return 0;
        });

        setCards(built);
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    });
    return unsub;
  }, []);

  useEffect(() => {
    // Real-time final decision tracking — read from candidate status
    const unsub = onSnapshot(
      collection(db, 'candidates'),
      (snap) => {
        const next: Record<string, unknown> = {};
        snap.docs.forEach(d => {
          const data = d.data() as Record<string, unknown>;
          next[d.id] = data.status; // 'Hired' | 'Not Hired' | other
        });
        setFinalDecisionByCandidateId(next);
      },
      (e) => console.error(e)
    );
    return unsub;
  }, []);

  const openModal = (card: CommitteeCard) => {
    setModal({ committeeId: card.committeeId, requisitionId: card.requisitionId, title: card.title, department: card.department });
    setChairRec('');
    setChairComments('');
    setModalError(null);
  };

  const closeModal = () => { setModal(null); setModalError(null); };
  const toggleExpanded = (committeeId: string) => {
    setExpandedCommitteeIds(prev => {
      const next = new Set(prev);
      if (next.has(committeeId)) next.delete(committeeId);
      else next.add(committeeId);
      return next;
    });
  };

  const handleSendToDean = async () => {
    if (!modal || !chairRec) return;
    if (!chairComments.trim()) {
      setModalError('Please add an additional comment before sending to Dean.');
      return;
    }
    setSubmitting(true);
    setModalError(null);
    try {
      const batch = writeBatch(db);

      // Update the requisition to Decision Pending
      batch.update(doc(db, 'requisitions', modal.requisitionId), {
        status: 'Decision Pending',
        workflowStage: workflowStageFromStatus('Decision Pending'),
      });

      // Mark the committee as sent with chair's recommendation
      batch.update(doc(db, 'committees', modal.committeeId), {
        status:              'Completed',
        sentToDean:          true,
        chairRecommendation: chairRec,
        chairComments:       chairComments.trim(),
        sentToDeanAt:        serverTimestamp(),
        completedAt:         serverTimestamp(),
      });

      await batch.commit();
      setSentId(modal.committeeId);
      closeModal();
    } catch (e) {
      console.error(e);
      setModalError('Failed to send recommendation. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const canSend = !!chairRec && !!chairComments.trim() && !submitting;

  // ── Status chip helper ────────────────────────────────────────────────────
  const StatusChip = ({ status }: { status: string }) => {
    const map: Record<string, { bg: string; color: string }> = {
      'Completed':        { bg: '#dcfce7', color: '#15803d' },
      'Active':           { bg: '#fef9c3', color: '#92400e' },
      'Scheduled':        { bg: '#dbeafe', color: '#1d4ed8' },
      'Under Evaluation': { bg: '#ede9fe', color: '#6d28d9' },
    };
    const s = map[status] ?? { bg: '#f3f4f6', color: '#6b7280' };
    return (
      <span style={{ backgroundColor: s.bg, color: s.color, padding: '0.2rem 0.65rem', borderRadius: '999px', fontSize: '0.75rem', fontWeight: '600' }}>
        {status}
      </span>
    );
  };

  return (
    <ChairLayout>
      {/* ── Recommendation modal ── */}
      {modal && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '1rem' }}>
          <div style={{ backgroundColor: 'white', borderRadius: '1rem', padding: '2rem', width: '100%', maxWidth: '500px', boxShadow: '0 10px 40px rgba(0,0,0,0.2)' }}>

            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '1.5rem' }}>
              <div>
                <p style={{ fontSize: '1.1rem', fontWeight: '700', color: '#111827', marginBottom: '0.2rem' }}>
                  Confirm & Send to Dean
                </p>
                <p style={{ fontSize: '0.85rem', color: '#6b7280' }}>{modal.title} · {modal.department}</p>
                <p style={{ fontSize: '0.75rem', color: '#9ca3af' }}>{modal.requisitionId}</p>
              </div>
              <button onClick={closeModal} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af' }}>
                <X size={20} />
              </button>
            </div>

            <div style={{ fontSize: '0.82rem', color: '#6b7280', backgroundColor: '#f8fafc', border: '1px solid #e5e7eb', borderRadius: '0.5rem', padding: '0.65rem 0.8rem', marginBottom: '1rem' }}>
              You are about to send this committee recommendation to the Dean. This moves the requisition to <strong style={{ color: '#111827' }}>Decision Pending</strong>.
            </div>

            <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: '600', color: '#374151', marginBottom: '0.5rem' }}>
              Department Recommendation <span style={{ color: '#dc2626' }}>*</span>
            </label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '1.25rem' }}>
              {CHAIR_RECOMMENDATION_OPTIONS.map(rec => {
                const selected = chairRec === rec;
                const badge = CHAIR_REC_BADGE[rec] ?? CHAIR_REC_BADGE['Pending'];
                return (
                  <label key={rec}
                    style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.65rem 0.875rem', border: `1.5px solid ${selected ? '#002147' : '#e5e7eb'}`, borderRadius: '0.5rem', cursor: 'pointer', backgroundColor: selected ? '#f0f4ff' : 'white' }}>
                    <input type="radio" name="chairRec" checked={selected} onChange={() => setChairRec(rec)}
                      style={{ width: '15px', height: '15px', accentColor: '#002147', cursor: 'pointer' }} />
                    <span style={{ fontSize: '0.875rem', fontWeight: selected ? '600' : '400', color: '#111827' }}>{rec}</span>
                    <span style={{ marginLeft: 'auto', backgroundColor: badge.bg, color: badge.color, padding: '0.15rem 0.55rem', borderRadius: '999px', fontSize: '0.72rem', fontWeight: '600' }}>
                      {rec}
                    </span>
                  </label>
                );
              })}
            </div>

            <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: '600', color: '#374151', marginBottom: '0.4rem' }}>
              Additional Comment for Dean <span style={{ color: '#dc2626' }}>*</span>
            </label>
            <textarea
              value={chairComments}
              onChange={e => setChairComments(e.target.value)}
              placeholder="Add your additional comment for the Dean..."
              rows={3}
              style={{ width: '100%', padding: '0.65rem 0.75rem', border: '1.5px solid #d1d5db', borderRadius: '0.5rem', fontSize: '0.875rem', color: '#111827', fontFamily: 'inherit', resize: 'vertical', outline: 'none', boxSizing: 'border-box', marginBottom: '1.25rem' }}
            />

            {modalError && (
              <p style={{ fontSize: '0.82rem', color: '#dc2626', backgroundColor: '#fef2f2', padding: '0.6rem 0.875rem', borderRadius: '0.5rem', border: '1px solid #fecaca', marginBottom: '1rem' }}>
                {modalError}
              </p>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
              <button onClick={closeModal}
                style={{ padding: '0.65rem 1.25rem', background: 'white', border: '1px solid #d1d5db', borderRadius: '0.5rem', color: '#374151', fontSize: '0.875rem', cursor: 'pointer', fontFamily: 'inherit' }}>
                Cancel
              </button>
              <button disabled={!canSend} onClick={handleSendToDean}
                style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.65rem 1.25rem', backgroundColor: canSend ? '#002147' : '#9ca3af', color: 'white', border: 'none', borderRadius: '0.5rem', fontSize: '0.875rem', fontWeight: '600', cursor: canSend ? 'pointer' : 'not-allowed', fontFamily: 'inherit' }}
                onMouseEnter={e => { if (canSend) e.currentTarget.style.backgroundColor = '#003366'; }}
                onMouseLeave={e => { if (canSend) e.currentTarget.style.backgroundColor = '#002147'; }}>
                {submitting ? 'Sending…' : 'Send to Dean'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Page ── */}
      <h1 style={{ fontSize: '1.6rem', fontWeight: '700', color: '#111827', marginBottom: '0.25rem' }}>
        Candidate Evaluations Overview
      </h1>
      <p style={{ color: '#6b7280', fontSize: '0.9rem', marginBottom: '1.75rem', maxWidth: '820px', lineHeight: 1.55 }}>
        Review committee evaluations for each interview panel and send department recommendations to the Dean. Where one interviewer submitted on behalf of the team, their name appears on each candidate row.
      </p>

      {(() => {
        // Filter committees by their requisition status:
        //  - Under Evaluation, Decision Pending, Completed: always show
        //  - Interviewing: show only if at least one evaluation has been submitted
        const visibleCards = cards.filter(c => {
          const reqStatus = reqStatusById.get(c.requisitionId);
          if (!reqStatus) return false;
          if (reqStatus === 'Under Evaluation' || reqStatus === 'Decision Pending' || reqStatus === 'Completed') return true;
          if (reqStatus === 'Interviewing') {
            return c.candidateRows.some(r => r.evalCount > 0);
          }
          return false;
        });

        if (loading) {
          return <div style={{ textAlign: 'center', padding: '3rem', color: '#6b7280' }}>Loading evaluations…</div>;
        }
        if (visibleCards.length === 0) {
          return (
            <div style={{ textAlign: 'center', padding: '3rem', color: '#9ca3af', backgroundColor: 'white', borderRadius: '0.875rem', boxShadow: '0 1px 3px rgba(0,0,0,0.07)' }}>
              No evaluations available yet. Committees with submitted evaluations will appear here.
            </div>
          );
        }
        return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          {visibleCards.map(card => {
            const isComplete = card.status === 'Completed';
            const justSent   = sentId === card.committeeId;
            const allHaveEvals = card.candidateRows.length > 0 && card.candidateRows.every(r => r.evalCount > 0);
            const pendingCount = card.candidateRows.filter(r => r.evalCount === 0).length;
            const alreadySent = card.sentToDean;
            const disableSend = alreadySent;
            const isExpanded = expandedCommitteeIds.has(card.committeeId);

            return (
              <div key={card.committeeId} style={{ backgroundColor: 'white', borderRadius: '0.875rem', padding: '1.5rem', boxShadow: '0 1px 3px rgba(0,0,0,0.07)' }}>

                {/* Card header */}
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: isExpanded ? '1rem' : 0 }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.2rem' }}>
                      <h3 style={{ fontSize: '1rem', fontWeight: '700', color: '#111827' }}>{card.title}</h3>
                      {!alreadySent && card.status !== 'Scheduled' && <StatusChip status={card.status} />}
                    </div>
                    <p style={{ fontSize: '0.82rem', color: '#6b7280', marginBottom: isExpanded ? '0.15rem' : 0 }}>Department: {card.department}</p>
                    {/* Requisition ID + interviewer chips are details — only
                        rendered when the card is expanded, so the collapsed
                        view stays clean (title / department / status / button). */}
                    {isExpanded && (
                      <>
                        <p style={{ fontSize: '0.75rem', color: '#9ca3af', marginBottom: '0.35rem' }}>
                          {card.requisitionId} · {card.interviewers.length} interviewer{card.interviewers.length !== 1 ? 's' : ''}
                        </p>
                        {card.interviewers.length > 0 && (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
                            {card.interviewers.map(iv => (
                              <span key={iv.id} style={{ fontSize: '0.72rem', color: '#374151', backgroundColor: '#f3f4f6', border: '1px solid #e5e7eb', borderRadius: '999px', padding: '0.15rem 0.6rem', fontWeight: '500' }}>
                                {iv.name}{iv.title ? ` · ${iv.title}` : ''}
                              </span>
                            ))}
                          </div>
                        )}
                      </>
                    )}
                  </div>

                  {/* Action area */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexShrink: 0 }}>
                    <button
                      onClick={() => toggleExpanded(card.committeeId)}
                      style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', padding: '0.45rem 0.75rem', background: 'white', border: '1px solid #d1d5db', borderRadius: '0.45rem', color: '#374151', fontSize: '0.78rem', fontWeight: '600', cursor: 'pointer', fontFamily: 'inherit' }}
                    >
                      {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                      {isExpanded ? 'Hide Details' : 'Show Details'}
                    </button>

                    {alreadySent ? (
                      // chairRecommendation is preserved in `card` for logic /
                      // downstream consumers, but no longer displayed here.
                      <span style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', backgroundColor: '#dcfce7', color: '#15803d', padding: '0.3rem 0.75rem', borderRadius: '999px', fontSize: '0.78rem', fontWeight: '600' }}>
                        <CheckCircle size={13} /> Sent to Dean
                      </span>
                    ) : allHaveEvals ? (
                      <button
                        disabled={disableSend}
                        onClick={() => openModal(card)}
                        style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.6rem 1.1rem', backgroundColor: disableSend ? '#9ca3af' : '#002147', color: 'white', border: 'none', borderRadius: '0.5rem', fontSize: '0.85rem', fontWeight: '600', cursor: disableSend ? 'not-allowed' : 'pointer', fontFamily: 'inherit' }}
                        onMouseEnter={e => { if (!disableSend) e.currentTarget.style.backgroundColor = '#003366'; }}
                        onMouseLeave={e => { if (!disableSend) e.currentTarget.style.backgroundColor = '#002147'; }}
                      >
                        Review & Send to Dean
                      </button>
                    ) : isComplete ? (
                      <button
                        onClick={() => openModal(card)}
                        style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.6rem 1.1rem', backgroundColor: '#002147', color: 'white', border: 'none', borderRadius: '0.5rem', fontSize: '0.85rem', fontWeight: '600', cursor: 'pointer', fontFamily: 'inherit' }}
                        onMouseEnter={e => { e.currentTarget.style.backgroundColor = '#003366'; }}
                        onMouseLeave={e => { e.currentTarget.style.backgroundColor = '#002147'; }}
                      >
                        Review & Send to Dean
                      </button>
                    ) : (
                      <span style={{ fontSize: '0.8rem', color: '#9ca3af', fontStyle: 'italic' }}>
                        Awaiting all evaluations
                      </span>
                    )}
                  </div>
                </div>

                {/* Compact summary — also a "details" element. Only shown
                    when the card is expanded so collapsed view stays clean. */}
                {isExpanded && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
                    <span style={{ backgroundColor: '#f3f4f6', color: '#374151', padding: '0.18rem 0.55rem', borderRadius: '999px', fontSize: '0.72rem', fontWeight: '600' }}>
                      Candidates {card.candidateRows.length}
                    </span>
                    <span style={{ backgroundColor: '#dcfce7', color: '#15803d', padding: '0.18rem 0.55rem', borderRadius: '999px', fontSize: '0.72rem', fontWeight: '600' }}>
                      Evaluated {card.candidateRows.length - pendingCount}
                    </span>
                    {pendingCount > 0 && (
                      <span style={{ backgroundColor: '#fee2e2', color: '#b91c1c', padding: '0.18rem 0.55rem', borderRadius: '999px', fontSize: '0.72rem', fontWeight: '600' }}>
                        Pending {pendingCount}
                      </span>
                    )}
                  </div>
                )}

                {/* Success banner for just-sent recommendation */}
                {justSent && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', backgroundColor: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '0.5rem', padding: '0.75rem 1rem', marginBottom: '1rem' }}>
                    <CheckCircle size={16} color="#16a34a" />
                    <div>
                      <p style={{ fontSize: '0.85rem', fontWeight: '600', color: '#15803d' }}>Recommendation sent to Dean</p>
                      <p style={{ fontSize: '0.78rem', color: '#16a34a' }}>Requisition status updated to Decision Pending.</p>
                    </div>
                  </div>
                )}

                {/* Candidate evaluation rows — laid out as a 4-column grid so
                    every row aligns like a real table:
                       Candidate (1fr) · Score (120px) · Status (160px) · Recommendation (160px) */}
                {isExpanded && card.candidateRows.length > 0 && (
                  <div style={{ borderTop: '1px solid #f3f4f6', paddingTop: '1rem' }}>
                    <p style={{ fontSize: '0.75rem', fontWeight: '600', color: '#6b7280', marginBottom: '0.5rem' }}>
                      CANDIDATE EVALUATIONS ({card.candidateRows.length})
                    </p>
                    <p style={{ fontSize: '0.74rem', color: '#475569', marginBottom: '0.85rem', lineHeight: 1.5 }}>
                      These entries reflect the interview committee’s discussion. Typically <strong style={{ color: '#334155' }}>one interviewer</strong> submits the form on behalf of the full panel. The Chair sees who recorded each submission below.
                    </p>

                    {/* Header row — same column template as the data rows
                        below so the labels align perfectly with their
                        columns. The Candidate label is offset by avatar
                        width + gap so it sits over the candidate name. */}
                    <div style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr 120px 160px 160px',
                      gap: '1rem',
                      alignItems: 'center',
                      padding: '0 1rem',
                      marginBottom: '0.4rem',
                      fontSize: '0.68rem',
                      fontWeight: '600',
                      color: '#9ca3af',
                      textTransform: 'uppercase',
                      letterSpacing: '0.04em',
                    }}>
                      <div style={{ paddingLeft: 'calc(36px + 1rem)' }}>Candidate</div>
                      <div style={{ textAlign: 'center' }}>Score</div>
                      <div style={{ textAlign: 'center' }}>Status</div>
                      <div style={{ textAlign: 'center' }}>Recommendation</div>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                      {card.candidateRows.map(row => {
                        const majorRec = row.recommendations.length > 0
                          ? (() => {
                              const counts = row.recommendations.reduce<Record<string, number>>((acc, r) => {
                                acc[r] = (acc[r] ?? 0) + 1; return acc;
                              }, {});
                              return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
                            })()
                          : 'Pending';
                        const recBadge = INTERVIEWER_REC_BADGE[majorRec] ?? INTERVIEWER_REC_BADGE['Pending'];
                        const finalDecision = alreadySent
                          ? normalizeFinalDecision(finalDecisionByCandidateId[row.candidateId])
                          : 'Pending Decision';
                        const fdBadge = FINAL_BADGE[finalDecision] ?? FINAL_BADGE['Pending Decision'];
                        const commentsPreview = row.comments.slice(0, 2).join(' | ');
                        const extraCommentsCount = Math.max(0, row.comments.length - 2);

                        return (
                          <div key={row.candidateId} style={{ backgroundColor: '#fafafa', border: '1px solid #f3f4f6', borderRadius: '0.625rem', overflow: 'hidden' }}>
                            <div style={{
                              display: 'grid',
                              gridTemplateColumns: '1fr 120px 160px 160px',
                              gap: '1rem',
                              alignItems: 'center',
                              padding: '0.75rem 1rem',
                            }}>
                              {/* Column 1 — Candidate (avatar + name + role + comment preview) */}
                              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', minWidth: 0 }}>
                                <div style={{ width: '36px', height: '36px', borderRadius: '50%', border: '1.5px solid #d1d5db', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                                  <UserCircle size={22} color="#9ca3af" />
                                </div>
                                <div style={{ minWidth: 0, flex: 1 }}>
                                  <p style={{ fontSize: '0.875rem', fontWeight: '600', color: '#111827' }}>{row.name}</p>
                                  <p style={{ fontSize: '0.78rem', color: '#6b7280' }}>{row.position}</p>
                                  {row.committeeLoggedBy && (
                                    <p style={{ fontSize: '0.72rem', color: '#1d4ed8', marginTop: '0.28rem', fontWeight: '600', lineHeight: 1.35 }}>
                                      Committee evaluation · logged by {row.committeeLoggedBy} on behalf of the interview panel
                                    </p>
                                  )}
                                  {row.comments.length > 0 && (
                                    <p style={{ fontSize: '0.74rem', color: '#78350f', marginTop: '0.2rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                      Comment: {commentsPreview}{extraCommentsCount > 0 ? ` (+${extraCommentsCount} more)` : ''}
                                    </p>
                                  )}
                                </div>
                              </div>

                              {/* Column 2 — Score */}
                              <div style={{ textAlign: 'center', fontSize: '0.95rem', fontWeight: '700', color: '#111827' }}>
                                {row.avgRating !== null ? `${row.avgRating}/4` : '—'}
                              </div>

                              {/* Column 3 — Status (final decision pill).
                                  finalDecision already resolves to
                                  'Pending Decision' when the committee
                                  hasn't been sent to Dean yet, so the
                                  column never has an empty cell. */}
                              <div style={{ textAlign: 'center' }}>
                                <span style={{ display: 'inline-block', backgroundColor: fdBadge.bg, color: fdBadge.color, padding: '0.2rem 0.65rem', borderRadius: '999px', fontSize: '0.75rem', fontWeight: '700' }}>
                                  {finalDecision}
                                </span>
                              </div>

                              {/* Column 4 — Recommendation (interviewer majority) */}
                              <div style={{ textAlign: 'center' }}>
                                <span style={{ display: 'inline-block', backgroundColor: recBadge.bg, color: recBadge.color, padding: '0.2rem 0.65rem', borderRadius: '999px', fontSize: '0.75rem', fontWeight: '600' }}>
                                  {majorRec}
                                </span>
                              </div>
                            </div>
                            {/* AI Analysis is only mounted while this committee
                                is still pending submission to the Dean. Once
                                `sentToDean` flips true, no AI UI is rendered
                                — no card, no button, no placeholder, no empty
                                container. The Firestore data is preserved. */}
                            {!alreadySent && (
                              <div style={{ padding: '0 0.75rem 0.75rem' }}>
                                <AIAnalysisCard candidateId={row.candidateId} stage="chair" candidateName={row.name} />
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {isExpanded && card.candidateRows.length === 0 && (
                  <p style={{ fontSize: '0.85rem', color: '#9ca3af', paddingTop: '1rem', borderTop: '1px solid #f3f4f6' }}>
                    No evaluations submitted yet for this committee.
                  </p>
                )}
              </div>
            );
          })}
        </div>
        );
      })()}
    </ChairLayout>
  );
}
