import { useEffect, useMemo, useState } from 'react';
import { UserCircle, CalendarDays, Clock, Video, CheckCircle } from 'lucide-react';
import { InterviewerLayout } from '../components/InterviewerLayout';
import { AIAnalysisCard } from '../components/AIAnalysisCard';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { collection, getDocs, query, where, writeBatch, serverTimestamp, doc, getDoc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { workflowStageFromStatus } from '../utils/requisitionWorkflow';
import { getSession } from '../utils/session';
import { getRequisitionPositionTitle } from '../utils/requisitionFields';
import { isAwaitingChairScheduleApproval } from '../utils/committeeScheduleApproval';

const CRITERIA = [
  'Teaching Ability',
  'Research Quality',
  'Communication Skills',
  'Domain Expertise',
  'Collaboration & Teamwork',
];
const SCALE = ['Strongly Disagree', 'Disagree', 'Neutral', 'Agree', 'Strongly Agree'];
const RECOMMENDATIONS = ['Highly Recommend', 'Recommend', 'Neutral', 'Do Not Recommend'];

interface EvalContext {
  committeeId: string;
  candidateId: string;
  interviewerId: string;
  candidateName: string;
  candidateEdu: string;
  candidateExp: string;
  candidatePosition: string;
  deanNote: string;
  requisitionId: string;
  requisitionTitle: string;
  requisitionDept: string;
  scheduledDate: string;
  scheduledTime: string;
  duration: string;
  meetingLink: string;
  totalInterviewers: number;
  totalCandidates: number;
}

interface PendingAssignment {
  committeeId: string;
  candidateId: string;
  candidateName: string;
  candidatePosition: string;
  title: string;
  requisitionId: string;
  scheduledDate: string;
  scheduledTime: string;
}

function formatDate(iso: string): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

export default function InterviewerEvaluationForm() {
  const navigate      = useNavigate();
  const [searchParams] = useSearchParams();
  const committeeId   = searchParams.get('committeeId') ?? '';
  const candidateId   = searchParams.get('candidateId') ?? '';

  const [ctx, setCtx]               = useState<EvalContext | null>(null);
  const [loading, setLoading]       = useState(true);
  const [ratings, setRatings]       = useState<Record<string, number>>({});
  const [comments, setComments]     = useState('');
  const [recommendation, setRecommendation] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted]   = useState(false);
  const [alreadySubmitted, setAlreadySubmitted] = useState(false);
  const [lockedByCommitteeRepresentative, setLockedByCommitteeRepresentative] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [scheduleBlockedMessage, setScheduleBlockedMessage] = useState<string | null>(null);
  const [pendingAssignments, setPendingAssignments] = useState<PendingAssignment[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [showAllPending, setShowAllPending] = useState(false);

  useEffect(() => {
    if (!committeeId || !candidateId) return;

    (async () => {
      try {
        setAlreadySubmitted(false);
        setLockedByCommitteeRepresentative(false);
        setScheduleBlockedMessage(null);
        const [committeeSnap, candidateSnap] = await Promise.all([
          getDoc(doc(db, 'committees',  committeeId)),
          getDoc(doc(db, 'candidates', candidateId)),
        ]);

        if (!committeeSnap.exists() || !candidateSnap.exists()) {
          setLoading(false);
          return;
        }

        const c = committeeSnap.data();
        const committeeStatus = (c.status as string) ?? '';

        if (isAwaitingChairScheduleApproval(committeeStatus)) {
          setScheduleBlockedMessage(
            'This slot is still Pending Chair Schedule Approval. Interviewers can evaluate only after the Department Chair confirms HR\'s proposed time.',
          );
          setLoading(false);
          return;
        }
        if (committeeStatus !== 'Scheduled') {
          setScheduleBlockedMessage('This committee interview is not scheduled yet.');
          setLoading(false);
          return;
        }

        const k = candidateSnap.data()!;

        const sessionEmail  = (getSession()?.email ?? sessionStorage.getItem('pmu_user_email') ?? '').trim();
        const norm = (v: string) => v.trim().toLowerCase();
        const interviewers  = (c.interviewers  as { id: string; email: string }[]) ?? [];
        const candidates    = (c.candidates    as { id: string }[])                ?? [];
        const matchedIv     = interviewers.find(iv => norm(iv.email ?? '') === norm(sessionEmail));
        const interviewerId = matchedIv?.id ?? sessionEmail ?? 'unknown';

        const existingSnap = await getDocs(
          query(
            collection(db, 'evaluations'),
            where('committeeId', '==', committeeId),
            where('candidateId', '==', candidateId)
          )
        );

        let submittedBySelf = false;
        for (const ed of existingSnap.docs) {
          const evInterviewerId = norm((ed.data().interviewerId as string) ?? '');
          const evEmail = norm((ed.data().interviewerEmail as string) ?? '');
          if (
            evInterviewerId === norm(interviewerId) ||
            (!!sessionEmail && evInterviewerId === norm(sessionEmail)) ||
            (!!sessionEmail && evEmail === norm(sessionEmail))
          ) {
            submittedBySelf = true;
            break;
          }
        }

        const committeeHasEval = existingSnap.docs.length > 0;
        setAlreadySubmitted(submittedBySelf);
        setLockedByCommitteeRepresentative(committeeHasEval && !submittedBySelf);

        setCtx({
          committeeId,
          candidateId,
          interviewerId,
          candidateName:     (k.full_name        as string) ?? '-',
          candidateEdu:      (k.degree           as string) ?? '-',
          candidateExp:      k.years_experience != null ? String(k.years_experience) + ' years' : '-',
          candidatePosition: (k.position_applied as string) ?? '-',
          deanNote:          (k.deanNote         as string) ?? '',
          requisitionId:     (c.requisitionId    as string) ?? '-',
          requisitionTitle:  getRequisitionPositionTitle(c as Record<string, unknown>),
          requisitionDept:   (c.department       as string) ?? '-',
          scheduledDate:     (c.scheduledDate    as string) ?? '',
          scheduledTime:     (c.scheduledTime    as string) ?? '',
          duration:          (c.duration         as string) ?? '',
          meetingLink:       (c.meetingLink      as string) ?? '',
          totalInterviewers: interviewers.length,
          totalCandidates:   candidates.length,
        });
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    })();
  }, [committeeId, candidateId]);

  useEffect(() => {
    if (committeeId && candidateId) return;

    let mounted = true;
    (async () => {
      try {
        const sessionEmail = (getSession()?.email ?? sessionStorage.getItem('pmu_user_email') ?? '').trim();
        const norm = (v: string) => v.trim().toLowerCase();
        const me = norm(sessionEmail);

        const [committeeSnap, evalSnap] = await Promise.all([
          getDocs(collection(db, 'committees')),
          getDocs(collection(db, 'evaluations')),
        ]);

        const committees = committeeSnap.docs.map(d => {
          const data = d.data() as Record<string, unknown>;
          return {
            id: d.id,
            title: getRequisitionPositionTitle(data),
            requisitionId: (data.requisitionId as string) ?? '',
            status: (data.status as string) ?? '',
            scheduledDate: (data.scheduledDate as string) ?? '',
            scheduledTime: (data.scheduledTime as string) ?? '',
            interviewers: (data.interviewers as Array<{ id: string; email: string }>) ?? [],
            candidates: (data.candidates as Array<{ id: string; name: string; position?: string }>) ?? [],
          };
        });

        const emailMatched = me
          ? committees.filter(c => c.interviewers.some(iv => norm(iv.email ?? '') === me))
          : [];
        const myCommittees = emailMatched.length > 0 ? emailMatched : committees;
        const scheduledCommittees = myCommittees.filter(c => c.status === 'Scheduled' && c.scheduledDate);

        // One committee evaluation per candidate: any submission counts as complete.
        const submittedKeys = new Set<string>();
        evalSnap.docs.forEach(d => {
          const data = d.data() as Record<string, unknown>;
          const cmId = (data.committeeId as string) ?? '';
          const candId = (data.candidateId as string) ?? '';
          if (!cmId || !candId) return;
          submittedKeys.add(`${cmId}::${candId}`);
        });

        const pending: PendingAssignment[] = [];
        scheduledCommittees.forEach(c => {
          c.candidates.forEach(cand => {
            if (!submittedKeys.has(`${c.id}::${cand.id}`)) {
              pending.push({
                committeeId: c.id,
                candidateId: cand.id,
                candidateName: cand.name ?? '-',
                candidatePosition: cand.position ?? '',
                title: c.title,
                requisitionId: c.requisitionId ?? '',
                scheduledDate: c.scheduledDate ?? '',
                scheduledTime: c.scheduledTime ?? '',
              });
            }
          });
        });

        if (mounted) setPendingAssignments(pending);
      } catch (e) {
        console.error(e);
      } finally {
        if (mounted) setLoading(false);
      }
    })();

    return () => { mounted = false; };
  }, [committeeId, candidateId]);

  const filteredPendingAssignments = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    if (!q) return pendingAssignments;
    return pendingAssignments.filter(p =>
      p.candidateName.toLowerCase().includes(q) ||
      p.candidatePosition.toLowerCase().includes(q) ||
      p.title.toLowerCase().includes(q) ||
      p.requisitionId.toLowerCase().includes(q)
    );
  }, [pendingAssignments, searchTerm]);

  const pendingPreview = showAllPending
    ? filteredPendingAssignments
    : filteredPendingAssignments.slice(0, 8);

  const allRated  = CRITERIA.every(c => ratings[c] !== undefined);
  const canSubmit =
    allRated &&
    !!recommendation &&
    !submitting &&
    !alreadySubmitted &&
    !lockedByCommitteeRepresentative;

  const handleSubmit = async () => {
    if (!canSubmit || !ctx) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const cmSnap = await getDoc(doc(db, 'committees', ctx.committeeId));
      const stNow = (cmSnap.data()?.status as string) ?? '';
      if (stNow !== 'Scheduled') {
        setSubmitError('Evaluations open only after the Department Chair has confirmed the interview schedule.');
        setSubmitting(false);
        return;
      }

      const dupSnap = await getDocs(
        query(
          collection(db, 'evaluations'),
          where('committeeId', '==', ctx.committeeId),
          where('candidateId', '==', ctx.candidateId)
        )
      );
      if (!dupSnap.empty) {
        setSubmitError('Evaluation already submitted after committee discussion.');
        setSubmitting(false);
        setLockedByCommitteeRepresentative(true);
        return;
      }

      const batch = writeBatch(db);

      const session = getSession();
      const submitterEmail = (session?.email ?? sessionStorage.getItem('pmu_user_email') ?? '').trim();
      const submitterDisplayName = (session?.fullName ?? '').trim();

      // 1. Save evaluation document
      const evalRef = doc(collection(db, 'evaluations'));
      batch.set(evalRef, {
        committeeId:       ctx.committeeId,
        candidateId:       ctx.candidateId,
        interviewerId:     ctx.interviewerId,
        interviewerEmail:  submitterEmail,
        candidateName:     ctx.candidateName,
        candidatePosition: ctx.candidatePosition,
        requisitionId:     ctx.requisitionId,
        ratings,
        comments,
        recommendation,
        submittedAt:       serverTimestamp(),
        submittedOnBehalfOfCommittee: true,
        submitterDisplayName,
      });

      // 2. Update candidate status to "Interviewed"
      batch.update(doc(db, 'candidates', ctx.candidateId), { status: 'Interviewed' });

      await batch.commit();

      // Committee is complete once every assigned candidate has at least one evaluation (any member).
      const postSnap = await getDocs(
        query(collection(db, 'evaluations'), where('committeeId', '==', ctx.committeeId))
      );
      const distinctCandidates = new Set<string>();
      postSnap.docs.forEach(d => {
        const id = (d.data().candidateId as string) ?? '';
        if (id) distinctCandidates.add(id);
      });

      if (distinctCandidates.size >= ctx.totalCandidates) {
        await updateDoc(doc(db, 'committees', ctx.committeeId), { status: 'Completed' });
        // Best-effort: mark the interview session as completed too. If the doc doesn't exist
        // (e.g. interview was created before this feature), updateDoc throws — safely ignore.
        try {
          await updateDoc(doc(db, 'interviews', ctx.committeeId), { status: 'Completed' });
        } catch { /* interview record optional */ }

        if (ctx.requisitionId) {
          const st = 'Under Evaluation';
          await updateDoc(doc(db, 'requisitions', ctx.requisitionId), {
            status: st,
            workflowStage: workflowStageFromStatus(st),
          });
        }
      }

      setSubmitted(true);
    } catch (e) {
      console.error(e);
      setSubmitError('Failed to submit evaluation. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  // ── Success (committee representative submission) ─────────────────────────
  if (submitted && ctx) {
    return (
      <InterviewerLayout>
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(15,23,42,0.48)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: '1.25rem',
          }}
        >
          <div
            role="dialog"
            aria-labelledby="committee-submit-success-title"
            style={{
              width: '100%',
              maxWidth: '400px',
              backgroundColor: 'white',
              borderRadius: '1rem',
              boxShadow: '0 24px 48px rgba(15,23,42,0.18)',
              border: '1px solid #e2e8f0',
              padding: '1.5rem',
              textAlign: 'center',
            }}
          >
            <div style={{ width: '48px', height: '48px', borderRadius: '50%', backgroundColor: '#dcfce7', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1rem' }}>
              <CheckCircle size={24} color="#15803d" strokeWidth={2.25} />
            </div>
            <p id="committee-submit-success-title" style={{ fontSize: '0.95rem', fontWeight: '600', color: '#111827', margin: '0 0 1.25rem 0', lineHeight: 1.5 }}>
              Evaluation submitted on behalf of the committee. Status updated.
            </p>
            <button
              type="button"
              onClick={() => navigate('/interviewer/dashboard')}
              style={{ width: '100%', padding: '0.65rem 1rem', backgroundColor: '#002147', color: 'white', border: 'none', borderRadius: '0.5rem', fontSize: '0.9rem', fontWeight: '600', cursor: 'pointer', fontFamily: 'inherit' }}
            >
              OK
            </button>
          </div>
        </div>
      </InterviewerLayout>
    );
  }

  // ── Another committee member already submitted for this candidate ─────────
  if (!loading && lockedByCommitteeRepresentative && ctx) {
    return (
      <InterviewerLayout>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '60vh', textAlign: 'center' }}>
          <div style={{ width: '64px', height: '64px', borderRadius: '50%', backgroundColor: '#eff6ff', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1.25rem' }}>
            <CheckCircle size={30} color="#1d4ed8" />
          </div>
          <h2 style={{ fontSize: '1.4rem', fontWeight: '700', color: '#111827', marginBottom: '0.75rem', maxWidth: '520px', lineHeight: 1.35 }}>
            Committee evaluation already recorded
          </h2>
          <p style={{ fontSize: '0.92rem', color: '#64748b', marginBottom: '1.5rem', maxWidth: '460px', lineHeight: 1.55 }}>
            Another panel member already submitted the evaluation for <strong>{ctx.candidateName}</strong> <strong>on behalf of your committee</strong> after your discussion. No further evaluator form is needed for this candidate.
          </p>
          <button
            onClick={() => navigate('/interviewer/my-committee')}
            style={{ padding: '0.7rem 1.5rem', backgroundColor: '#002147', color: 'white', border: 'none', borderRadius: '0.5rem', fontSize: '0.9rem', fontWeight: '600', cursor: 'pointer', fontFamily: 'inherit' }}
          >
            Back to My Committee
          </button>
        </div>
      </InterviewerLayout>
    );
  }

  // ── Already submitted guard ───────────────────────────────────────────────
  if (!loading && alreadySubmitted && ctx) {
    return (
      <InterviewerLayout>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '60vh', textAlign: 'center' }}>
          <div style={{ width: '64px', height: '64px', borderRadius: '50%', backgroundColor: '#f0fdf4', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1.25rem' }}>
            <CheckCircle size={30} color="#16a34a" />
          </div>
          <h2 style={{ fontSize: '1.4rem', fontWeight: '700', color: '#111827', marginBottom: '0.4rem' }}>Already submitted for your committee</h2>
          <p style={{ fontSize: '0.9rem', color: '#6b7280', marginBottom: '1.5rem', maxWidth: '440px', lineHeight: 1.55 }}>
            You already entered the committee evaluation for <strong>{ctx.candidateName}</strong> <strong>on behalf of the interview panel</strong>.
          </p>
          <button
            onClick={() => navigate('/interviewer/my-committee')}
            style={{ padding: '0.7rem 1.5rem', backgroundColor: '#002147', color: 'white', border: 'none', borderRadius: '0.5rem', fontSize: '0.9rem', fontWeight: '600', cursor: 'pointer', fontFamily: 'inherit' }}
          >
            Back to My Committee
          </button>
        </div>
      </InterviewerLayout>
    );
  }

  // ── Loading ───────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <InterviewerLayout>
        <div style={{ textAlign: 'center', padding: '4rem', color: '#6b7280' }}>Loading evaluation context…</div>
      </InterviewerLayout>
    );
  }

  // ── Schedule not confirmed (Chair must approve HR proposal) ────────────────
  if (!loading && committeeId && candidateId && scheduleBlockedMessage) {
    return (
      <InterviewerLayout>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '60vh', textAlign: 'center', padding: '1rem' }}>
          <Clock size={36} color="#c2410c" style={{ marginBottom: '1rem' }} />
          <h2 style={{ fontSize: '1.25rem', fontWeight: '700', color: '#111827', marginBottom: '0.75rem', maxWidth: '480px', lineHeight: 1.4 }}>Interview not available yet</h2>
          <p style={{ fontSize: '0.9rem', color: '#6b7280', marginBottom: '1.5rem', maxWidth: '440px', lineHeight: 1.55 }}>{scheduleBlockedMessage}</p>
          <button
            type="button"
            onClick={() => navigate('/interviewer/dashboard')}
            style={{ padding: '0.7rem 1.5rem', backgroundColor: '#002147', color: 'white', border: 'none', borderRadius: '0.5rem', fontSize: '0.9rem', fontWeight: '600', cursor: 'pointer', fontFamily: 'inherit' }}
          >
            Back to Dashboard
          </button>
        </div>
      </InterviewerLayout>
    );
  }

  // ── Empty state ───────────────────────────────────────────────────────────
  if (!committeeId || !candidateId || !ctx) {
    return (
      <InterviewerLayout>
        <div style={{ maxWidth: '860px', margin: '0 auto' }}>
          {pendingAssignments.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div style={{ marginBottom: '0.2rem' }}>
                <h1 style={{ fontSize: '1.35rem', fontWeight: '700', color: '#111827', marginBottom: '0.25rem' }}>
                  Select a Candidate to Evaluate
                </h1>
                <p style={{ fontSize: '0.88rem', color: '#6b7280', marginBottom: '0.35rem' }}>
                  You have {pendingAssignments.length} pending evaluation{pendingAssignments.length !== 1 ? 's' : ''}.
                </p>
                <p style={{ fontSize: '0.76rem', color: '#94a3b8', lineHeight: 1.45 }}>
                  Committee interview panels discuss each candidate together. One designated member submits the evaluation on behalf of the full committee—the Chair sees who logged each submission.
                </p>
              </div>

              <input
                value={searchTerm}
                onChange={e => { setSearchTerm(e.target.value); setShowAllPending(false); }}
                placeholder="Search candidate..."
                style={{
                  width: '100%',
                  padding: '0.68rem 0.85rem',
                  border: '1px solid #d1d5db',
                  borderRadius: '0.65rem',
                  fontSize: '0.86rem',
                  color: '#111827',
                  outline: 'none',
                  fontFamily: 'inherit',
                  boxSizing: 'border-box',
                }}
              />

              {filteredPendingAssignments.length === 0 ? (
                <div style={{ backgroundColor: 'white', border: '1px solid #f3f4f6', borderRadius: '0.75rem', padding: '1.25rem', fontSize: '0.88rem', color: '#6b7280' }}>
                  No pending evaluations match your search.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  {pendingPreview.map(p => (
                    <div
                      key={`${p.committeeId}::${p.candidateId}`}
                      style={{
                        backgroundColor: 'white',
                        border: '1px solid #f3f4f6',
                        borderRadius: '0.75rem',
                        padding: '0.95rem 1rem',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: '0.8rem',
                        boxShadow: '0 1px 2px rgba(15,23,42,0.04)',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', minWidth: 0 }}>
                        <div style={{ width: '40px', height: '40px', borderRadius: '999px', border: '1.5px solid #cbd5e1', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                          <UserCircle size={24} color="#64748b" />
                        </div>
                        <div style={{ minWidth: 0 }}>
                          <p style={{ fontSize: '0.92rem', fontWeight: '700', color: '#111827', marginBottom: '0.15rem' }}>{p.candidateName}</p>
                          <p style={{ fontSize: '0.8rem', color: '#6b7280', marginBottom: '0.08rem' }}>{p.candidatePosition || 'Position not specified'}</p>
                          <p style={{ fontSize: '0.76rem', color: '#94a3b8' }}>
                            {p.requisitionId ? `${p.requisitionId} · ` : ''}{p.title}
                          </p>
                          {(p.scheduledDate || p.scheduledTime) && (
                            <p style={{ fontSize: '0.74rem', color: '#64748b', marginTop: '0.1rem' }}>
                              Interview: {formatDate(p.scheduledDate)} {p.scheduledTime}
                            </p>
                          )}
                        </div>
                      </div>
                      <button
                        onClick={() => navigate(`/interviewer/evaluation-form?committeeId=${p.committeeId}&candidateId=${p.candidateId}`)}
                        style={{
                          backgroundColor: '#0f172a',
                          color: 'white',
                          padding: '0.4rem 0.85rem',
                          borderRadius: '0.5rem',
                          border: 'none',
                          fontSize: '0.82rem',
                          fontWeight: '600',
                          cursor: 'pointer',
                          fontFamily: 'inherit',
                          whiteSpace: 'nowrap',
                        }}
                        onMouseEnter={e => { e.currentTarget.style.backgroundColor = '#1e293b'; }}
                        onMouseLeave={e => { e.currentTarget.style.backgroundColor = '#0f172a'; }}
                      >
                        Evaluate
                      </button>
                    </div>
                  ))}

                  {filteredPendingAssignments.length > 8 && (
                    <button
                      onClick={() => setShowAllPending(prev => !prev)}
                      style={{ alignSelf: 'flex-start', border: 'none', background: 'none', color: '#2563eb', fontSize: '0.84rem', fontWeight: '600', cursor: 'pointer', fontFamily: 'inherit' }}
                    >
                      {showAllPending ? 'Show Less' : 'View All →'}
                    </button>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div style={{ textAlign: 'center', padding: '3.25rem 1.5rem', backgroundColor: 'white', borderRadius: '0.875rem', boxShadow: '0 1px 3px rgba(0,0,0,0.07)' }}>
              <p style={{ fontSize: '1rem', fontWeight: '600', color: '#111827', marginBottom: '0.5rem' }}>
                No pending evaluations.
              </p>
              <p style={{ fontSize: '0.875rem', color: '#6b7280', marginBottom: '1.35rem' }}>
                You can return to My Committee for more context.
              </p>
              <button
                onClick={() => navigate('/interviewer/my-committee')}
                style={{ padding: '0.6rem 1.25rem', backgroundColor: '#002147', color: 'white', border: 'none', borderRadius: '0.5rem', fontSize: '0.875rem', fontWeight: '600', cursor: 'pointer', fontFamily: 'inherit' }}
              >
                Go to My Committee
              </button>
            </div>
          )}
        </div>
      </InterviewerLayout>
    );
  }

  // ── Form ──────────────────────────────────────────────────────────────────
  return (
    <InterviewerLayout>
      <div style={{ backgroundColor: 'white', borderRadius: '0.875rem', padding: '2rem', boxShadow: '0 1px 3px rgba(0,0,0,0.07)' }}>

        {/* Header */}
        <h1 style={{ fontSize: '1.4rem', fontWeight: '700', color: '#111827', marginBottom: '0.25rem' }}>
          Interview Evaluation Form
        </h1>
        <p style={{ fontSize: '0.85rem', color: '#6b7280', marginBottom: '0.5rem' }}>
          {ctx.requisitionId} · {ctx.requisitionTitle} · {ctx.requisitionDept}
        </p>
        <p style={{ fontSize: '0.78rem', color: '#64748b', marginBottom: '1.5rem', lineHeight: 1.45 }}>
          Committee interview panels discuss each candidate together. One designated member submits the evaluation on behalf of the full committee—the Chair sees who logged each submission.
        </p>

        {/* Interview schedule info */}
        {ctx.scheduledDate && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem', flexWrap: 'wrap', backgroundColor: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '0.625rem', padding: '0.875rem 1rem', marginBottom: '1.5rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <CalendarDays size={14} color="#1d4ed8" />
              <span style={{ fontSize: '0.85rem', fontWeight: '600', color: '#1d4ed8' }}>{formatDate(ctx.scheduledDate)}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <Clock size={14} color="#1d4ed8" />
              <span style={{ fontSize: '0.85rem', fontWeight: '600', color: '#1d4ed8' }}>{ctx.scheduledTime}</span>
            </div>
            {ctx.duration && (
              <span style={{ fontSize: '0.82rem', color: '#374151' }}>{ctx.duration} min</span>
            )}
            {ctx.meetingLink && (
              <a href={ctx.meetingLink} target="_blank" rel="noreferrer"
                style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', marginLeft: 'auto', padding: '0.35rem 0.875rem', backgroundColor: '#002147', color: 'white', borderRadius: '0.4rem', fontSize: '0.8rem', fontWeight: '600', textDecoration: 'none' }}>
                <Video size={13} /> Join Meeting
              </a>
            )}
          </div>
        )}

        {/* Candidate card */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '1rem', padding: '1.1rem 1.25rem', backgroundColor: '#f8fafc', border: '1px solid #e5e7eb', borderRadius: '0.75rem', marginBottom: '1.75rem' }}>
          <div style={{ width: '52px', height: '52px', borderRadius: '50%', border: '2px solid #002147', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <UserCircle size={32} color="#002147" />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ fontSize: '1rem', fontWeight: '700', color: '#111827', marginBottom: '0.15rem' }}>{ctx.candidateName}</p>
            <p style={{ fontSize: '0.85rem', color: '#6b7280', marginBottom: '0.1rem' }}>{ctx.candidatePosition}</p>
            <p style={{ fontSize: '0.8rem', color: '#9ca3af' }}>{ctx.candidateEdu} · {ctx.candidateExp}</p>
            {ctx.deanNote && (
              <div style={{ backgroundColor: '#fefce8', border: '1px solid #fde68a', borderRadius: '0.4rem', padding: '0.45rem 0.65rem', marginTop: '0.6rem' }}>
                <p style={{ fontSize: '0.72rem', fontWeight: '600', color: '#92400e', marginBottom: '0.1rem' }}>Dean's Note</p>
                <p style={{ fontSize: '0.78rem', color: '#78350f' }}>{ctx.deanNote}</p>
              </div>
            )}
          </div>
        </div>

        <AIAnalysisCard
          candidateId={ctx.candidateId}
          stage="interviewer"
          candidateName={ctx.candidateName}
        />

        {/* Criteria table */}
        <h2 style={{ fontSize: '1rem', fontWeight: '700', color: '#111827', marginBottom: '1rem' }}>Evaluation Criteria</h2>
        <div style={{ overflowX: 'auto', marginBottom: '2rem' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '560px' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
                <th style={{ textAlign: 'left', padding: '0.75rem 1rem', fontSize: '0.85rem', fontWeight: '600', color: '#111827', width: '28%' }}>Criteria</th>
                {SCALE.map(s => (
                  <th key={s} style={{ textAlign: 'center', padding: '0.75rem 0.5rem', fontSize: '0.78rem', fontWeight: '500', color: '#374151' }}>{s}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {CRITERIA.map((criterion, ci) => (
                <tr key={criterion} style={{ borderBottom: '1px solid #f3f4f6', backgroundColor: ratings[criterion] !== undefined ? '#fafafa' : 'white' }}>
                  <td style={{ padding: '0.9rem 1rem', fontSize: '0.875rem', color: '#374151' }}>{criterion}</td>
                  {SCALE.map((_, si) => (
                    <td key={si} style={{ textAlign: 'center', padding: '0.9rem 0.5rem' }}>
                      <input
                        type="radio"
                        name={`criteria-${ci}`}
                        checked={ratings[criterion] === si}
                        onChange={() => setRatings(prev => ({ ...prev, [criterion]: si }))}
                        style={{ width: '16px', height: '16px', accentColor: '#002147', cursor: 'pointer' }}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Comments */}
        <h2 style={{ fontSize: '1rem', fontWeight: '700', color: '#111827', marginBottom: '0.6rem' }}>Additional Comments</h2>
        <textarea
          value={comments}
          onChange={e => setComments(e.target.value)}
          placeholder="Provide any additional observations or feedback…"
          style={{ width: '100%', minHeight: '120px', padding: '0.875rem 1rem', border: '1px solid #d1d5db', borderRadius: '0.5rem', fontSize: '0.875rem', color: '#374151', outline: 'none', fontFamily: 'inherit', resize: 'vertical', boxSizing: 'border-box', marginBottom: '1.75rem' }}
        />

        {/* Recommendation */}
        <h2 style={{ fontSize: '1rem', fontWeight: '700', color: '#111827', marginBottom: '0.75rem' }}>Overall Recommendation</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', marginBottom: '2rem' }}>
          {RECOMMENDATIONS.map(rec => (
            <label key={rec} style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', cursor: 'pointer', padding: '0.5rem 0.75rem', borderRadius: '0.5rem', border: `1.5px solid ${recommendation === rec ? '#002147' : '#e5e7eb'}`, backgroundColor: recommendation === rec ? '#f0f4ff' : 'white' }}>
              <input
                type="radio"
                name="recommendation"
                checked={recommendation === rec}
                onChange={() => setRecommendation(rec)}
                style={{ width: '15px', height: '15px', accentColor: '#002147', cursor: 'pointer' }}
              />
              <span style={{ fontSize: '0.875rem', color: '#374151', fontWeight: recommendation === rec ? '600' : '400' }}>{rec}</span>
            </label>
          ))}
        </div>

        {!allRated && (
          <p style={{ fontSize: '0.82rem', color: '#92400e', backgroundColor: '#fef9c3', padding: '0.6rem 0.875rem', borderRadius: '0.5rem', marginBottom: '1rem', border: '1px solid #fde68a' }}>
            Please rate all criteria before submitting.
          </p>
        )}

        {submitError && (
          <p style={{ fontSize: '0.82rem', color: '#dc2626', backgroundColor: '#fef2f2', padding: '0.6rem 0.875rem', borderRadius: '0.5rem', marginBottom: '1rem', border: '1px solid #fecaca' }}>
            {submitError}
          </p>
        )}

        <p style={{ fontSize: '0.76rem', color: '#475569', marginBottom: '1rem', lineHeight: 1.5 }}>
          By submitting, you confirm this evaluation reflects your committee’s discussion and will be recorded as the panel’s submission for <strong style={{ color: '#111827' }}>{ctx.candidateName}</strong> (logged under your account for the Chair).
        </p>

        {/* Actions */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.875rem' }}>
          <button
            onClick={() => navigate('/interviewer/my-committee')}
            style={{ padding: '0.65rem 1.5rem', background: 'white', border: '1px solid #d1d5db', borderRadius: '0.5rem', color: '#374151', fontSize: '0.9rem', cursor: 'pointer', fontFamily: 'inherit' }}
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            style={{ padding: '0.65rem 1.75rem', backgroundColor: canSubmit ? '#002147' : '#9ca3af', color: 'white', border: 'none', borderRadius: '0.5rem', fontSize: '0.9rem', fontWeight: '600', cursor: canSubmit ? 'pointer' : 'not-allowed', fontFamily: 'inherit' }}
            onMouseEnter={e => { if (canSubmit) e.currentTarget.style.backgroundColor = '#003366'; }}
            onMouseLeave={e => { if (canSubmit) e.currentTarget.style.backgroundColor = '#002147'; }}
          >
            {submitting ? 'Submitting…' : 'Submit Evaluation'}
          </button>
        </div>
      </div>
    </InterviewerLayout>
  );
}
