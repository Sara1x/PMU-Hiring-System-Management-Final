import { useState, useEffect, useMemo } from 'react';
import { Clock, CheckCircle, CalendarDays, UserCircle, Video, X, Copy, Users } from 'lucide-react';
import { collection, onSnapshot, doc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { HRLayout } from '../components/HRLayout';
import { normalizeRequisitionStatus } from '../utils/requisitionWorkflow';
import { getRequisitionPositionTitle } from '../utils/requisitionFields';
import { getSession } from '../utils/session';
import {
  normalizeInterviewSessionHrAttendee,
  type InterviewSessionHrAttendee,
} from '../utils/interviewSessionHrAttendee';
import {
  COMMITTEE_STATUS_PENDING_CHAIR_APPROVAL,
  isAwaitingChairScheduleApproval,
} from '../utils/committeeScheduleApproval';

interface CommitteeMember {
  id: string;
  name: string;
  email: string;
  department: string;
  title: string;
}

interface CommitteeCandidate {
  id: string;
  name: string;
  position: string;
}

interface Committee {
  id: string;
  requisitionId: string;
  title: string;
  department: string;
  status: string;
  interviewers: CommitteeMember[];
  candidates: CommitteeCandidate[];
  scheduledDate?: string;
  scheduledTime?: string;
  duration?: string;
  meetingLink?: string;
  confirmedInterviewers?: CommitteeMember[];
  scheduleApprovedByIds?: string[];
  /** HR session attendee — set when HR proposes; copied to interviews/{committeeId} when Chair approves. */
  sessionHrAttendee?: InterviewSessionHrAttendee;
}

interface ScheduleForm {
  date: string;
  time: string;
  duration: string;
  interviewerIds: Set<string>;
  meetingLink: string;
}

function generateTeamsLink(): string {
  const r = () => Math.random().toString(36).substring(2, 10);
  return `https://teams.microsoft.com/l/meetup-join/19:meeting_${r()}${r()}@thread.v2/0`;
}

function formatDate(iso: string): string {
  if (!iso) return '-';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

function HrInterviewSessionAttendeeRow({
  attendee,
  palette,
}: {
  attendee?: InterviewSessionHrAttendee;
  palette: 'amber' | 'blue';
}) {
  const hr = attendee;
  if (!hr) return null;
  const bg = palette === 'amber' ? '#fffbeb' : '#fefce8';
  const border = palette === 'amber' ? '#fde68a' : '#fde047';
  const badgeColor = palette === 'amber' ? '#92400e' : '#854d0e';
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: '0.5rem',
        padding: '0.45rem 0.5rem',
        borderRadius: '0.45rem',
        backgroundColor: bg,
        border: `1px solid ${border}`,
      }}
    >
      <UserCircle size={18} color={badgeColor} style={{ flexShrink: 0, marginTop: '1px' }} />
      <div style={{ minWidth: 0 }}>
        <p style={{ fontSize: '0.8125rem', fontWeight: '600', color: '#111827', margin: '0 0 0.12rem 0', lineHeight: 1.35 }}>
          {hr.fullName || 'HR'}
        </p>
        <p style={{ fontSize: '0.68rem', fontWeight: '700', color: badgeColor, margin: '0 0 0.15rem 0', letterSpacing: '0.03em' }}>
          HR · interview attendee
        </p>
      </div>
    </div>
  );
}

export default function InterviewScheduling() {
  const [committees, setCommittees] = useState<Committee[]>([]);
  const [reqStatusById, setReqStatusById] = useState<Map<string, string>>(() => new Map());
  const [loading, setLoading]       = useState(true);
  const [schedulingId, setSchedulingId] = useState<string | null>(null);
  const [form, setForm] = useState<ScheduleForm>({
    date: '', time: '', duration: '60', interviewerIds: new Set(), meetingLink: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);
  const [copied, setCopied]         = useState(false);
  const [modalCandidatesExpanded, setModalCandidatesExpanded] = useState(false);

  useEffect(() => {
    let reqLoaded = false;
    let comLoaded = false;

    const rebuild = () => {
      if (!reqLoaded || !comLoaded) return;
      setLoading(false);
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
        rebuild();
      },
      e => { console.error(e); setLoading(false); }
    );

    const comUnsub = onSnapshot(
      collection(db, 'committees'),
      snap => {
        setCommittees(snap.docs.map(d => {
          const r = d.data();
          return {
            id:                    d.id,
            requisitionId:        (r.requisitionId        as string)               ?? '',
            title:                getRequisitionPositionTitle(r as Record<string, unknown>),
            department:           (r.department           as string)               ?? '-',
            status:               (r.status               as string)               ?? 'Active',
            interviewers:         (r.interviewers         as CommitteeMember[])    ?? [],
            candidates:           (r.candidates           as CommitteeCandidate[]) ?? [],
            scheduledDate:         r.scheduledDate         as string | undefined,
            scheduledTime:         r.scheduledTime         as string | undefined,
            duration:              r.duration              as string | undefined,
            meetingLink:           r.meetingLink           as string | undefined,
            confirmedInterviewers:(r.confirmedInterviewers as CommitteeMember[] | undefined),
            scheduleApprovedByIds:(r.scheduleApprovedByIds as string[] | undefined),
            sessionHrAttendee: normalizeInterviewSessionHrAttendee(r.sessionHrAttendee),
          };
        }));
        comLoaded = true;
        rebuild();
      },
      e => { console.error(e); setLoading(false); }
    );

    return () => { reqUnsub(); comUnsub(); };
  }, []);

  const { pendingProposal, awaitingCommitteeApproval, scheduled, completed } = useMemo(() => {
    const st = (reqId: string) => reqStatusById.get(reqId) ?? 'Pending HR';
    const isHrScheduling = (reqId: string) => st(reqId) === 'Pending Scheduling';
    const isPostSchedule = (reqId: string) => st(reqId) === 'Interviewing' || st(reqId) === 'Under Evaluation';

    const needProposal = committees.filter(
      c => c.status === 'Active' && c.requisitionId && isHrScheduling(c.requisitionId)
    );
    const awaiting = committees.filter(
      c =>
        isAwaitingChairScheduleApproval(c.status) &&
        c.requisitionId &&
        isHrScheduling(c.requisitionId)
    );
    const sched = committees.filter(
      c => c.status === 'Scheduled' && c.requisitionId && isPostSchedule(c.requisitionId)
    );
    const comp = committees.filter(
      c => c.status === 'Completed' && c.requisitionId && isPostSchedule(c.requisitionId)
    );
    return {
      pendingProposal: needProposal,
      awaitingCommitteeApproval: awaiting,
      scheduled: sched,
      completed: comp,
    };
  }, [committees, reqStatusById]);

  const activeCommittee = committees.find(c => c.id === schedulingId) ?? null;

  const openModal = (c: Committee) => {
    setSchedulingId(c.id);
    const confirmedIds = (c.confirmedInterviewers ?? c.interviewers).map(iv => iv.id);
    setForm({
      date:           c.scheduledDate ?? '',
      time:           c.scheduledTime ?? '',
      duration:       c.duration      ?? '60',
      interviewerIds: new Set(confirmedIds.length > 0 ? confirmedIds : c.interviewers.map(iv => iv.id)),
      meetingLink:    c.meetingLink   ?? '',
    });
    setModalError(null);
    setCopied(false);
    setModalCandidatesExpanded(false);
  };

  const closeModal = () => { setSchedulingId(null); setModalError(null); };

  const toggleInterviewer = (id: string) => setForm(prev => {
    const next = new Set(prev.interviewerIds);
    next.has(id) ? next.delete(id) : next.add(id);
    return { ...prev, interviewerIds: next };
  });

  /** HR proposes date/time/link; Chair approves before status becomes Scheduled. */
  const handleSubmitProposal = async () => {
    if (!schedulingId || !form.date || !form.time || !form.meetingLink || !activeCommittee) return;
    setSubmitting(true);
    setModalError(null);
    try {
      const confirmed = activeCommittee.interviewers.filter(iv => form.interviewerIds.has(iv.id));
      const sess = getSession();
      const sessionHrAttendee = normalizeInterviewSessionHrAttendee({
        email: (sess?.email ?? '').trim(),
        fullName: (sess?.fullName ?? '').trim(),
      });

      await updateDoc(doc(db, 'committees', schedulingId), {
        status: COMMITTEE_STATUS_PENDING_CHAIR_APPROVAL,
        scheduledDate: form.date,
        scheduledTime: form.time,
        duration: form.duration,
        meetingLink: form.meetingLink,
        confirmedInterviewers: confirmed,
        scheduleApprovedByIds: [],
        ...(sessionHrAttendee ? { sessionHrAttendee } : {}),
      });

      closeModal();
    } catch (e) {
      console.error(e);
      setModalError('Failed to submit proposal. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const copyLink = (link: string) => {
    navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const canSchedule = !!form.date && !!form.time && !!form.meetingLink && form.interviewerIds.size > 0;

  const sectionHeader = (label: string, count: number, color: string) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '1rem' }}>
      <h2 style={{ fontSize: '1rem', fontWeight: '700', color: '#111827' }}>{label}</h2>
      <span style={{ backgroundColor: color, color: 'white', fontSize: '0.75rem', fontWeight: '700', padding: '0.15rem 0.55rem', borderRadius: '999px' }}>{count}</span>
    </div>
  );

  return (
    <HRLayout>
      {/* ── Scheduling modal ── */}
      {schedulingId && activeCommittee && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '1rem' }}>
          <div style={{ backgroundColor: 'white', borderRadius: '1rem', padding: '1.35rem 1.5rem', width: '100%', maxWidth: '480px', boxShadow: '0 10px 40px rgba(0,0,0,0.2)', maxHeight: '85vh', overflowY: 'auto', boxSizing: 'border-box' }}>

            {/* Modal header */}
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '0.75rem', marginBottom: '1.15rem', paddingBottom: '1rem', borderBottom: '1px solid #f1f5f9' }}>
              <div style={{ minWidth: 0 }}>
                <p style={{ fontSize: '1.05rem', fontWeight: '700', color: '#111827', margin: '0 0 0.35rem 0' }}>Propose interview time</p>
                <p style={{ fontSize: '0.76rem', color: '#64748b', margin: '0 0 0.6rem 0', lineHeight: 1.45 }}>
                  The Department Chair approves on behalf of the committee. Interviewers only see this after it is Scheduled.
                </p>
                <p style={{ fontSize: '0.8125rem', fontWeight: '600', color: '#334155', margin: 0 }}>{activeCommittee.title}</p>
                <p style={{ fontSize: '0.72rem', color: '#94a3b8', margin: '0.2rem 0 0 0' }}>
                  {activeCommittee.department} · <span style={{ fontFamily: 'ui-monospace, monospace' }}>{activeCommittee.requisitionId}</span>
                </p>
              </div>
              <button type="button" onClick={closeModal} aria-label="Close" style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', padding: '0.25rem', flexShrink: 0 }}>
                <X size={20} />
              </button>
            </div>

            <p style={{ fontSize: '0.68rem', fontWeight: '700', color: '#64748b', letterSpacing: '0.06em', textTransform: 'uppercase', margin: '0 0 0.45rem 0' }}>When</p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem', marginBottom: '0.6rem' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.72rem', color: '#64748b', marginBottom: '0.25rem' }}>Date</label>
                <input type="date" value={form.date} onChange={e => setForm(p => ({ ...p, date: e.target.value }))}
                  style={{ width: '100%', padding: '0.5rem 0.65rem', border: `1.5px solid ${form.date ? '#002147' : '#e2e8f0'}`, borderRadius: '0.45rem', fontSize: '0.8125rem', outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' }} />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.72rem', color: '#64748b', marginBottom: '0.25rem' }}>Time</label>
                <input type="time" value={form.time} onChange={e => setForm(p => ({ ...p, time: e.target.value }))}
                  style={{ width: '100%', padding: '0.5rem 0.65rem', border: `1.5px solid ${form.time ? '#002147' : '#e2e8f0'}`, borderRadius: '0.45rem', fontSize: '0.8125rem', outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' }} />
              </div>
            </div>
            <div style={{ marginBottom: '1rem' }}>
              <label style={{ display: 'block', fontSize: '0.72rem', color: '#64748b', marginBottom: '0.25rem' }}>Duration</label>
              <select value={form.duration} onChange={e => setForm(p => ({ ...p, duration: e.target.value }))}
                style={{ width: '100%', padding: '0.5rem 0.65rem', border: '1.5px solid #e2e8f0', borderRadius: '0.45rem', fontSize: '0.8125rem', color: '#334155', outline: 'none', fontFamily: 'inherit', cursor: 'pointer', boxSizing: 'border-box' }}>
                <option value="30">30 minutes</option>
                <option value="60">60 minutes</option>
                <option value="90">90 minutes</option>
                <option value="120">120 minutes</option>
              </select>
            </div>

            <p style={{ fontSize: '0.68rem', fontWeight: '700', color: '#64748b', letterSpacing: '0.06em', textTransform: 'uppercase', margin: '0 0 0.45rem 0' }}>Meeting link</p>
            <div style={{ display: 'flex', gap: '0.45rem', marginBottom: '0.35rem' }}>
              <input
                type="text"
                placeholder="Paste or generate a Teams link…"
                value={form.meetingLink}
                onChange={e => setForm(p => ({ ...p, meetingLink: e.target.value }))}
                style={{ flex: 1, minWidth: 0, padding: '0.5rem 0.65rem', border: `1.5px solid ${form.meetingLink ? '#002147' : '#e2e8f0'}`, borderRadius: '0.45rem', fontSize: '0.78rem', outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' }}
              />
              <button
                type="button"
                onClick={() => setForm(p => ({ ...p, meetingLink: generateTeamsLink() }))}
                style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', padding: '0.5rem 0.85rem', backgroundColor: '#002147', color: 'white', border: 'none', borderRadius: '0.45rem', fontSize: '0.78rem', fontWeight: '600', cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap', flexShrink: 0 }}
                onMouseEnter={e => { e.currentTarget.style.backgroundColor = '#003366'; }}
                onMouseLeave={e => { e.currentTarget.style.backgroundColor = '#002147'; }}
              >
                Generate
              </button>
            </div>
            <p style={{ fontSize: '0.72rem', color: '#94a3b8', margin: '0 0 1rem 0', lineHeight: 1.4 }}>
              Generate fills a placeholder Teams URL, or paste your own.
            </p>

            <p style={{ fontSize: '0.68rem', fontWeight: '700', color: '#64748b', letterSpacing: '0.06em', textTransform: 'uppercase', margin: '0 0 0.45rem 0' }}>Interviewers (confirm attendees)</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', marginBottom: '1rem' }}>
              {activeCommittee.interviewers.map(iv => {
                const checked = form.interviewerIds.has(iv.id);
                return (
                  <div key={iv.id} onClick={() => toggleInterviewer(iv.id)}
                    style={{ display: 'flex', alignItems: 'flex-start', gap: '0.55rem', padding: '0.5rem 0.65rem', border: `1px solid ${checked ? '#002147' : '#e2e8f0'}`, borderRadius: '0.45rem', cursor: 'pointer', backgroundColor: checked ? '#f0f4ff' : '#fafafa' }}>
                    <input type="checkbox" checked={checked} onChange={() => toggleInterviewer(iv.id)} onClick={e => e.stopPropagation()}
                      style={{ width: '15px', height: '15px', accentColor: '#002147', cursor: 'pointer', flexShrink: 0, marginTop: '2px' }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontSize: '0.8125rem', fontWeight: '600', color: '#0f172a', margin: '0 0 0.15rem 0' }}>{iv.name}</p>
                      <p style={{ fontSize: '0.72rem', color: '#64748b', margin: 0 }}>{iv.title} · {iv.department}</p>
                    </div>
                  </div>
                );
              })}
            </div>

            <div style={{ backgroundColor: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '0.5rem', padding: '0.65rem 0.75rem', marginBottom: '1.15rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem', flexWrap: 'wrap', marginBottom: (modalCandidatesExpanded || activeCommittee.candidates.length === 0) ? 0 : '0.35rem' }}>
                <p style={{ fontSize: '0.68rem', fontWeight: '700', color: '#64748b', letterSpacing: '0.06em', textTransform: 'uppercase', margin: 0 }}>
                  Candidates · {activeCommittee.candidates.length}
                </p>
                {activeCommittee.candidates.length > 3 && (
                  <button
                    type="button"
                    onClick={() => setModalCandidatesExpanded(v => !v)}
                    style={{ border: 'none', background: 'none', color: '#002147', fontSize: '0.72rem', fontWeight: '600', cursor: 'pointer', fontFamily: 'inherit', padding: '0.15rem 0' }}
                  >
                    {modalCandidatesExpanded ? 'Show less' : 'Show all'}
                  </button>
                )}
              </div>
              {activeCommittee.candidates.length === 0 ? (
                <p style={{ fontSize: '0.78rem', color: '#94a3b8', margin: 0 }}>No candidates on this committee.</p>
              ) : modalCandidatesExpanded ? (
                <div style={{ maxHeight: '140px', overflowY: 'auto', paddingRight: '0.25rem' }}>
                  <ul style={{ margin: '0.35rem 0 0 0', paddingLeft: '1.1rem', fontSize: '0.76rem', color: '#475569', lineHeight: 1.45 }}>
                    {activeCommittee.candidates.map(c => (
                      <li key={c.id} style={{ marginBottom: '0.15rem' }}>{c.name}</li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p style={{ fontSize: '0.78rem', color: '#475569', margin: activeCommittee.candidates.length > 3 ? '0.35rem 0 0 0' : '0', lineHeight: 1.45 }}>
                  {activeCommittee.candidates.length <= 3
                    ? activeCommittee.candidates.map(c => c.name).join(', ')
                    : `${activeCommittee.candidates.slice(0, 3).map(c => c.name).join(', ')} + ${activeCommittee.candidates.length - 3} more`}
                </p>
              )}
            </div>

            {modalError && (
              <p style={{ color: '#dc2626', fontSize: '0.8rem', marginBottom: '0.85rem', padding: '0.55rem 0.75rem', backgroundColor: '#fef2f2', borderRadius: '0.45rem', border: '1px solid #fecaca' }}>
                {modalError}
              </p>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.65rem', paddingTop: '0.85rem', borderTop: '1px solid #f1f5f9' }}>
              <button type="button" onClick={closeModal}
                style={{ padding: '0.55rem 1.1rem', background: 'white', border: '1px solid #e2e8f0', borderRadius: '0.45rem', color: '#475569', fontSize: '0.8125rem', cursor: 'pointer', fontFamily: 'inherit' }}>
                Cancel
              </button>
              <button type="button" disabled={!canSchedule || submitting} onClick={handleSubmitProposal}
                style={{ padding: '0.55rem 1.15rem', backgroundColor: canSchedule && !submitting ? '#002147' : '#94a3b8', color: 'white', border: 'none', borderRadius: '0.45rem', fontSize: '0.8125rem', fontWeight: '600', cursor: canSchedule && !submitting ? 'pointer' : 'not-allowed', fontFamily: 'inherit' }}
                onMouseEnter={e => { if (canSchedule && !submitting) e.currentTarget.style.backgroundColor = '#003366'; }}
                onMouseLeave={e => { if (canSchedule && !submitting) e.currentTarget.style.backgroundColor = '#002147'; }}>
                {submitting ? 'Submitting…' : 'Submit proposal'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Page ── */}
      <h1 style={{ fontSize: '1.6rem', fontWeight: '700', color: '#111827', marginBottom: '0.25rem' }}>Interview Scheduling</h1>
      <p style={{ color: '#6b7280', fontSize: '0.9rem', marginBottom: '1.5rem' }}>
        Propose interview times for committees. The Department Chair confirms availability before interviews become Scheduled and visible to interviewers.
      </p>

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(168px, 1fr))', gap: '1rem', marginBottom: '2rem' }}>
        {[
          ['Needs HR proposal', pendingProposal.length, '#fef9c3', '#92400e'],
          ['Awaiting chair approval', awaitingCommitteeApproval.length, '#ffedd5', '#c2410c'],
          ['Scheduled (confirmed)', scheduled.length, '#dbeafe', '#1d4ed8'],
          ['Completed', completed.length, '#dcfce7', '#15803d'],
        ].map(([label, val, bg, color]) => (
          <div key={label as string} style={{ backgroundColor: 'white', borderRadius: '0.75rem', padding: '1.25rem', boxShadow: '0 1px 3px rgba(0,0,0,0.07)', display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <div style={{ width: '40px', height: '40px', borderRadius: '0.5rem', backgroundColor: bg as string, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              {label === 'Needs HR proposal' ? <CalendarDays size={18} color={color as string} /> :
               label === 'Awaiting chair approval' ? <Users size={18} color={color as string} /> :
               label === 'Scheduled (confirmed)' ? <Clock size={18} color={color as string} /> :
                                                <CheckCircle size={18} color={color as string} />}
            </div>
            <div>
              <p style={{ fontSize: '0.8rem', color: '#6b7280', marginBottom: '0.15rem', lineHeight: 1.3 }}>{label}</p>
              <p style={{ fontSize: '1.6rem', fontWeight: '700', color: '#111827', lineHeight: 1 }}>{val}</p>
            </div>
          </div>
        ))}
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '3rem', color: '#6b7280' }}>Loading committees…</div>
      ) : (
        <>
          {/* ── Needs HR proposal ── */}
          {sectionHeader('Needs HR proposal', pendingProposal.length, '#92400e')}
          {pendingProposal.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '2rem', color: '#9ca3af', backgroundColor: 'white', borderRadius: '0.875rem', boxShadow: '0 1px 3px rgba(0,0,0,0.07)', marginBottom: '2rem', fontSize: '0.9rem' }}>
              No committees need an initial time proposal right now.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginBottom: '2rem' }}>
              {pendingProposal.map(c => (
                <div key={c.id} style={{ backgroundColor: 'white', borderRadius: '0.875rem', padding: '1.5rem', boxShadow: '0 1px 3px rgba(0,0,0,0.07)', border: '1px solid #f1f5f9' }}>
                  <div style={{ marginBottom: '1rem', paddingBottom: '1rem', borderBottom: '1px solid #f1f5f9' }}>
                    <h3 style={{ fontSize: '1.05rem', fontWeight: '700', color: '#111827', margin: '0 0 0.35rem 0' }}>{c.title}</h3>
                    <p style={{ fontSize: '0.82rem', color: '#64748b', margin: '0 0 0.15rem 0' }}>{c.department}</p>
                    <p style={{ fontSize: '0.75rem', color: '#94a3b8', fontFamily: 'ui-monospace, monospace', margin: 0 }}>{c.requisitionId}</p>
                  </div>

                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1.25rem', alignItems: 'stretch' }}>
                    <div style={{ flex: '1 1 280px', minWidth: 0 }}>
                      <p style={{ fontSize: '0.72rem', fontWeight: '700', color: '#64748b', marginBottom: '0.55rem', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                        Candidates <span style={{ fontWeight: '600', color: '#94a3b8' }}>({c.candidates.length})</span>
                      </p>
                      <div
                        style={{
                          maxHeight: 'min(340px, 50vh)',
                          overflowY: 'auto',
                          padding: '0.6rem',
                          borderRadius: '0.625rem',
                          border: '1px solid #e2e8f0',
                          backgroundColor: '#f8fafc',
                          boxSizing: 'border-box',
                        }}
                      >
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))', gap: '0.5rem' }}>
                          {c.candidates.map(cand => (
                            <div
                              key={cand.id}
                              style={{
                                padding: '0.55rem 0.65rem',
                                borderRadius: '0.5rem',
                                backgroundColor: 'white',
                                border: '1px solid #e2e8f0',
                              }}
                            >
                              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem' }}>
                                <UserCircle size={20} color="#94a3b8" style={{ flexShrink: 0, marginTop: '1px' }} />
                                <div style={{ minWidth: 0 }}>
                                  <p style={{ fontSize: '0.8125rem', fontWeight: '600', color: '#0f172a', margin: '0 0 0.2rem 0', lineHeight: 1.35 }}>{cand.name}</p>
                                  <p style={{ fontSize: '0.72rem', color: '#64748b', margin: 0, lineHeight: 1.45 }}>{cand.position}</p>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>

                    <div style={{ flex: '0 1 252px', minWidth: '220px', display: 'flex', flexDirection: 'column' }}>
                      <p style={{ fontSize: '0.72rem', fontWeight: '700', color: '#64748b', marginBottom: '0.55rem', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                        Committee <span style={{ fontWeight: '600', color: '#94a3b8' }}>({c.interviewers.length})</span>
                      </p>
                      <div
                        style={{
                          flex: 1,
                          padding: '0.65rem',
                          borderRadius: '0.625rem',
                          border: '1px solid #e2e8f0',
                          backgroundColor: '#fff',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '0.45rem',
                          boxSizing: 'border-box',
                        }}
                      >
                        {c.interviewers.map(iv => (
                          <div
                            key={iv.id}
                            style={{
                              display: 'flex',
                              alignItems: 'flex-start',
                              gap: '0.5rem',
                              padding: '0.45rem 0.5rem',
                              borderRadius: '0.45rem',
                              backgroundColor: '#f0f4ff',
                              border: '1px solid #dbeafe',
                            }}
                          >
                            <UserCircle size={18} color="#002147" style={{ flexShrink: 0, marginTop: '1px' }} />
                            <div style={{ minWidth: 0 }}>
                              <p style={{ fontSize: '0.8125rem', fontWeight: '600', color: '#111827', margin: '0 0 0.12rem 0', lineHeight: 1.35 }}>{iv.name}</p>
                              <p style={{ fontSize: '0.72rem', color: '#64748b', margin: 0, lineHeight: 1.4 }}>{iv.title}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: '1.1rem', marginTop: '1.1rem', borderTop: '1px solid #f1f5f9' }}>
                    <button
                      type="button"
                      onClick={() => openModal(c)}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '0.45rem',
                        padding: '0.65rem 1.35rem',
                        backgroundColor: '#002147',
                        color: 'white',
                        border: 'none',
                        borderRadius: '0.5rem',
                        fontSize: '0.875rem',
                        fontWeight: '600',
                        cursor: 'pointer',
                        fontFamily: 'inherit',
                      }}
                      onMouseEnter={e => { e.currentTarget.style.backgroundColor = '#003366'; }}
                      onMouseLeave={e => { e.currentTarget.style.backgroundColor = '#002147'; }}
                    >
                      <CalendarDays size={16} strokeWidth={2.25} />
                      Propose interview time
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* ── Awaiting chair approval ── */}
          {sectionHeader('Awaiting chair approval', awaitingCommitteeApproval.length, '#c2410c')}
          {awaitingCommitteeApproval.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '2rem', color: '#9ca3af', backgroundColor: 'white', borderRadius: '0.875rem', boxShadow: '0 1px 3px rgba(0,0,0,0.07)', marginBottom: '2rem', fontSize: '0.9rem' }}>
              No proposals awaiting the Chair right now.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginBottom: '2rem' }}>
              {awaitingCommitteeApproval.map(c => (
                  <div key={c.id} style={{ backgroundColor: 'white', borderRadius: '0.875rem', padding: '1.5rem', boxShadow: '0 1px 3px rgba(0,0,0,0.07)', border: '1px solid #ffedd5' }}>
                    <div style={{ marginBottom: '1rem', paddingBottom: '1rem', borderBottom: '1px solid #f1f5f9' }}>
                      <p style={{ fontSize: '0.68rem', fontWeight: '700', color: '#c2410c', letterSpacing: '0.06em', marginBottom: '0.35rem' }}>PENDING CHAIR SCHEDULE APPROVAL</p>
                      <h3 style={{ fontSize: '1.05rem', fontWeight: '700', color: '#111827', margin: '0 0 0.35rem 0' }}>{c.title}</h3>
                      <p style={{ fontSize: '0.82rem', color: '#64748b', margin: '0 0 0.15rem 0' }}>{c.department}</p>
                      <p style={{ fontSize: '0.75rem', color: '#94a3b8', fontFamily: 'ui-monospace, monospace', margin: 0 }}>{c.requisitionId}</p>
                    </div>

                    <div style={{ marginBottom: '1rem', padding: '0.75rem 0.9rem', backgroundColor: '#fffbeb', border: '1px solid #fde68a', borderRadius: '0.5rem' }}>
                      <p style={{ fontSize: '0.72rem', fontWeight: '700', color: '#92400e', marginBottom: '0.35rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Proposed slot</p>
                      <p style={{ fontSize: '0.84rem', color: '#78350f', margin: 0, lineHeight: 1.5 }}>
                        {formatDate(c.scheduledDate ?? '')} · {c.scheduledTime ?? '—'} · {c.duration ?? '—'} min
                        <span style={{ display: 'block', marginTop: '0.35rem', fontSize: '0.8rem', color: '#a16207' }}>
                          Status on committee: Pending Chair Schedule Approval — the Department Chair approves under Chair → Schedule Approvals.
                        </span>
                      </p>
                    </div>

                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1.25rem', alignItems: 'stretch' }}>
                      <div style={{ flex: '1 1 280px', minWidth: 0 }}>
                        <p style={{ fontSize: '0.72rem', fontWeight: '700', color: '#64748b', marginBottom: '0.55rem', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                          Candidates <span style={{ fontWeight: '600', color: '#94a3b8' }}>({c.candidates.length})</span>
                        </p>
                        <div style={{ maxHeight: 'min(280px, 45vh)', overflowY: 'auto', padding: '0.6rem', borderRadius: '0.625rem', border: '1px solid #e2e8f0', backgroundColor: '#f8fafc', boxSizing: 'border-box' }}>
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))', gap: '0.5rem' }}>
                            {c.candidates.map(cand => (
                              <div key={cand.id} style={{ padding: '0.55rem 0.65rem', borderRadius: '0.5rem', backgroundColor: 'white', border: '1px solid #e2e8f0' }}>
                                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem' }}>
                                  <UserCircle size={20} color="#94a3b8" style={{ flexShrink: 0, marginTop: '1px' }} />
                                  <div style={{ minWidth: 0 }}>
                                    <p style={{ fontSize: '0.8125rem', fontWeight: '600', color: '#0f172a', margin: '0 0 0.2rem 0', lineHeight: 1.35 }}>{cand.name}</p>
                                    <p style={{ fontSize: '0.72rem', color: '#64748b', margin: 0, lineHeight: 1.45 }}>{cand.position}</p>
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                      <div style={{ flex: '0 1 252px', minWidth: '220px', display: 'flex', flexDirection: 'column' }}>
                        <p style={{ fontSize: '0.72rem', fontWeight: '700', color: '#64748b', marginBottom: '0.55rem', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                          Interview attendees <span style={{ fontWeight: '600', color: '#94a3b8' }}>({(c.confirmedInterviewers ?? c.interviewers).length + (c.sessionHrAttendee ? 1 : 0)})</span>
                        </p>
                        <p style={{ fontSize: '0.72rem', color: '#64748b', margin: '0 0 0.5rem 0', lineHeight: 1.45 }}>
                          HR has confirmed these attendees for the slot. Individual logins are not required to approve the time—the Chair approves once for the committee.
                        </p>
                        <div style={{ flex: 1, padding: '0.65rem', borderRadius: '0.625rem', border: '1px solid #e2e8f0', backgroundColor: '#fafafa', display: 'flex', flexDirection: 'column', gap: '0.45rem', boxSizing: 'border-box' }}>
                          {(c.confirmedInterviewers ?? c.interviewers).map(iv => (
                              <div
                                key={iv.id}
                                style={{
                                  display: 'flex',
                                  alignItems: 'flex-start',
                                  gap: '0.5rem',
                                  padding: '0.45rem 0.5rem',
                                  borderRadius: '0.45rem',
                                  backgroundColor: '#fff',
                                  border: '1px solid #e2e8f0',
                                }}
                              >
                                <UserCircle size={18} color="#64748b" style={{ flexShrink: 0, marginTop: '1px' }} />
                                <div style={{ minWidth: 0 }}>
                                  <p style={{ fontSize: '0.8125rem', fontWeight: '600', color: '#111827', margin: 0, lineHeight: 1.35 }}>{iv.name}</p>
                                  {iv.title ? <p style={{ fontSize: '0.72rem', color: '#64748b', margin: '0.12rem 0 0 0' }}>{iv.title}</p> : null}
                                </div>
                              </div>
                            ))}
                          <HrInterviewSessionAttendeeRow attendee={c.sessionHrAttendee} palette="amber" />
                        </div>
                      </div>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: '1.1rem', marginTop: '1.1rem', borderTop: '1px solid #f1f5f9' }}>
                      <button
                        type="button"
                        onClick={() => openModal(c)}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '0.45rem',
                          padding: '0.65rem 1.35rem',
                          backgroundColor: 'white',
                          color: '#374151',
                          border: '1px solid #d1d5db',
                          borderRadius: '0.5rem',
                          fontSize: '0.875rem',
                          fontWeight: '600',
                          cursor: 'pointer',
                          fontFamily: 'inherit',
                        }}
                        onMouseEnter={e => { e.currentTarget.style.backgroundColor = '#f9fafb'; }}
                        onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'white'; }}
                      >
                        Edit proposal (await new chair approval)
                      </button>
                    </div>
                  </div>
              ))}
            </div>
          )}

          {/* ── Scheduled Interviews ── */}
          {sectionHeader('Scheduled Interviews', scheduled.length, '#1d4ed8')}
          {scheduled.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '2rem', color: '#9ca3af', backgroundColor: 'white', borderRadius: '0.875rem', boxShadow: '0 1px 3px rgba(0,0,0,0.07)', fontSize: '0.9rem' }}>
              No confirmed interviews yet. These appear after the Department Chair approves HR’s proposed time.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {scheduled.map(c => (
                <div key={c.id} style={{ backgroundColor: 'white', borderRadius: '0.875rem', padding: '1.5rem', boxShadow: '0 1px 3px rgba(0,0,0,0.07)' }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '1rem' }}>
                    <div>
                      <h3 style={{ fontSize: '1rem', fontWeight: '700', color: '#111827', margin: '0 0 0.2rem 0' }}>{c.title}</h3>
                      <p style={{ fontSize: '0.82rem', color: '#6b7280' }}>Department: {c.department}</p>
                      <p style={{ fontSize: '0.75rem', color: '#9ca3af' }}>{c.requisitionId}</p>
                    </div>
                  </div>

                  {/* Schedule info */}
                  <div style={{ backgroundColor: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '0.625rem', padding: '0.875rem 1rem', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '1.5rem', flexWrap: 'wrap' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                      <CalendarDays size={15} color="#1d4ed8" />
                      <span style={{ fontSize: '0.875rem', fontWeight: '600', color: '#1d4ed8' }}>{formatDate(c.scheduledDate ?? '')}</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                      <Clock size={15} color="#1d4ed8" />
                      <span style={{ fontSize: '0.875rem', fontWeight: '600', color: '#1d4ed8' }}>{c.scheduledTime}</span>
                    </div>
                    <span style={{ fontSize: '0.82rem', color: '#374151' }}>{c.duration} min</span>
                    {c.meetingLink && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginLeft: 'auto' }}>
                        <a href={c.meetingLink} target="_blank" rel="noreferrer"
                          style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', padding: '0.4rem 0.875rem', backgroundColor: '#002147', color: 'white', borderRadius: '0.4rem', fontSize: '0.8rem', fontWeight: '600', textDecoration: 'none' }}>
                          <Video size={13} /> Join Meeting
                        </a>
                        <button onClick={() => copyLink(c.meetingLink!)}
                          style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', padding: '0.4rem 0.75rem', background: 'white', border: '1px solid #d1d5db', borderRadius: '0.4rem', color: '#374151', fontSize: '0.8rem', cursor: 'pointer', fontFamily: 'inherit' }}>
                          {copied ? <CheckCircle size={13} color="#16a34a" /> : <Copy size={13} />}
                          {copied ? 'Copied!' : 'Copy Link'}
                        </button>
                      </div>
                    )}
                  </div>

                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1.25rem', alignItems: 'stretch', paddingTop: '1rem', borderTop: '1px solid #f1f5f9' }}>
                    <div style={{ flex: '1 1 280px', minWidth: 0 }}>
                      <p style={{ fontSize: '0.72rem', fontWeight: '700', color: '#64748b', marginBottom: '0.55rem', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                        Candidates <span style={{ fontWeight: '600', color: '#94a3b8' }}>({c.candidates.length})</span>
                      </p>
                      <div style={{ maxHeight: 'min(280px, 45vh)', overflowY: 'auto', padding: '0.6rem', borderRadius: '0.625rem', border: '1px solid #e2e8f0', backgroundColor: '#f8fafc', boxSizing: 'border-box' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))', gap: '0.5rem' }}>
                          {c.candidates.map(cand => (
                            <div key={cand.id} style={{ padding: '0.55rem 0.65rem', borderRadius: '0.5rem', backgroundColor: 'white', border: '1px solid #e2e8f0' }}>
                              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem' }}>
                                <UserCircle size={20} color="#94a3b8" style={{ flexShrink: 0, marginTop: '1px' }} />
                                <div style={{ minWidth: 0 }}>
                                  <p style={{ fontSize: '0.8125rem', fontWeight: '600', color: '#0f172a', margin: '0 0 0.2rem 0', lineHeight: 1.35 }}>{cand.name}</p>
                                  <p style={{ fontSize: '0.72rem', color: '#64748b', margin: 0, lineHeight: 1.45 }}>{cand.position}</p>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                    <div style={{ flex: '0 1 252px', minWidth: '220px', display: 'flex', flexDirection: 'column' }}>
                      <p style={{ fontSize: '0.72rem', fontWeight: '700', color: '#64748b', marginBottom: '0.55rem', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                        Interview attendees <span style={{ fontWeight: '600', color: '#94a3b8' }}>({(c.confirmedInterviewers ?? c.interviewers).length + (c.sessionHrAttendee ? 1 : 0)})</span>
                      </p>
                      <div style={{ flex: 1, padding: '0.65rem', borderRadius: '0.625rem', border: '1px solid #e2e8f0', backgroundColor: '#fff', display: 'flex', flexDirection: 'column', gap: '0.45rem', boxSizing: 'border-box' }}>
                        {(c.confirmedInterviewers ?? c.interviewers).map(iv => (
                          <div key={iv.id} style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem', padding: '0.45rem 0.5rem', borderRadius: '0.45rem', backgroundColor: '#eff6ff', border: '1px solid #bfdbfe' }}>
                            <UserCircle size={18} color="#002147" style={{ flexShrink: 0, marginTop: '1px' }} />
                            <div style={{ minWidth: 0 }}>
                              <p style={{ fontSize: '0.8125rem', fontWeight: '600', color: '#111827', margin: '0 0 0.12rem 0', lineHeight: 1.35 }}>{iv.name}</p>
                              <p style={{ fontSize: '0.72rem', color: '#64748b', margin: 0, lineHeight: 1.4 }}>{iv.title}</p>
                            </div>
                          </div>
                        ))}
                        <HrInterviewSessionAttendeeRow attendee={c.sessionHrAttendee} palette="blue" />
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </HRLayout>
  );
}
