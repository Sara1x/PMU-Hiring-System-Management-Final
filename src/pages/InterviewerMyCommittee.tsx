import { useEffect, useState } from 'react';
import { UserCircle, Mail, CalendarDays, Clock, Video } from 'lucide-react';
import { InterviewerLayout } from '../components/InterviewerLayout';
import { useNavigate } from 'react-router-dom';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '../firebase';
import { getRequisitionPositionTitle } from '../utils/requisitionFields';
import {
  normalizeInterviewSessionHrAttendee,
  type InterviewSessionHrAttendee,
} from '../utils/interviewSessionHrAttendee';

interface CommitteeMember {
  id: string;
  name: string;
  rank?: string;
  dept?: string;
  email: string;
  phone?: string;
  // Firestore committee docs typically use these fields
  title?: string;
  department?: string;
}

interface CommitteeCandidate {
  id: string;
  name: string;
  position?: string;
}

interface Committee {
  id: string;
  requisitionId: string;
  position: string;
  chairName: string;
  status: string;
  interviewers: CommitteeMember[];
  candidates: CommitteeCandidate[];
  scheduledDate?: string;
  scheduledTime?: string;
  duration?: string;
  meetingLink?: string;
  confirmedInterviewers?: CommitteeMember[];
  scheduleApprovedByIds?: string[];
  sessionHrAttendee?: InterviewSessionHrAttendee;
}

type CommitteeTab = 'candidates' | 'members' | 'details';

function formatDate(iso?: string): string {
  if (!iso) return '-';
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y}`;
}

export default function InterviewerMyCommittee() {
  const navigate = useNavigate();
  const [committees, setCommittees] = useState<Committee[]>([]);
  const [submittedKeys, setSubmittedKeys] = useState<Set<string>>(new Set());
  const [activeTabByCommittee, setActiveTabByCommittee] = useState<Record<string, CommitteeTab>>({});
  const [showAllCandidatesByCommittee, setShowAllCandidatesByCommittee] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = onSnapshot(
      query(
        collection(db, 'committees'),
        where('status', '==', 'Scheduled'),
      ),
      (snap) => {
        setCommittees(
          snap.docs.map(d => {
            const data = d.data() as Record<string, unknown>;

            const interviewersRaw = (data.interviewers as Array<Record<string, unknown>> | undefined) ?? [];
            const interviewers: CommitteeMember[] = interviewersRaw.map(iv => ({
              id: (iv.id as string) ?? '',
              name: (iv.name as string) ?? '-',
              email: (iv.email as string) ?? '',
              rank: (iv.rank as string) ?? (iv.title as string) ?? '',
              dept: (iv.dept as string) ?? (iv.department as string) ?? '',
              phone: (iv.phone as string) ?? '',
              title: (iv.title as string) ?? '',
              department: (iv.department as string) ?? '',
            })).filter(iv => !!iv.id);

            const candidatesRaw = (data.candidates as Array<{ id?: string; name?: string; position?: string }> | undefined) ?? [];
            const candidates: CommitteeCandidate[] = candidatesRaw.map(c => ({
              id: c.id ?? '',
              name: c.name ?? '-',
              position: c.position ?? '',
            })).filter(c => !!c.id);

            const confirmedRaw = (data.confirmedInterviewers as Array<Record<string, unknown>> | undefined) ?? undefined;
            const confirmedInterviewers = confirmedRaw
              ? confirmedRaw.map(iv => ({
                  id: (iv.id as string) ?? '',
                  name: (iv.name as string) ?? '-',
                  email: (iv.email as string) ?? '',
                  rank: (iv.rank as string) ?? (iv.title as string) ?? '',
                  dept: (iv.dept as string) ?? (iv.department as string) ?? '',
                  phone: (iv.phone as string) ?? '',
                  title: (iv.title as string) ?? '',
                  department: (iv.department as string) ?? '',
                })).filter(iv => !!iv.id)
              : undefined;

            return {
              id: d.id,
              requisitionId: (data.requisitionId as string) ?? '',
              position: getRequisitionPositionTitle(data),
              chairName: (data.chairName as string) ?? '-',
              status: (data.status as string) ?? 'Active',
              interviewers,
              candidates,
              scheduledDate: data.scheduledDate as string | undefined,
              scheduledTime: data.scheduledTime as string | undefined,
              duration: data.duration as string | undefined,
              meetingLink: data.meetingLink as string | undefined,
              confirmedInterviewers,
              scheduleApprovedByIds: (data.scheduleApprovedByIds as string[] | undefined),
              sessionHrAttendee: normalizeInterviewSessionHrAttendee(data.sessionHrAttendee),
            };
          })
        );
        setLoading(false);
      },
      (e) => {
        console.error(e);
        setLoading(false);
      }
    );

    return unsub;
  }, []);

  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, 'evaluations'),
      (snap) => {
        const nextAll = new Set<string>();

        snap.docs.forEach(d => {
          const data = d.data() as Record<string, unknown>;
          const cmId = (data.committeeId as string) ?? '';
          const candId = (data.candidateId as string) ?? '';
          if (!cmId || !candId) return;

          const key = `${cmId}:${candId}`;
          nextAll.add(key);
        });

        setSubmittedKeys(nextAll);
      },
      (e) => console.error(e)
    );

    return unsub;
  }, [committees]);

  const scheduledCommitteesList = committees;
  const actionableScheduledCommittees = committees.filter(committee =>
    committee.candidates.some(c => !submittedKeys.has(`${committee.id}:${c.id}`)),
  );

  if (loading) {
    return (
      <InterviewerLayout>
        <div style={{ textAlign: 'center', padding: '3rem', color: '#6b7280' }}>Loading committees…</div>
      </InterviewerLayout>
    );
  }

  if (committees.length === 0) {
    return (
      <InterviewerLayout>
        <div style={{ textAlign: 'center', padding: '3rem', color: '#9ca3af', backgroundColor: 'white', borderRadius: '0.875rem', boxShadow: '0 1px 3px rgba(0,0,0,0.07)' }}>
          Nothing here yet—scheduled interviews appear after HR proposes a time and the Department Chair approves it.
        </div>
      </InterviewerLayout>
    );
  }

  if (
    actionableScheduledCommittees.length === 0 &&
    scheduledCommitteesList.length > 0
  ) {
    return (
      <InterviewerLayout>
        <div style={{ textAlign: 'center', padding: '3rem', color: '#6b7280', backgroundColor: 'white', borderRadius: '0.875rem', boxShadow: '0 1px 3px rgba(0,0,0,0.07)' }}>
          <p style={{ fontSize: '1rem', fontWeight: '600', color: '#111827', marginBottom: '0.45rem' }}>
            All evaluations submitted
          </p>
          <p style={{ fontSize: '0.875rem', color: '#6b7280', marginBottom: '1.25rem' }}>
            You currently have no pending candidate evaluations.
          </p>
          <button
            onClick={() => navigate('/interviewer/dashboard')}
            style={{ padding: '0.6rem 1.25rem', backgroundColor: '#002147', color: 'white', border: 'none', borderRadius: '0.5rem', fontSize: '0.875rem', fontWeight: '600', cursor: 'pointer', fontFamily: 'inherit' }}
          >
            Back to Dashboard
          </button>
        </div>
      </InterviewerLayout>
    );
  }

  return (
    <InterviewerLayout>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>

        {actionableScheduledCommittees.map(committee => (
          <div
            key={committee.id}
            style={{
              backgroundColor: 'white',
              borderRadius: '0.75rem',
              border: '1px solid #f3f4f6',
              padding: '1.25rem',
              boxShadow: '0 1px 3px rgba(0,0,0,0.07)',
              transition: 'box-shadow 0.15s ease',
            }}
            onMouseEnter={e => { e.currentTarget.style.boxShadow = '0 6px 18px rgba(2,6,23,0.08)'; }}
            onMouseLeave={e => { e.currentTarget.style.boxShadow = '0 1px 3px rgba(0,0,0,0.07)'; }}
          >
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '1rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
              <div>
                <p style={{ fontSize: '1.02rem', fontWeight: '700', color: '#111827', marginBottom: '0.15rem' }}>{committee.position}</p>
                <p style={{ fontSize: '0.78rem', color: '#9ca3af', marginBottom: '0.35rem' }}>Req ID: {committee.requisitionId || '-'}</p>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.8rem', color: '#1d4ed8', fontWeight: '600' }}>
                    <CalendarDays size={13} /> {formatDate(committee.scheduledDate)}
                  </span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.8rem', color: '#1d4ed8', fontWeight: '600' }}>
                    <Clock size={13} /> {committee.scheduledTime ?? '-'}
                  </span>
                  {committee.duration && (
                    <span style={{ fontSize: '0.78rem', color: '#6b7280' }}>{committee.duration} min</span>
                  )}
                </div>
              </div>
              {committee.meetingLink && (
                <a
                  href={committee.meetingLink}
                  target="_blank"
                  rel="noreferrer"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.35rem',
                    marginLeft: 'auto',
                    padding: '0.45rem 0.95rem',
                    backgroundColor: '#002147',
                    color: 'white',
                    borderRadius: '0.5rem',
                    fontSize: '0.82rem',
                    fontWeight: '600',
                    textDecoration: 'none',
                  }}
                >
                  <Video size={13} /> Join Teams
                </a>
              )}
            </div>

            <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
              {([
                { id: 'candidates', label: 'Candidates' },
                { id: 'members', label: 'Committee Members' },
                { id: 'details', label: 'Details' },
              ] as Array<{ id: CommitteeTab; label: string }>).map(tab => {
                const isActive = (activeTabByCommittee[committee.id] ?? 'candidates') === tab.id;
                return (
                  <button
                    key={`${committee.id}-${tab.id}`}
                    onClick={() => setActiveTabByCommittee(prev => ({ ...prev, [committee.id]: tab.id }))}
                    style={{
                      padding: '0.35rem 0.8rem',
                      borderRadius: '999px',
                      border: isActive ? '1px solid #1d4ed8' : '1px solid #e5e7eb',
                      backgroundColor: isActive ? '#dbeafe' : 'white',
                      color: isActive ? '#1d4ed8' : '#6b7280',
                      fontSize: '0.78rem',
                      fontWeight: '600',
                      cursor: 'pointer',
                      fontFamily: 'inherit',
                    }}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </div>

            {(() => {
              const activeTab = activeTabByCommittee[committee.id] ?? 'candidates';
              const members = committee.confirmedInterviewers ?? committee.interviewers;
              const pendingCandidates = Array.from(
                new Map(
                  committee.candidates
                    .filter(c => !submittedKeys.has(`${committee.id}:${c.id}`))
                    .map(c => [c.id, c])
                ).values()
              );
              const showAll = showAllCandidatesByCommittee[committee.id] === true;
              const visibleCandidates = showAll ? pendingCandidates : pendingCandidates.slice(0, 5);

              if (activeTab === 'members') {
                const hr = committee.sessionHrAttendee;
                return (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                    {hr && (
                      <div
                        style={{
                          gridColumn: '1 / -1',
                          border: '1px solid #fde047',
                          borderRadius: '0.65rem',
                          padding: '0.8rem',
                          backgroundColor: '#fefce8',
                        }}
                      >
                        <p style={{ fontSize: '0.68rem', fontWeight: '700', color: '#92400e', marginBottom: '0.35rem', letterSpacing: '0.04em' }}>HR · INTERVIEW ATTENDEE</p>
                        <p style={{ fontSize: '0.88rem', fontWeight: '700', color: '#111827', marginBottom: '0.2rem' }}>{hr.fullName || 'HR'}</p>
                        {hr.email ? (
                          <p style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.76rem', color: '#374151' }}>
                            <Mail size={12} color="#6b7280" /> {hr.email}
                          </p>
                        ) : null}
                        <p style={{ fontSize: '0.72rem', color: '#64748b', marginTop: '0.45rem', marginBottom: 0 }}>HR joins the confirmed session but does not submit evaluator forms.</p>
                      </div>
                    )}
                    {members.length === 0 ? (
                      <p style={{ gridColumn: '1 / -1', fontSize: '0.86rem', color: '#9ca3af' }}>No committee members listed.</p>
                    ) : (
                      members.map(m => (
                        <div key={m.id} style={{ border: '1px solid #e5e7eb', borderRadius: '0.65rem', padding: '0.8rem' }}>
                          <p style={{ fontSize: '0.88rem', fontWeight: '700', color: '#111827', marginBottom: '0.2rem' }}>{m.name}</p>
                          <p style={{ fontSize: '0.78rem', color: '#6b7280' }}>{m.rank || m.title || '-'}</p>
                          <p style={{ fontSize: '0.76rem', color: '#9ca3af', marginBottom: '0.35rem' }}>{m.dept || m.department || '-'}</p>
                          <p style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.76rem', color: '#374151' }}>
                            <Mail size={12} color="#6b7280" /> {m.email}
                          </p>
                        </div>
                      ))
                    )}
                  </div>
                );
              }

              if (activeTab === 'details') {
                return (
                  <div style={{ border: '1px solid #e5e7eb', borderRadius: '0.7rem', padding: '0.9rem', backgroundColor: '#fafafa' }}>
                    <p style={{ fontSize: '0.82rem', color: '#374151', marginBottom: '0.35rem' }}><strong>Committee ID:</strong> {committee.id}</p>
                    <p style={{ fontSize: '0.82rem', color: '#374151', marginBottom: '0.35rem' }}><strong>Requisition ID:</strong> {committee.requisitionId || '-'}</p>
                    <p style={{ fontSize: '0.82rem', color: '#374151' }}><strong>Total assigned candidates:</strong> {committee.candidates.length}</p>
                  </div>
                );
              }

              return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  {pendingCandidates.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '1.5rem', color: '#6b7280', backgroundColor: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: '0.75rem', fontSize: '0.88rem' }}>
                      All candidate evaluations have been submitted.
                    </div>
                  ) : (
                    <>
                      {visibleCandidates.map(c => (
                        <div
                          key={c.id}
                          style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem', padding: '0.9rem', border: '1px solid #e5e7eb', borderRadius: '0.65rem', backgroundColor: '#fafafa' }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                            <UserCircle size={28} color="#002147" />
                            <div>
                              <p style={{ fontSize: '0.88rem', fontWeight: '700', color: '#111827', marginBottom: '0.12rem' }}>{c.name}</p>
                              <p style={{ fontSize: '0.76rem', color: '#6b7280' }}>{c.position || '-'}</p>
                            </div>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                            <span style={{ padding: '0.24rem 0.7rem', backgroundColor: '#ffedd5', color: '#c2410c', borderRadius: '999px', fontSize: '0.74rem', fontWeight: '700' }}>
                              Pending Evaluation
                            </span>
                          </div>
                        </div>
                      ))}
                      {pendingCandidates.length > 5 && (
                        <button
                          onClick={() =>
                            setShowAllCandidatesByCommittee(prev => ({
                              ...prev,
                              [committee.id]: !showAll,
                            }))
                          }
                          style={{ alignSelf: 'flex-start', border: 'none', background: 'none', color: '#2563eb', fontSize: '0.82rem', fontWeight: '600', cursor: 'pointer', fontFamily: 'inherit' }}
                        >
                          {showAll ? 'Show Less' : `View All (${pendingCandidates.length}) →`}
                        </button>
                      )}
                    </>
                  )}
                </div>
              );
            })()}
          </div>
        ))}
      </div>
    </InterviewerLayout>
  );
}
