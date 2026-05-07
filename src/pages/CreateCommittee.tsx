import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { UserCircle } from 'lucide-react';
import { ChairLayout } from '../components/ChairLayout';
import { collection, getDocs, doc, getDoc, writeBatch, serverTimestamp, type QueryDocumentSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { normalizeRequisitionStatus, workflowStageFromStatus } from '../utils/requisitionWorkflow';
import { getRequisitionPositionTitle } from '../utils/requisitionFields';
import { getSession } from '../utils/session';

function normReq(s: string): string { return normalizeRequisitionStatus(s); }

/** Create Committee is only for requisitions in the Chair's assignment stage. */
const CHAIR_REQ_STATUSES = new Set(['With Chair']);

function isDeanForwardedCandidate(raw: Record<string, unknown>): boolean {
  const st = (raw.status as string) ?? '';
  if (!['Shortlisted', 'Interviewed'].includes(st)) return false;
  if ((raw.forwardedToChair as boolean) === true) return true;
  const note = ((raw.deanNote as string) ?? '').trim();
  return note.length > 0;
}

/** Matches per-requisition load: Dean-sent candidates only. */
function totalSentByDeanForReq(candDocs: QueryDocumentSnapshot[], reqId: string): number {
  return candDocs.filter(
    d =>
      (d.data().requisitionId as string) === reqId &&
      isDeanForwardedCandidate(d.data() as Record<string, unknown>)
  ).length;
}

function hasCommitteeForRequisition(commDocs: QueryDocumentSnapshot[], reqId: string): boolean {
  return commDocs.some(d => (d.data().requisitionId as string) === reqId);
}
interface RequisitionOption {
  id: string;
  title: string;
  department: string;
}

interface RequisitionInfo {
  title: string;
  department: string;
  status: string;
}

interface Candidate {
  id: string;
  name: string;
  edu: string;
  exp: string;
  position: string;
  deanNote: string;
}

interface Interviewer {
  id: string;
  name: string;
  email: string;
  department: string;
  title: string;
}

export default function CreateCommittee() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  // Requisition dropdown
  const [requisitions, setRequisitions]   = useState<RequisitionOption[]>([]);
  const [loadingReqs, setLoadingReqs]     = useState(true);

  // Selected requisition (seeded from URL param if present)
  const [selectedReqId, setSelectedReqId] = useState(searchParams.get('reqId') ?? '');
  const [reqInfo, setReqInfo]             = useState<RequisitionInfo | null>(null);
  const [candidates, setCandidates]       = useState<Candidate[]>([]);
  const [committeeExists, setCommitteeExists] = useState(false);
  const [loadingDetails, setLoadingDetails] = useState(false);

  // Interviewers (loaded once, not per-requisition)
  const [interviewers, setInterviewers]   = useState<Interviewer[]>([]);

  // Selection state (interviewers only — all listed candidates are always assigned)
  const [selectedInterviewers, setSelectedInterviewers] = useState<Set<string>>(new Set());

  // Action state
  const [creating, setCreating] = useState(false);
  const [created, setCreated]   = useState(false);
  const [error, setError]       = useState<string | null>(null);

  const [confirmOpen, setConfirmOpen]   = useState(false);
  const [modalComment, setModalComment] = useState('');
  const [modalError, setModalError]     = useState<string | null>(null);

  // ── Load dropdown options + interviewers once on mount ────────────────────
  useEffect(() => {
    (async () => {
      try {
        const [reqSnap, candSnap, commSnap, ivSnap] = await Promise.all([
          getDocs(collection(db, 'requisitions')),
          getDocs(collection(db, 'candidates')),
          getDocs(collection(db, 'committees')),
          getDocs(collection(db, 'interviewers')),
        ]);

        const options = reqSnap.docs
            .filter(d => CHAIR_REQ_STATUSES.has(d.data().status as string))
            .filter(d => {
              const id = d.id;
              const sent = totalSentByDeanForReq(candSnap.docs, id);
              return sent > 0 && !hasCommitteeForRequisition(commSnap.docs, id);
            })
            .map(d => ({
              id:         d.id,
              title:      getRequisitionPositionTitle(d.data() as Record<string, unknown>),
              department: (d.data().department as string) ?? '-',
            }));
        setRequisitions(options);

        // If URL/query seeded a stale reqId that no longer has dean-forwarded
        // candidates in With Chair, clear it so the page cannot stick on invalid state.
        if (selectedReqId && !options.some(o => o.id === selectedReqId)) {
          setSelectedReqId('');
        }

        setInterviewers(
          ivSnap.docs
            .filter(d => d.data().isActive === true)
            .map(d => ({
              id:         d.id,
              name:       (d.data().name       as string) ?? '-',
              email:      (d.data().email      as string) ?? '-',
              department: (d.data().department as string) ?? '-',
              title:      (d.data().title      as string) ?? '-',
            }))
        );
      } catch (e) {
        console.error(e);
      } finally {
        setLoadingReqs(false);
      }
    })();
  }, []);

  // ── Load details whenever the selected requisition changes ────────────────
  useEffect(() => {
    if (!selectedReqId) {
      setReqInfo(null);
      setCandidates([]);
      return;
    }

    setLoadingDetails(true);
    setReqInfo(null);
    setCandidates([]);
    setCommitteeExists(false);

    (async () => {
      try {
        const [reqSnap, candSnap, committeeSnap] = await Promise.all([
          getDoc(doc(db, 'requisitions', selectedReqId)),
          getDocs(collection(db, 'candidates')),
          getDocs(collection(db, 'committees')),
        ]);

        if (reqSnap.exists()) {
          setReqInfo({
            title:      getRequisitionPositionTitle(reqSnap.data() as Record<string, unknown>),
            department: (reqSnap.data().department as string) ?? '-',
            status:     normReq((reqSnap.data().status as string) ?? 'Pending HR'),
          });
        }

        const exists = hasCommitteeForRequisition(committeeSnap.docs, selectedReqId);
        setCommitteeExists(exists);

        const allDeanApproved: Candidate[] = candSnap.docs
          .filter(d =>
            d.data().requisitionId === selectedReqId &&
            isDeanForwardedCandidate(d.data() as Record<string, unknown>)
          )
          .map(d => ({
            id:       d.id,
            name:     (d.data().full_name        as string) ?? '-',
            edu:      (d.data().degree           as string) ?? '-',
            exp:      d.data().years_experience != null
              ? String(d.data().years_experience) + ' years'
              : '-',
            position: (d.data().position_applied as string) ?? '-',
            deanNote: (d.data().deanNote         as string) ?? '',
          }));

        setCandidates(exists ? [] : allDeanApproved);
      } catch (e) {
        console.error(e);
      } finally {
        setLoadingDetails(false);
      }
    })();
  }, [selectedReqId]);

  const toggleInterviewer = (id: string) => setSelectedInterviewers(prev => {
    const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n;
  });

  const canCreate = !!selectedReqId && candidates.length > 0 && selectedInterviewers.size > 0 && !creating;

  const openConfirmModal = () => {
    if (!canCreate) return;
    setModalComment('');
    setModalError(null);
    setConfirmOpen(true);
  };

  const closeConfirmModal = () => {
    if (creating) return;
    setConfirmOpen(false);
    setModalError(null);
  };

  const handleCreate = async (chairComment: string) => {
    if (!canCreate) return;
    setCreating(true);
    setError(null);
    setModalError(null);
    try {
      const committeeSnap = await getDocs(collection(db, 'committees'));
      if (hasCommitteeForRequisition(committeeSnap.docs, selectedReqId)) {
        setModalError('A committee already exists for this requisition.');
        return;
      }

      const batch = writeBatch(db);

      const committeeRef = doc(collection(db, 'committees'));
      const sess = getSession();
      batch.set(committeeRef, {
        requisitionId: selectedReqId,
        positionTitle: reqInfo?.title      ?? '',
        title:         reqInfo?.title      ?? '',
        position:      reqInfo?.title      ?? '',
        department:    reqInfo?.department ?? '',
        chairEmail:    (sess?.email ?? '').trim(),
        chairName:     (sess?.fullName ?? '').trim(),
        interviewers:  interviewers
          .filter(iv => selectedInterviewers.has(iv.id))
          .map(iv => ({ id: iv.id, name: iv.name, email: iv.email, department: iv.department, title: iv.title })),
        candidates:    candidates.map(c => ({ id: c.id, name: c.name, position: c.position })),
        createdAt: serverTimestamp(),
        status:    'Active',
        chairOverallRating: null,
        chairComment,
      });

      const nextStatus = 'Pending Scheduling';
      batch.update(doc(db, 'requisitions', selectedReqId), {
        chairRating:          null,
        chairComment,
        lastChairCommitteeAt: serverTimestamp(),
        committeeCreated:     true,
        status:               nextStatus,
        workflowStage:        workflowStageFromStatus(nextStatus),
      });

      await batch.commit();
      setConfirmOpen(false);
      setCreated(true);
    } catch (e) {
      console.error(e);
      const msg = 'Failed to create committee. Please try again.';
      setError(msg);
      setModalError(msg);
    } finally {
      setCreating(false);
    }
  };

  const handleConfirmSubmit = () => {
    if (!modalComment.trim()) {
      setModalError('Please add a comment.');
      return;
    }
    void handleCreate(modalComment.trim());
  };

  // ── Success screen ────────────────────────────────────────────────────────
  if (created) {
    return (
      <ChairLayout>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '70vh' }}>
          <div style={{ backgroundColor: 'white', borderRadius: '1rem', padding: '2.5rem 3rem', boxShadow: '0 4px 24px rgba(0,0,0,0.08)', maxWidth: '520px', width: '100%', textAlign: 'center' }}>

            {/* Icon */}
            <div style={{ width: '64px', height: '64px', borderRadius: '50%', backgroundColor: '#dcfce7', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1.25rem' }}>
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>

            {/* Heading */}
            <h2 style={{ fontSize: '1.4rem', fontWeight: '700', color: '#111827', marginBottom: '0.4rem' }}>
              Committee Created Successfully
            </h2>
            <p style={{ fontSize: '0.875rem', color: '#6b7280', marginBottom: '1.25rem', lineHeight: 1.6 }}>
              The interview committee has been formed and candidates have been assigned.
            </p>

            {/* Next-step banner */}
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem', backgroundColor: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '0.75rem', padding: '1rem 1.1rem', marginBottom: '1.5rem', textAlign: 'left' }}>
              <div style={{ width: '32px', height: '32px', borderRadius: '50%', backgroundColor: '#dbeafe', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: '0.05rem' }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#1d4ed8" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                  <line x1="16" y1="2" x2="16" y2="6" />
                  <line x1="8" y1="2" x2="8" y2="6" />
                  <line x1="3" y1="10" x2="21" y2="10" />
                </svg>
              </div>
              <div>
                <p style={{ fontSize: '0.875rem', fontWeight: '700', color: '#1d4ed8', marginBottom: '0.2rem' }}>
                  Sent to HR for Interview Scheduling
                </p>
                <p style={{ fontSize: '0.8rem', color: '#3b82f6', lineHeight: 1.5 }}>
                  This requisition is now marked as <strong>Pending Scheduling</strong>. HR will be notified to set interview dates, times, and meeting links for the assigned candidates and committee members.
                </p>
              </div>
            </div>

            {/* Summary card */}
            <div style={{ backgroundColor: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: '0.75rem', padding: '1.1rem 1.4rem', marginBottom: '1.75rem', textAlign: 'left' }}>
              {reqInfo && (
                <div style={{ marginBottom: '0.85rem', paddingBottom: '0.85rem', borderBottom: '1px solid #e5e7eb' }}>
                  <p style={{ fontSize: '0.72rem', color: '#9ca3af', marginBottom: '0.2rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Requisition</p>
                  <p style={{ fontSize: '0.9rem', fontWeight: '600', color: '#111827' }}>{reqInfo.title}</p>
                  <p style={{ fontSize: '0.8rem', color: '#6b7280' }}>{reqInfo.department} · {selectedReqId}</p>
                </div>
              )}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div>
                  <p style={{ fontSize: '0.72rem', color: '#9ca3af', marginBottom: '0.2rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Candidates Assigned</p>
                  <p style={{ fontSize: '1.25rem', fontWeight: '700', color: '#111827' }}>{candidates.length}</p>
                </div>
                <div>
                  <p style={{ fontSize: '0.72rem', color: '#9ca3af', marginBottom: '0.2rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Committee Members</p>
                  <p style={{ fontSize: '1.25rem', fontWeight: '700', color: '#111827' }}>{selectedInterviewers.size}</p>
                </div>
              </div>
            </div>

            {/* Actions */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <button
                onClick={() => navigate('/chair/evaluations-overview')}
                style={{ width: '100%', padding: '0.7rem 1.5rem', backgroundColor: '#002147', color: 'white', border: 'none', borderRadius: '0.5rem', fontSize: '0.9rem', fontWeight: '600', cursor: 'pointer', fontFamily: 'inherit' }}
                onMouseEnter={e => { e.currentTarget.style.backgroundColor = '#003366'; }}
                onMouseLeave={e => { e.currentTarget.style.backgroundColor = '#002147'; }}
              >
                Go to Evaluations Overview
              </button>
              <button
                onClick={() => navigate('/chair/assigned-requisitions')}
                style={{ width: '100%', padding: '0.7rem 1.5rem', backgroundColor: 'white', color: '#374151', border: '1px solid #d1d5db', borderRadius: '0.5rem', fontSize: '0.9rem', cursor: 'pointer', fontFamily: 'inherit' }}
                onMouseEnter={e => { e.currentTarget.style.backgroundColor = '#f9fafb'; }}
                onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'white'; }}
              >
                Back to Requisitions
              </button>
            </div>
          </div>
        </div>
      </ChairLayout>
    );
  }

  const isViewingOnlyReq =
    Boolean(selectedReqId) && !requisitions.some(r => r.id === selectedReqId);

  // ── Main page ─────────────────────────────────────────────────────────────
  return (
    <ChairLayout>
      <h1 style={{ fontSize: '1.6rem', fontWeight: '700', color: '#111827', marginBottom: '0.25rem' }}>
        Create Interview Committee
      </h1>
      <p style={{ fontSize: '0.9rem', color: '#6b7280', marginBottom: '0.65rem' }}>
        Select a requisition to view its candidates and build the evaluation committee.
      </p>
      <p style={{ fontSize: '0.78rem', color: '#64748b', marginBottom: '1.75rem', lineHeight: 1.45 }}>
        Committee members discuss candidates together. One designated interviewer submits the final evaluation.
      </p>

      {/* ── Requisition selector ── */}
      <div style={{ backgroundColor: 'white', borderRadius: '0.875rem', padding: '1.25rem 1.75rem', boxShadow: '0 1px 3px rgba(0,0,0,0.07)', marginBottom: '1.25rem' }}>
        <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: '600', color: '#374151', marginBottom: '0.5rem' }}>
          Requisition
        </label>
        {loadingReqs ? (
          <p style={{ fontSize: '0.875rem', color: '#9ca3af' }}>Loading requisitions…</p>
        ) : requisitions.length === 0 && !selectedReqId ? (
          <p style={{ fontSize: '0.875rem', color: '#9ca3af' }}>
            No requisitions are awaiting committee formation (each requisition may only have one committee).
          </p>
        ) : (
          <select
            value={selectedReqId}
            onChange={e => setSelectedReqId(e.target.value)}
            style={{ width: '100%', padding: '0.65rem 0.9rem', border: `1.5px solid ${selectedReqId ? '#002147' : '#d1d5db'}`, borderRadius: '0.5rem', fontSize: '0.875rem', color: '#374151', outline: 'none', fontFamily: 'inherit', cursor: 'pointer' }}
          >
            <option value="">— Select a requisition —</option>
            {isViewingOnlyReq && (
              <option value={selectedReqId} disabled>
                {reqInfo
                  ? `${selectedReqId} — ${reqInfo.title} · ${reqInfo.department} (not available)`
                  : `${selectedReqId} (not available)`}
              </option>
            )}
            {requisitions.map(r => (
              <option key={r.id} value={r.id}>
                {r.id} — {r.title} · {r.department}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* ── Details (only rendered after a requisition is chosen) ── */}
      {selectedReqId && (
        <div style={{ backgroundColor: 'white', borderRadius: '0.875rem', padding: '2rem', boxShadow: '0 1px 3px rgba(0,0,0,0.07)' }}>

          {/* Requisition info banner */}
          {reqInfo && (() => {
            const statusMap: Record<string, { bg: string; color: string; border: string }> = {
              'Pending HR':          { bg: '#f3f4f6', color: '#6b7280', border: '#e5e7eb' },
              'Screening':           { bg: '#ede9fe', color: '#6d28d9', border: '#ddd6fe' },
              'With Chair':          { bg: '#fef9c3', color: '#92400e', border: '#fde68a' },
              'Pending Scheduling':  { bg: '#e0e7ff', color: '#3730a3', border: '#a5b4fc' },
              'Interviewing':        { bg: '#dbeafe', color: '#1d4ed8', border: '#bfdbfe' },
              'Under Evaluation':    { bg: '#ede9fe', color: '#6d28d9', border: '#c4b5fd' },
              'Decision Pending':    { bg: '#ffedd5', color: '#c2410c', border: '#fed7aa' },
              'Completed':           { bg: '#dcfce7', color: '#15803d', border: '#bbf7d0' },
            };
            const s = statusMap[reqInfo.status] ?? { bg: '#f3f4f6', color: '#6b7280', border: '#e5e7eb' };
            return (
              <div style={{ backgroundColor: s.bg, border: `1px solid ${s.border}`, borderRadius: '0.75rem', padding: '1.1rem 1.4rem', marginBottom: '1.25rem', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                <div>
                  <p style={{ fontSize: '1rem', fontWeight: '700', color: '#111827', marginBottom: '0.2rem' }}>{reqInfo.title}</p>
                  <p style={{ fontSize: '0.85rem', color: '#6b7280', marginBottom: '0.15rem' }}>Department: {reqInfo.department}</p>
                  <p style={{ fontSize: '0.75rem', color: '#9ca3af' }}>{selectedReqId}</p>
                </div>
                <span style={{ backgroundColor: s.border, color: s.color, padding: '0.25rem 0.75rem', borderRadius: '999px', fontSize: '0.8rem', fontWeight: '600', flexShrink: 0 }}>
                  {reqInfo.status}
                </span>
              </div>
            );
          })()}

          {/* One summary: all listed candidates are included in the single committee */}
          {!loadingDetails && reqInfo && (
            <div style={{ backgroundColor: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: '0.5rem', padding: '0.65rem 0.875rem', marginBottom: '1.5rem' }}>
              <p style={{ fontSize: '0.7rem', fontWeight: '600', color: '#9ca3af', marginBottom: '0.25rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Dean-approved candidates for this committee
              </p>
              <p style={{ fontSize: '1.25rem', fontWeight: '700', color: '#111827' }}>
                {committeeExists ? '—' : candidates.length}
              </p>
              <p style={{ fontSize: '0.78rem', color: '#6b7280', marginTop: '0.35rem', lineHeight: 1.45 }}>
                One committee is formed per requisition and includes every Dean-approved applicant listed below.
              </p>
            </div>
          )}

          {loadingDetails ? (
            <div style={{ textAlign: 'center', padding: '3rem', color: '#6b7280' }}>Loading candidates…</div>
          ) : (
            <>
              {/* ── Candidates ── */}
              <h2 style={{ fontSize: '1rem', fontWeight: '700', color: '#111827', marginBottom: '0.4rem' }}>
                Candidates Sent by Dean
              </h2>
              <p style={{ fontSize: '0.82rem', color: '#6b7280', marginBottom: '1rem' }}>
                All Dean-forwarded candidates listed below are assigned to this committee. Select committee interviewers below.
              </p>

              {candidates.length === 0 ? (
                committeeExists ? (
                  <div style={{ marginBottom: '2rem', padding: '1rem 1.25rem', backgroundColor: '#fef9c3', border: '1px solid #fde68a', borderRadius: '0.75rem' }}>
                    <p style={{ fontSize: '0.875rem', fontWeight: '600', color: '#92400e', marginBottom: '0.35rem' }}>
                      A committee already exists for this requisition.
                    </p>
                    <p style={{ fontSize: '0.82rem', color: '#78350f', lineHeight: 1.5 }}>
                      Only one committee may be created per requisition. If the workflow status still shows &quot;With Chair&quot;, it may need a manual update—otherwise continue from HR interview scheduling.
                    </p>
                  </div>
                ) : (
                  <div style={{ padding: '1rem', border: '1px dashed #e5e7eb', borderRadius: '0.5rem', marginBottom: '2rem', textAlign: 'center' }}>
                    <p style={{ fontSize: '0.875rem', color: '#9ca3af' }}>
                      No candidates have been sent by the Dean for this requisition yet.
                    </p>
                  </div>
                )
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '2rem' }}>
                  {candidates.map(c => (
                      <div
                        key={c.id}
                        style={{ display: 'flex', alignItems: 'flex-start', gap: '1rem', padding: '1rem 1.25rem', borderRadius: '0.75rem', cursor: 'default', border: '1.5px solid #002147', backgroundColor: '#f0f4ff', transition: 'all 0.15s' }}
                      >
                        <input type="checkbox" checked disabled title="Included on this committee"
                          style={{ width: '16px', height: '16px', accentColor: '#002147', cursor: 'default', flexShrink: 0, marginTop: '0.2rem', opacity: 1 }} />
                        <div style={{ width: '42px', height: '42px', borderRadius: '50%', border: '1.5px solid #d1d5db', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                          <UserCircle size={26} color="#9ca3af" />
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <p style={{ fontSize: '0.9rem', fontWeight: '600', color: '#111827' }}>{c.name}</p>
                          <p style={{ fontSize: '0.8rem', color: '#6b7280' }}>{c.edu} · {c.exp}</p>
                          <p style={{ fontSize: '0.78rem', color: '#9ca3af', marginBottom: c.deanNote ? '0.4rem' : 0 }}>{c.position}</p>
                          {c.deanNote && (
                            <div style={{ backgroundColor: '#fefce8', border: '1px solid #fde68a', borderRadius: '0.4rem', padding: '0.45rem 0.65rem' }}>
                              <p style={{ fontSize: '0.75rem', fontWeight: '600', color: '#92400e', marginBottom: '0.1rem' }}>Dean's Note</p>
                              <p style={{ fontSize: '0.78rem', color: '#78350f' }}>{c.deanNote}</p>
                            </div>
                          )}
                        </div>
                      </div>
                  ))}
                </div>
              )}

              {/* ── Interviewers ── */}
              <h2 style={{ fontSize: '1rem', fontWeight: '700', color: '#111827', marginBottom: '0.4rem' }}>
                Select Committee Members
              </h2>
              <p style={{ fontSize: '0.82rem', color: '#6b7280', marginBottom: '1rem' }}>
                Choose interviewers from the university faculty who will evaluate these candidates.
              </p>

              {interviewers.length === 0 ? (
                <p style={{ fontSize: '0.875rem', color: '#9ca3af', padding: '1rem', border: '1px dashed #e5e7eb', borderRadius: '0.5rem', marginBottom: '2rem', textAlign: 'center' }}>
                  No active interviewers found. Run the uploadInterviewers script to populate the collection.
                </p>
              ) : (() => {
                const freezePickers = committeeExists || candidates.length === 0;
                return (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '2rem', opacity: freezePickers ? 0.45 : 1, pointerEvents: freezePickers ? 'none' : 'auto', transition: 'opacity 0.2s' }}>
                    {interviewers.map(iv => {
                      const sel = selectedInterviewers.has(iv.id);
                      return (
                        <div
                          key={iv.id}
                          onClick={() => { if (!freezePickers) toggleInterviewer(iv.id); }}
                          style={{ display: 'flex', alignItems: 'center', gap: '1rem', padding: '1rem', borderRadius: '0.75rem', cursor: freezePickers ? 'default' : 'pointer', border: `1.5px solid ${sel ? '#002147' : '#e5e7eb'}`, backgroundColor: sel ? '#f0f4ff' : 'white', transition: 'all 0.15s' }}
                        >
                          <input type="checkbox" checked={sel} disabled={freezePickers}
                            onChange={() => { if (!freezePickers) toggleInterviewer(iv.id); }}
                            onClick={e => e.stopPropagation()}
                            style={{ width: '16px', height: '16px', accentColor: '#002147', cursor: freezePickers ? 'default' : 'pointer', flexShrink: 0 }} />
                          <div style={{ width: '44px', height: '44px', borderRadius: '50%', border: '2px solid #002147', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                            <UserCircle size={28} color="#002147" />
                          </div>
                          <div style={{ minWidth: 0 }}>
                            <p style={{ fontSize: '0.9rem', fontWeight: '600', color: '#111827' }}>{iv.name}</p>
                            <p style={{ fontSize: '0.8rem', color: '#6b7280' }}>{iv.title}</p>
                            <p style={{ fontSize: '0.78rem', color: '#9ca3af' }}>{iv.department}</p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })()}

              {error && (
                <p style={{ color: '#dc2626', fontSize: '0.85rem', marginBottom: '1rem', padding: '0.6rem 0.9rem', backgroundColor: '#fef2f2', borderRadius: '0.5rem', border: '1px solid #fecaca' }}>
                  {error}
                </p>
              )}

              {/* Actions */}
              {(() => {
                const showDone = committeeExists || candidates.length === 0;
                return (
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '1rem' }}>
                <button
                  onClick={() => navigate('/chair/assigned-requisitions')}
                  style={{ padding: '0.7rem 1.5rem', backgroundColor: showDone ? '#002147' : 'white', border: showDone ? 'none' : '1px solid #d1d5db', borderRadius: '0.5rem', color: showDone ? 'white' : '#374151', fontSize: '0.9rem', fontWeight: showDone ? '600' : '400', cursor: 'pointer', fontFamily: 'inherit' }}
                  onMouseEnter={e => { if (showDone) e.currentTarget.style.backgroundColor = '#003366'; }}
                  onMouseLeave={e => { if (showDone) e.currentTarget.style.backgroundColor = '#002147'; }}
                >
                  Back to Requisitions
                </button>
                {committeeExists ? (
                  <span style={{ padding: '0.7rem 1.5rem', backgroundColor: '#fef9c3', border: '1px solid #fde68a', borderRadius: '0.5rem', fontSize: '0.9rem', fontWeight: '600', color: '#92400e' }}>
                    Committee already exists
                  </span>
                ) : candidates.length === 0 ? (
                  <span style={{ padding: '0.7rem 1.5rem', backgroundColor: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: '0.5rem', fontSize: '0.9rem', fontWeight: '600', color: '#6b7280' }}>
                    Add Dean-approved candidates first
                  </span>
                ) : (
                  <button
                    disabled={!canCreate}
                    onClick={openConfirmModal}
                    style={{ padding: '0.7rem 1.5rem', backgroundColor: canCreate ? '#002147' : '#9ca3af', color: 'white', border: 'none', borderRadius: '0.5rem', fontSize: '0.9rem', fontWeight: '600', cursor: canCreate ? 'pointer' : 'not-allowed', fontFamily: 'inherit' }}
                    onMouseEnter={e => { if (canCreate) e.currentTarget.style.backgroundColor = '#003366'; }}
                    onMouseLeave={e => { if (canCreate) e.currentTarget.style.backgroundColor = '#002147'; }}
                  >
                    {creating
                      ? 'Creating…'
                      : `Create Committee (${selectedInterviewers.size} interviewer${selectedInterviewers.size !== 1 ? 's' : ''}, ${candidates.length} candidate${candidates.length !== 1 ? 's' : ''})`}
                  </button>
                )}
              </div>
                );
              })()}
            </>
          )}
        </div>
      )}

      {confirmOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="committee-confirm-title"
          style={{ position: 'fixed', inset: 0, zIndex: 1000, backgroundColor: 'rgba(15, 23, 42, 0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1.25rem' }}
        >
          <div
            style={{ width: '100%', maxWidth: '440px', backgroundColor: 'white', borderRadius: '0.75rem', boxShadow: '0 20px 50px rgba(0,0,0,0.15)', padding: '1.5rem 1.5rem 1.25rem' }}
            onClick={e => e.stopPropagation()}
          >
            <h2 id="committee-confirm-title" style={{ fontSize: '1.05rem', fontWeight: '700', color: '#111827', marginBottom: '1rem' }}>
              Are you sure you want to submit this committee?
            </h2>

            <div style={{ marginBottom: '1rem' }}>
              <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: '600', color: '#374151', marginBottom: '0.4rem' }}>
                Comment <span style={{ color: '#dc2626' }}>*</span>
              </label>
              <textarea
                value={modalComment}
                onChange={e => { setModalComment(e.target.value); setModalError(null); }}
                disabled={creating}
                placeholder="Add your comment..."
                rows={4}
                style={{ width: '100%', boxSizing: 'border-box', padding: '0.6rem 0.75rem', border: '1.5px solid #d1d5db', borderRadius: '0.5rem', fontSize: '0.875rem', fontFamily: 'inherit', color: '#374151', resize: 'vertical', minHeight: '96px' }}
              />
            </div>

            {modalError && (
              <p style={{ color: '#dc2626', fontSize: '0.8rem', marginBottom: '0.75rem', padding: '0.5rem 0.65rem', backgroundColor: '#fef2f2', borderRadius: '0.4rem', border: '1px solid #fecaca' }}>
                {modalError}
              </p>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '0.25rem' }}>
              <button
                type="button"
                onClick={closeConfirmModal}
                disabled={creating}
                style={{ padding: '0.55rem 1.1rem', backgroundColor: 'white', color: '#374151', border: '1px solid #d1d5db', borderRadius: '0.5rem', fontSize: '0.88rem', fontWeight: '500', cursor: creating ? 'not-allowed' : 'pointer', fontFamily: 'inherit' }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmSubmit}
                disabled={creating}
                style={{ padding: '0.55rem 1.1rem', backgroundColor: creating ? '#64748b' : '#002147', color: 'white', border: 'none', borderRadius: '0.5rem', fontSize: '0.88rem', fontWeight: '600', cursor: creating ? 'not-allowed' : 'pointer', fontFamily: 'inherit' }}
              >
                {creating ? 'Submitting…' : 'Confirm Submit'}
              </button>
            </div>
          </div>
        </div>
      )}
    </ChairLayout>
  );
}
