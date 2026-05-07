import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CalendarDays, ClipboardList, CheckCircle, Video } from 'lucide-react';
import { collection, limit, onSnapshot, query } from 'firebase/firestore';
import { db } from '../firebase';
import { InterviewerLayout } from '../components/InterviewerLayout';
import { getSession } from '../utils/session';
import { getRequisitionPositionTitle } from '../utils/requisitionFields';
import {
  normalizeInterviewSessionHrAttendee,
  type InterviewSessionHrAttendee,
} from '../utils/interviewSessionHrAttendee';

interface InterviewerMember { id: string; name: string; email: string; title: string; department: string; }
interface CandidateEntry   { id: string; name: string; position: string; }

interface Committee {
  id: string;
  title: string;
  department: string;
  requisitionId: string;
  status: string;
  interviewers: InterviewerMember[];
  candidates:   CandidateEntry[];
  scheduledDate?: string;
  scheduledTime?: string;
  meetingLink?: string;
  sessionHrAttendee?: InterviewSessionHrAttendee;
}

interface EvalRow {
  id: string;
  candidateId: string;
  committeeId: string;
  interviewerId: string;
  interviewerEmail: string;
}

function formatDate(iso: string): string {
  if (!iso) return '-';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

/** Dean resolved Hire / Not Hire on the candidate doc — interviewer "done" lane clears per candidate. */
function candidateAwaitingDeanDecision(doc: Record<string, unknown> | undefined): boolean {
  if (!doc) return true;
  const fd = String(doc.finalDecision ?? '').trim();
  if (fd === 'Hired' || fd === 'Not Hired') return false;
  const st = String(doc.status ?? '').trim();
  if (st === 'Hired' || st === 'Not Hired') return false;
  return true;
}

export default function InterviewerDashboard() {
  const navigate = useNavigate();
  const session = getSession();
  const norm = (v: string) => v.trim().toLowerCase();

  // Prefer current session storage model, keep legacy fallback.
  const userEmail = (session?.email ?? sessionStorage.getItem('pmu_user_email') ?? '').trim();
  const userName  = (session?.fullName ?? '').trim();

  const [allCommittees, setAllCommittees] = useState<Committee[]>([]);
  const [allEvals,      setAllEvals]      = useState<EvalRow[]>([]);
  const [candidateDocById, setCandidateDocById] = useState<Record<string, Record<string, unknown>>>({});
  const [loading,       setLoading]       = useState(true);

  useEffect(() => {
    let comLoaded = false, evalLoaded = false, candLoaded = false;
    const tryDone = () => { if (comLoaded && evalLoaded && candLoaded) setLoading(false); };

    const u1 = onSnapshot(query(collection(db, 'committees'), limit(250)), snap => {
      setAllCommittees(snap.docs.map(d => {
        const r = d.data();
        return {
          id:            d.id,
          title:         getRequisitionPositionTitle(r as Record<string, unknown>),
          department:    (r.department     as string) ?? '-',
          requisitionId: (r.requisitionId  as string) ?? '',
          status:        (r.status         as string) ?? 'Active',
          interviewers:  (r.interviewers   as InterviewerMember[]) ?? [],
          candidates:    (r.candidates     as CandidateEntry[])    ?? [],
          scheduledDate: r.scheduledDate   as string | undefined,
          scheduledTime: r.scheduledTime   as string | undefined,
          meetingLink:   r.meetingLink     as string | undefined,
          sessionHrAttendee: normalizeInterviewSessionHrAttendee(r.sessionHrAttendee),
        };
      }));
      comLoaded = true; tryDone();
    }, e => { console.error(e); comLoaded = true; tryDone(); });

    const u2 = onSnapshot(query(collection(db, 'evaluations'), limit(2000)), snap => {
      setAllEvals(snap.docs.map(d => {
        const r = d.data();
        return {
          id:             d.id,
          candidateId:    (r.candidateId    as string) ?? '',
          committeeId:    (r.committeeId    as string) ?? '',
          interviewerId:  (r.interviewerId  as string) ?? '',
          interviewerEmail:(r.interviewerEmail as string) ?? '',
        };
      }));
      evalLoaded = true; tryDone();
    }, e => { console.error(e); evalLoaded = true; tryDone(); });

    const u3 = onSnapshot(collection(db, 'candidates'), snap => {
      const next: Record<string, Record<string, unknown>> = {};
      snap.docs.forEach(d => { next[d.id] = d.data() as Record<string, unknown>; });
      setCandidateDocById(next);
      candLoaded = true;
      tryDone();
    }, e => { console.error(e); candLoaded = true; tryDone(); });

    return () => { u1(); u2(); u3(); };
  }, []);

  /* ── Committee visibility ──────────────────────────────────────────────────
     Strategy (mirrors InterviewerMyCommittee.tsx):
     1. If a session email exists, try an exact email match first.
     2. If matches found → use only those (normal logged-in case).
     3. If no matches (empty session OR email not in any committee) → show ALL
        committees.  The role-based router already restricts this page to the
        Interviewer role, so showing all committees in the fallback is safe for
        a single-interviewer demo environment.
  ── */
  const myCommittees = useMemo(() => {
    const matchedByIdentity = allCommittees.filter(c =>
      c.interviewers.some(iv =>
        (userEmail && norm(iv.email) === norm(userEmail)) ||
        (userName && norm(iv.name) === norm(userName))
      )
    );
    return (userEmail || userName)
      ? (matchedByIdentity.length > 0 ? matchedByIdentity : allCommittees)
      : allCommittees;
  }, [allCommittees, userEmail, userName]);

  const committeeCandidateEvalKeys = useMemo(
    () => new Set(allEvals.map(e => `${e.committeeId}::${e.candidateId}`)),
    [allEvals]
  );

  /* ── Derived data ── */
  /** Committees with a confirmed calendar slot — still accepting evaluations while Scheduled. */
  const activeScheduledCommittees = useMemo(
    () => myCommittees.filter(c => c.status === 'Scheduled' && !!c.scheduledDate),
    [myCommittees],
  );

  /**
   * Interview lifecycle: Scheduled or Completed (Completed is set once every assigned candidate has a committee evaluation).
   * We must include Completed here — otherwise "Interviews Done" drops to zero the moment the last evaluation is filed.
   */
  const interviewPhaseCommittees = useMemo(
    () =>
      myCommittees.filter(
        c =>
          !!c.scheduledDate &&
          (c.status === 'Scheduled' || c.status === 'Completed'),
      ),
    [myCommittees],
  );

  // Interview workload: pending until each assigned candidate has at least one committee evaluation (any member).
  const pendingByCommittee = useMemo(() => {
    const map = new Map<string, number>();
    interviewPhaseCommittees.forEach(c => {
      if (c.status !== 'Scheduled') {
        map.set(c.id, 0);
        return;
      }
      let pending = 0;
      c.candidates.forEach(cand => {
        if (!committeeCandidateEvalKeys.has(`${c.id}::${cand.id}`)) pending++;
      });
      map.set(c.id, pending);
    });
    return map;
  }, [interviewPhaseCommittees, committeeCandidateEvalKeys]);

  const scheduledCommittees = useMemo(
    () => activeScheduledCommittees.filter(c => (pendingByCommittee.get(c.id) ?? 0) > 0),
    [activeScheduledCommittees, pendingByCommittee],
  );

  /**
   * Candidate slots where the committee evaluation exists but Dean has not recorded Hire / Not Hire yet.
   * Drops back to zero per candidate once finalDecision (or status) reflects Dean resolution.
   */
  const interviewsDoneAwaitingDean = useMemo(() => {
    let n = 0;
    for (const c of interviewPhaseCommittees) {
      for (const cand of c.candidates) {
        if (!committeeCandidateEvalKeys.has(`${c.id}::${cand.id}`)) continue;
        if (candidateAwaitingDeanDecision(candidateDocById[cand.id])) n++;
      }
    }
    return n;
  }, [interviewPhaseCommittees, committeeCandidateEvalKeys, candidateDocById]);

  // Pending = assigned candidate slots still missing any committee evaluation.
  const pendingEvals = useMemo(() => {
    const rows: {
      committeeId: string;
      candidateId: string;
      candidateName: string;
      title: string;
      department: string;
      scheduledDate?: string;
      scheduledTime?: string;
    }[] = [];
    for (const c of scheduledCommittees) {
      for (const cand of c.candidates) {
        if (!committeeCandidateEvalKeys.has(`${c.id}::${cand.id}`)) {
          rows.push({
            committeeId: c.id,
            candidateId: cand.id,
            candidateName: cand.name,
            title: c.title,
            department: c.department,
            scheduledDate: c.scheduledDate,
            scheduledTime: c.scheduledTime,
          });
        }
      }
    }
    return rows;
  }, [scheduledCommittees, committeeCandidateEvalKeys]);

  const pendingPreview = pendingEvals.slice(0, 5);

  // Keep card scope consistent with the visible interview workload on this page:
  // candidate slots from scheduled interviews only.
  const totalAssignedCandidates = useMemo(() => {
    const assignedSlots = new Set<string>();
    scheduledCommittees.forEach(c => c.candidates.forEach(cand => assignedSlots.add(`${c.id}::${cand.id}`)));
    return assignedSlots.size;
  }, [scheduledCommittees]);

  return (
    <InterviewerLayout>
      <div style={{ backgroundColor: '#f8fafc', borderRadius: '0.875rem', padding: '1.25rem', minHeight: 'calc(100vh - 12rem)' }}>
      <div style={{ marginBottom: '1.9rem' }}>
        <h1 style={{ marginBottom: '0.2rem', fontSize: '1.85rem', fontWeight: 700, color: '#002147' }}>Welcome back, Interviewer</h1>
        <p style={{ fontSize: '0.9rem', color: '#64748b' }}>Faculty Interview Panel - Academic Hiring</p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0,1fr))', gap: '1.15rem', marginBottom: '1.9rem' }}>
        {[
          { label: 'Assigned Candidates', value: totalAssignedCandidates, iconBg: '#eef2ff', iconColor: '#4f46e5', Icon: ClipboardList },
          { label: 'Scheduled Interviews', value: scheduledCommittees.length, iconBg: '#eff6ff', iconColor: '#2563eb', Icon: CalendarDays },
          { label: 'Pending Evaluations', value: pendingEvals.length, iconBg: '#fff7ed', iconColor: '#ea580c', Icon: ClipboardList },
          {
            label: 'Interviews Done',
            value: interviewsDoneAwaitingDean,
            iconBg: '#ecfdf5',
            iconColor: '#059669',
            Icon: CheckCircle,
          },
        ].map(({ label, value, iconBg, iconColor, Icon }) => (
          <div key={label} style={{ backgroundColor: 'white', borderRadius: '0.875rem', padding: '1.15rem', boxShadow: '0 1px 3px rgba(15,23,42,0.08)', border: '1px solid #f1f5f9' }}>
            <div style={{ marginBottom: '0.9rem', width: '40px', height: '40px', borderRadius: '0.6rem', backgroundColor: iconBg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Icon color={iconColor} size={19} />
            </div>
            <p style={{ marginBottom: '0.2rem', fontSize: '0.78rem', color: '#64748b', fontWeight: 500 }}>{label}</p>
            <p style={{ fontSize: '1.9rem', fontWeight: 700, color: '#0f172a', lineHeight: 1 }}>{loading ? '-' : value}</p>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr', gap: '1.5rem' }}>
        <section style={{ backgroundColor: 'white', borderRadius: '0.875rem', padding: '1.25rem', boxShadow: '0 1px 3px rgba(15,23,42,0.08)', border: '1px solid #f1f5f9' }}>
          <div style={{ marginBottom: '1rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <h2 style={{ fontSize: '1rem', fontWeight: 700, color: '#111827' }}>Scheduled Interviews</h2>
            {!loading && scheduledCommittees.length > 0 && (
              <button
                onClick={() => navigate('/interviewer/my-committee')}
                style={{ border: 'none', background: 'none', color: '#002147', fontSize: '0.82rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
              >
                View Full Details →
              </button>
            )}
          </div>
          {loading ? (
            <div style={{ padding: '1rem 0', fontSize: '0.88rem', color: '#64748b' }}>Loading...</div>
          ) : scheduledCommittees.length === 0 ? (
            <div style={{ borderRadius: '0.65rem', backgroundColor: '#f8fafc', padding: '2rem 1rem', textAlign: 'center', fontSize: '0.88rem', color: '#64748b' }}>
              No scheduled interviews yet. HR will schedule your interviews.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {scheduledCommittees.map(c => (
                <article key={c.id} style={{ borderRadius: '0.75rem', backgroundColor: '#f8fafc', padding: '1rem', border: '1px solid #f1f5f9' }}>
                  <div style={{ marginBottom: '0.65rem' }}>
                    <p style={{ fontSize: '0.9rem', fontWeight: 700, color: '#111827' }}>{c.title}</p>
                    <p style={{ fontSize: '0.76rem', color: '#64748b' }}>{c.department} · {c.requisitionId}</p>
                  </div>
                  <div style={{ marginBottom: '0.65rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                    <CalendarDays size={13} color="#1d4ed8" />
                    <span style={{ fontSize: '0.78rem', fontWeight: 600, color: '#1d4ed8' }}>
                        {formatDate(c.scheduledDate ?? '')} {c.scheduledTime}
                    </span>
                  </div>

                  <p style={{ marginBottom: '0.72rem', fontSize: '0.77rem', color: '#64748b' }}>
                      {c.candidates.length} candidate{c.candidates.length !== 1 ? 's' : ''}:&nbsp;
                      {c.candidates.map(cand => cand.name).join(', ')}
                  </p>

                  {c.sessionHrAttendee && (
                    <p style={{ marginBottom: '0.72rem', fontSize: '0.76rem', color: '#854d0e' }}>
                      <span style={{ fontWeight: 700 }}>HR (interview attendee):</span>{' '}
                      {c.sessionHrAttendee.fullName || 'HR'}
                    </p>
                  )}

                  {c.meetingLink && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap' }}>
                      <a
                        href={c.meetingLink}
                        target="_blank"
                        rel="noreferrer"
                        style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', borderRadius: '0.5rem', backgroundColor: '#0f172a', padding: '0.38rem 0.75rem', fontSize: '0.82rem', fontWeight: 600, color: 'white', textDecoration: 'none', transition: 'background-color 150ms ease' }}
                        onMouseEnter={e => { e.currentTarget.style.backgroundColor = '#1e293b'; }}
                        onMouseLeave={e => { e.currentTarget.style.backgroundColor = '#0f172a'; }}
                      >
                        <Video size={13} /> Join Meeting
                      </a>
                    </div>
                  )}
                </article>
              ))}
            </div>
          )}
        </section>

        <section style={{ backgroundColor: 'white', borderRadius: '0.875rem', padding: '1.25rem', boxShadow: '0 1px 3px rgba(15,23,42,0.08)', border: '1px solid #f1f5f9' }}>
          <div style={{ marginBottom: '1rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
              <h2 style={{ fontSize: '1rem', fontWeight: 700, color: '#111827' }}>Pending Evaluations</h2>
              <span style={{ borderRadius: '999px', backgroundColor: '#ffedd5', padding: '0.18rem 0.6rem', fontSize: '0.72rem', fontWeight: 800, color: '#c2410c' }}>
                {pendingEvals.length}
              </span>
            </div>
            {pendingEvals.length > 5 && (
              <button
                onClick={() => navigate('/interviewer/evaluation-form')}
                style={{ border: 'none', background: 'none', color: '#2563eb', fontSize: '0.82rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
              >
                View All →
              </button>
            )}
          </div>

          {loading ? (
            <div style={{ padding: '1rem 0', fontSize: '0.88rem', color: '#64748b' }}>Loading...</div>
          ) : pendingPreview.length === 0 ? (
            <div style={{ borderRadius: '0.65rem', backgroundColor: '#f8fafc', padding: '2rem 1rem', textAlign: 'center', fontSize: '0.88rem', color: '#64748b', fontWeight: 600 }}>
              No pending evaluations. You're all caught up!
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {pendingPreview.map(({ committeeId, candidateId, candidateName, title, department, scheduledDate, scheduledTime }) => (
                <article
                  key={`${committeeId}::${candidateId}`}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem', borderRadius: '0.72rem', backgroundColor: '#f8fafc', padding: '0.95rem 1rem', border: '1px solid #f1f5f9' }}
                >
                  <div>
                    <p style={{ fontSize: '0.88rem', fontWeight: 700, color: '#111827' }}>{candidateName}</p>
                    <p style={{ fontSize: '0.76rem', color: '#64748b' }}>{title} · {department}</p>
                    <p style={{ marginTop: '0.22rem', fontSize: '0.75rem', color: '#1d4ed8' }}>
                      Scheduled: {formatDate(scheduledDate ?? '')} {scheduledTime ?? ''}
                    </p>
                  </div>
                  <button
                    onClick={() => navigate(`/interviewer/evaluation-form?committeeId=${committeeId}&candidateId=${candidateId}`)}
                    style={{ border: 'none', borderRadius: '0.5rem', backgroundColor: '#0f172a', padding: '0.38rem 0.75rem', fontSize: '0.82rem', fontWeight: 600, color: 'white', cursor: 'pointer', fontFamily: 'inherit' }}
                    onMouseEnter={e => { e.currentTarget.style.backgroundColor = '#1e293b'; }}
                    onMouseLeave={e => { e.currentTarget.style.backgroundColor = '#0f172a'; }}
                  >
                    Evaluate
                  </button>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>

      {!loading && myCommittees.length === 0 && (
        <div style={{ marginTop: '1.25rem', backgroundColor: 'white', borderRadius: '0.875rem', padding: '2.7rem 1rem', textAlign: 'center', boxShadow: '0 1px 3px rgba(15,23,42,0.08)' }}>
          <p style={{ marginBottom: '0.35rem', fontSize: '1rem', fontWeight: 700, color: '#475569' }}>No assignments yet</p>
          <p style={{ fontSize: '0.86rem', color: '#64748b' }}>You will appear here once the Chair assigns you to an interview committee.</p>
        </div>
      )}
      </div>
    </InterviewerLayout>
  );
}
