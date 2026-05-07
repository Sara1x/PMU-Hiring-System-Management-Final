import { useEffect, useMemo, useState } from 'react';
import { CalendarDays, Clock, Video, UserCircle } from 'lucide-react';
import { ChairLayout } from '../components/ChairLayout';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '../firebase';
import { getSession } from '../utils/session';
import { getRequisitionPositionTitle } from '../utils/requisitionFields';
import { normalizeRequisitionStatus } from '../utils/requisitionWorkflow';
import {
  committeeFirestoreStatusesAwaitingChair,
  recordChairScheduleApproval,
} from '../utils/committeeScheduleApproval';
import {
  normalizeInterviewSessionHrAttendee,
  type InterviewSessionHrAttendee,
} from '../utils/interviewSessionHrAttendee';

interface CommitteeMember {
  id: string;
  name: string;
  email: string;
  title?: string;
  department?: string;
}

interface CommitteeCandidate {
  id: string;
  name: string;
  position?: string;
}

interface CommitteeRow {
  id: string;
  requisitionId: string;
  title: string;
  department: string;
  chairEmail?: string;
  chairName?: string;
  interviewers: CommitteeMember[];
  candidates: CommitteeCandidate[];
  scheduledDate?: string;
  scheduledTime?: string;
  duration?: string;
  meetingLink?: string;
  confirmedInterviewers?: CommitteeMember[];
  sessionHrAttendee?: InterviewSessionHrAttendee;
}

function norm(v: string): string {
  return v.trim().toLowerCase();
}

function committeeOwnedBySessionChair(c: CommitteeRow, email: string, fullName: string): boolean {
  const ce = norm(c.chairEmail ?? '');
  const cn = norm(c.chairName ?? '');
  if (ce && norm(email) === ce) return true;
  if (cn && norm(fullName) === cn) return true;
  if (!ce && !cn) return true;
  return false;
}

function formatDate(iso?: string): string {
  if (!iso) return '-';
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y}`;
}

export default function ChairScheduleApprovals() {
  const session = getSession();
  const email = (session?.email ?? '').trim();
  const fullName = (session?.fullName ?? '').trim();

  const [committees, setCommittees] = useState<CommitteeRow[]>([]);
  const [reqStatusById, setReqStatusById] = useState<Map<string, string>>(() => new Map());
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let reqLoaded = false;
    let comLoaded = false;
    const done = () => {
      if (reqLoaded && comLoaded) setLoading(false);
    };

    const reqUnsub = onSnapshot(
      collection(db, 'requisitions'),
      snap => {
        const m = new Map<string, string>();
        snap.forEach(d => {
          m.set(d.id, normalizeRequisitionStatus((d.data().status as string) ?? 'Pending HR'));
        });
        setReqStatusById(m);
        reqLoaded = true;
        done();
      },
      e => {
        console.error(e);
        setLoading(false);
      },
    );

    const comUnsub = onSnapshot(
      query(collection(db, 'committees'), where('status', 'in', committeeFirestoreStatusesAwaitingChair())),
      snap => {
        setCommittees(
          snap.docs.map(d => {
            const r = d.data() as Record<string, unknown>;
            const iv = (r.interviewers as CommitteeMember[]) ?? [];
            const cand = ((r.candidates as CommitteeCandidate[]) ?? []).filter(x => !!x.id);
            const confirmed = r.confirmedInterviewers as CommitteeMember[] | undefined;
            return {
              id: d.id,
              requisitionId: (r.requisitionId as string) ?? '',
              title: getRequisitionPositionTitle(r),
              department: (r.department as string) ?? '-',
              chairEmail: (r.chairEmail as string) ?? '',
              chairName: (r.chairName as string) ?? '',
              interviewers: iv,
              candidates: cand,
              scheduledDate: r.scheduledDate as string | undefined,
              scheduledTime: r.scheduledTime as string | undefined,
              duration: r.duration as string | undefined,
              meetingLink: r.meetingLink as string | undefined,
              confirmedInterviewers: confirmed,
              sessionHrAttendee: normalizeInterviewSessionHrAttendee(r.sessionHrAttendee),
            };
          }),
        );
        comLoaded = true;
        done();
      },
      e => {
        console.error(e);
        setLoading(false);
      },
    );

    return () => {
      reqUnsub();
      comUnsub();
    };
  }, []);

  const pendingForMe = useMemo(() => {
    const st = (reqId: string) => reqStatusById.get(reqId) ?? 'Pending HR';
    return committees.filter(
      c =>
        c.requisitionId &&
        st(c.requisitionId) === 'Pending Scheduling' &&
        committeeOwnedBySessionChair(c, email, fullName),
    );
  }, [committees, reqStatusById, email, fullName]);

  const onApprove = async (committeeId: string) => {
    setErr(null);
    setBusyId(committeeId);
    try {
      await recordChairScheduleApproval(db, committeeId, { chairEmail: email, chairFullName: fullName });
    } catch (e) {
      console.error(e);
      setErr(e instanceof Error ? e.message : 'Could not approve schedule.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <ChairLayout>
      <h1 style={{ fontSize: '1.6rem', fontWeight: '700', color: '#111827', marginBottom: '0.35rem' }}>
        Interview schedule approvals
      </h1>
      <p style={{ color: '#64748b', fontSize: '0.9rem', marginBottom: '1.5rem', maxWidth: '720px', lineHeight: 1.55 }}>
        HR proposes interview dates and meeting links for committees you formed. Confirm committee availability here—once approved,
        interviews become <strong style={{ color: '#111827' }}>Scheduled</strong> and interviewers can see them. Individual interviewer logins are not required.
      </p>

      {err && (
        <div
          style={{
            marginBottom: '1rem',
            padding: '0.75rem 1rem',
            backgroundColor: '#fef2f2',
            border: '1px solid #fecaca',
            borderRadius: '0.5rem',
            color: '#b91c1c',
            fontSize: '0.85rem',
          }}
        >
          {err}
        </div>
      )}

      {loading ? (
        <div style={{ textAlign: 'center', padding: '3rem', color: '#64748b' }}>Loading…</div>
      ) : pendingForMe.length === 0 ? (
        <div
          style={{
            textAlign: 'center',
            padding: '2.5rem 1rem',
            backgroundColor: 'white',
            borderRadius: '0.875rem',
            boxShadow: '0 1px 3px rgba(0,0,0,0.07)',
            color: '#94a3b8',
            fontSize: '0.9rem',
          }}
        >
          No proposals are awaiting your approval right now.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {pendingForMe.map(c => {
            const members = c.confirmedInterviewers ?? c.interviewers;
            const busy = busyId === c.id;
            return (
              <div
                key={c.id}
                style={{
                  backgroundColor: 'white',
                  borderRadius: '0.875rem',
                  padding: '1.35rem',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.07)',
                  border: '1px solid #ffedd5',
                }}
              >
                <div style={{ marginBottom: '1rem', paddingBottom: '1rem', borderBottom: '1px solid #f1f5f9' }}>
                  <p style={{ fontSize: '0.68rem', fontWeight: '700', color: '#c2410c', letterSpacing: '0.06em', marginBottom: '0.35rem' }}>
                    PENDING CHAIR SCHEDULE APPROVAL
                  </p>
                  <h2 style={{ fontSize: '1.05rem', fontWeight: '700', color: '#111827', margin: '0 0 0.35rem 0' }}>{c.title}</h2>
                  <p style={{ fontSize: '0.82rem', color: '#64748b', margin: '0 0 0.15rem 0' }}>{c.department}</p>
                  <p style={{ fontSize: '0.75rem', color: '#94a3b8', fontFamily: 'ui-monospace, monospace', margin: 0 }}>{c.requisitionId}</p>
                </div>

                <div style={{ marginBottom: '1rem', padding: '0.85rem 1rem', backgroundColor: '#fffbeb', border: '1px solid #fde68a', borderRadius: '0.5rem' }}>
                  <p style={{ fontSize: '0.72rem', fontWeight: '700', color: '#92400e', marginBottom: '0.35rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                    HR proposed slot
                  </p>
                  <p style={{ fontSize: '0.88rem', color: '#78350f', margin: 0, fontWeight: '600' }}>
                    {formatDate(c.scheduledDate)} · {c.scheduledTime ?? '—'} · {c.duration ?? '—'} min
                  </p>
                  {c.meetingLink && (
                    <a
                      href={c.meetingLink}
                      target="_blank"
                      rel="noreferrer"
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '0.35rem',
                        marginTop: '0.65rem',
                        padding: '0.45rem 0.85rem',
                        backgroundColor: '#002147',
                        color: 'white',
                        borderRadius: '0.45rem',
                        fontSize: '0.8rem',
                        fontWeight: '600',
                        textDecoration: 'none',
                      }}
                    >
                      <Video size={14} /> Open meeting link
                    </a>
                  )}
                </div>

                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1.25rem', marginBottom: '1.15rem' }}>
                  <div style={{ flex: '1 1 240px', minWidth: 0 }}>
                    <p style={{ fontSize: '0.72rem', fontWeight: '700', color: '#64748b', marginBottom: '0.5rem', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                      Candidates ({c.candidates.length})
                    </p>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', maxHeight: '180px', overflowY: 'auto' }}>
                      {c.candidates.map(cand => (
                        <div key={cand.id} style={{ display: 'flex', alignItems: 'flex-start', gap: '0.45rem', padding: '0.45rem 0.55rem', borderRadius: '0.45rem', border: '1px solid #e2e8f0', backgroundColor: '#f8fafc' }}>
                          <UserCircle size={18} color="#94a3b8" style={{ flexShrink: 0 }} />
                          <div style={{ minWidth: 0 }}>
                            <p style={{ fontSize: '0.8125rem', fontWeight: '600', color: '#0f172a', margin: 0 }}>{cand.name}</p>
                            {cand.position && <p style={{ fontSize: '0.72rem', color: '#64748b', margin: '0.1rem 0 0 0' }}>{cand.position}</p>}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div style={{ flex: '1 1 200px', minWidth: 0 }}>
                    <p style={{ fontSize: '0.72rem', fontWeight: '700', color: '#64748b', marginBottom: '0.5rem', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                      Interview attendees ({members.length + (c.sessionHrAttendee ? 1 : 0)})
                    </p>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                      {members.map(m => (
                        <div key={m.id} style={{ fontSize: '0.78rem', color: '#475569', padding: '0.35rem 0.45rem', backgroundColor: '#f1f5f9', borderRadius: '0.35rem' }}>
                          <span style={{ fontWeight: '600', color: '#0f172a' }}>{m.name}</span>
                        </div>
                      ))}
                      {c.sessionHrAttendee && (
                        <div
                          style={{
                            fontSize: '0.78rem',
                            color: '#475569',
                            padding: '0.35rem 0.45rem',
                            backgroundColor: '#fefce8',
                            borderRadius: '0.35rem',
                            border: '1px solid #fde047',
                          }}
                        >
                          <span style={{ fontWeight: '600', color: '#0f172a' }}>{c.sessionHrAttendee.fullName || 'HR'}</span>
                          <span style={{ display: 'block', fontSize: '0.68rem', fontWeight: '700', color: '#92400e', marginTop: '0.15rem' }}>HR · interview attendee</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'flex-end', gap: '0.65rem', paddingTop: '0.85rem', borderTop: '1px solid #f1f5f9' }}>
                  <span style={{ fontSize: '0.76rem', color: '#64748b', marginRight: 'auto' }}>
                    <CalendarDays size={13} style={{ verticalAlign: '-2px', marginRight: '0.25rem' }} />
                    After approval, interviewers see this session on their dashboards.
                  </span>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void onApprove(c.id)}
                    style={{
                      padding: '0.55rem 1.25rem',
                      backgroundColor: busy ? '#94a3b8' : '#002147',
                      color: 'white',
                      border: 'none',
                      borderRadius: '0.45rem',
                      fontSize: '0.8125rem',
                      fontWeight: '600',
                      cursor: busy ? 'not-allowed' : 'pointer',
                      fontFamily: 'inherit',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.35rem',
                    }}
                  >
                    <Clock size={15} />
                    {busy ? 'Approving…' : 'Approve schedule'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </ChairLayout>
  );
}
