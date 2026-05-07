import { useEffect, useMemo, useState } from 'react';
import { UserCircle, CheckCircle, ArrowUpCircle } from 'lucide-react';
import { HRLayout } from '../components/HRLayout';
import { collection, doc, onSnapshot, serverTimestamp, writeBatch } from 'firebase/firestore';
import { db } from '../firebase';
import { normalizeRequisitionStatus, workflowStageFromStatus } from '../utils/requisitionWorkflow';
import { getRequisitionNumberOfPositions, getRequisitionPositionTitle } from '../utils/requisitionFields';

interface Candidate {
  id: string;
  name: string;
  edu: string;
  exp: string;
  position: string;
  requisitionId: string;
  requisitionTitle: string;
  department: string;
  status: string;
}

interface Requisition {
  id: string;
  title: string;
  department: string;
  status: string;
  requiredPositions: number;
}

function norm(v: string): string {
  return v.trim().toLowerCase();
}

function resolveRequiredPositions(data: Record<string, unknown>): number {
  return getRequisitionNumberOfPositions(data);
}

function deptAliases(department: string): string[] {
  const d = norm(department);
  if (d.includes('computer engineering')) return ['computer engineering', 'computer systems', 'embedded systems', 'hardware'];
  if (d.includes('computer science')) return ['computer science', 'computing', 'algorithms', 'programming'];
  if (d.includes('information technology')) return ['information technology', 'it', 'information systems', 'networking'];
  if (d.includes('artificial intelligence')) return ['artificial intelligence', 'ai', 'ai/ml', 'machine learning', 'ml'];
  if (d.includes('software engineering')) return ['software engineering', 'software', 'developer', 'programming'];
  if (d.includes('cybersecurity')) return ['cybersecurity', 'cyber', 'security', 'infosec'];
  return [d];
}

export default function ShortlistBuilder() {
  const [allCandidates, setAllCandidates]   = useState<Candidate[]>([]);
  const [screeningReqs, setScreeningReqs]   = useState<Requisition[]>([]);
  const [selectedReqId, setSelectedReqId]   = useState('');
  const [selected, setSelected]             = useState<Set<string>>(new Set());
  const [submitting, setSubmitting]         = useState(false);
  const [loading, setLoading]               = useState(true);
  const [error, setError]                   = useState<string | null>(null);

  useEffect(() => {
    const unsubCandidates = onSnapshot(
      collection(db, 'candidates'),
      (candSnap) => {
        setAllCandidates(candSnap.docs.map(d => {
          const data = d.data() as Record<string, unknown>;
          return {
            id:            d.id,
            name:          (data.full_name        as string) ?? '-',
            edu:           (data.degree           as string) ?? '-',
            exp:           data.years_experience != null ? String(data.years_experience) + ' years' : '-',
            position:      (data.position_applied as string) ?? '-',
            requisitionId: (data.requisitionId    as string) ?? '',
            requisitionTitle: (data.requisitionTitle as string) ?? '',
            department:    (data.department       as string) ?? '',
            status:        (data.status           as string) ?? 'Pending',
          };
        }));
        setLoading(false);
      },
      (e) => { console.error(e); setLoading(false); }
    );

    const unsubReqs = onSnapshot(
      collection(db, 'requisitions'),
      (reqSnap) => {
        const items: Requisition[] = [];
        reqSnap.docs.forEach(d => {
          const data = d.data() as Record<string, unknown>;
          const status = normalizeRequisitionStatus((data.status as string) ?? '');
          if (status !== 'Screening') return;
          items.push({
            id:         d.id,
            title:      getRequisitionPositionTitle(data),
            department: (data.department as string) ?? '-',
            status,
            requiredPositions: resolveRequiredPositions(data),
          });
        });
        items.sort((a, b) => a.id.localeCompare(b.id));
        setScreeningReqs(items);
        // If the currently selected requisition is no longer actionable
        // (e.g. just sent to Dean from another session), clear selection.
        if (selectedReqId && !items.some(r => r.id === selectedReqId)) {
          setSelectedReqId('');
          setSelected(new Set());
        }
      },
      (e) => console.error(e)
    );

    return () => { unsubCandidates(); unsubReqs(); };
  }, []);

  const selectedReq = useMemo(
    () => screeningReqs.find(r => r.id === selectedReqId),
    [screeningReqs, selectedReqId],
  );

  /** Same linking rule as shortlisted pool, but includes every applicant (any status). */
  const applicantsPoolForReq = (req: Requisition): Candidate[] => {
    const linked = allCandidates.filter(c => c.requisitionId === req.id);
    if (linked.length > 0) return linked;

    const reqTitle = norm(req.title);
    const reqDept = norm(req.department);
    const aliases = deptAliases(req.department);

    return allCandidates.filter(c => {
      const pos = norm(c.position);
      const candDept = norm(c.department);
      const reqTitleOnCandidate = norm(c.requisitionTitle);
      const titleMatch = !!reqTitle && (reqTitleOnCandidate === reqTitle || pos.includes(reqTitle));
      const deptExact = !!reqDept && candDept === reqDept;
      const aliasMatch = aliases.some(a => pos.includes(a) || candDept.includes(a));
      return titleMatch || deptExact || aliasMatch;
    });
  };

  const shortlistedPoolForReq = (req: Requisition): Candidate[] => {
    return applicantsPoolForReq(req).filter(c => c.status === 'Shortlisted');
  };

  // Primary source: linked candidates for this requisition.
  const visibleCandidates = useMemo(() => {
    if (!selectedReqId || !selectedReq) return [];
    return shortlistedPoolForReq(selectedReq);
  }, [allCandidates, selectedReqId, selectedReq]);

  const shortlistedCountByReqId = useMemo(() => {
    const map = new Map<string, number>();
    screeningReqs.forEach(r => {
      map.set(r.id, shortlistedPoolForReq(r).length);
    });
    return map;
  }, [allCandidates, screeningReqs]);

  const applicantsForSelectedReq = useMemo(() => {
    if (!selectedReqId || !selectedReq) return [];
    return applicantsPoolForReq(selectedReq);
  }, [allCandidates, selectedReqId, selectedReq]);

  const undecidedApplicantCount = useMemo(
    () =>
      applicantsForSelectedReq.filter(
        c => c.status !== 'Shortlisted' && c.status !== 'Rejected'
      ).length,
    [applicantsForSelectedReq]
  );

  const allApplicantsDecided =
    applicantsForSelectedReq.length > 0 && undecidedApplicantCount === 0;

  const shortlistedCount = visibleCandidates.length;
  const requiredPositions = selectedReq?.requiredPositions ?? 0;
  const shortage = Math.max(0, requiredPositions - shortlistedCount);
  const requirementMet = !selectedReq || shortlistedCount >= requiredPositions;
  const selectionMeetsRequired = !selectedReq || selected.size >= requiredPositions;
  const selectionShortage = Math.max(0, requiredPositions - selected.size);

  const toggle = (id: string) => setSelected(prev => {
    const n = new Set(prev);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });

  /** Send the shortlist to the Dean.
   *  - Marks every selected candidate as candidate.status = "Shortlisted"
   *  - Transitions requisition status to "With Dean"
   *  - Records tracking flags/timestamp for auditability
   */
  const handleSendToDean = async () => {
    if (!selectedReqId || selected.size === 0 || !allApplicantsDecided) return;
    setSubmitting(true);
    setError(null);
    try {
      const batch = writeBatch(db);

      selected.forEach(id => {
        batch.update(doc(db, 'candidates', id), {
          status:        'Shortlisted',
          requisitionId: selectedReqId,
          requisitionTitle: selectedReq?.title ?? '',
          department:       selectedReq?.department ?? '',
        });
      });

      batch.update(doc(db, 'requisitions', selectedReqId), {
        status: 'With Dean',
        workflowStage: workflowStageFromStatus('With Dean'),
        shortlistSentAt: serverTimestamp(),
        alreadySentToDean: true,
        shortlistForwarded: true,
      });

      await batch.commit();
      // Immediately remove sent requisition from shortlist UI and clear selection.
      setScreeningReqs(prev => prev.filter(r => r.id !== selectedReqId));
      setSelectedReqId('');
      setSelected(new Set());
    } catch (e) {
      console.error('Send to Dean batch failed:', e);
      setError('Failed to send candidates to Dean. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const canSend =
    selected.size > 0 &&
    !submitting &&
    !!selectedReqId &&
    requirementMet &&
    selectionMeetsRequired &&
    allApplicantsDecided;

  return (
    <HRLayout>
      <h1 style={{ fontSize: '1.6rem', fontWeight: '700', color: '#111827', marginBottom: '0.25rem' }}>Shortlist Builder</h1>
      <p style={{ color: '#6b7280', fontSize: '0.9rem', marginBottom: '1.75rem' }}>
        Select a requisition to view its candidates and send a shortlist to the Dean.
      </p>

      {/* Requisition selector */}
      <div style={{ backgroundColor: 'white', borderRadius: '0.875rem', padding: '1.25rem 1.75rem', boxShadow: '0 1px 3px rgba(0,0,0,0.07)', marginBottom: '1rem' }}>
        <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: '600', color: '#374151', marginBottom: '0.5rem' }}>
          Requisition (Screening)
        </label>
        {loading ? (
          <div style={{ color: '#9ca3af', fontSize: '0.875rem' }}>Loading requisitions…</div>
        ) : (
          <select
            value={selectedReqId}
            onChange={e => { setSelectedReqId(e.target.value); setSelected(new Set()); }}
            style={{ width: '100%', padding: '0.65rem 0.9rem', border: `1.5px solid ${selectedReqId ? '#002147' : '#d1d5db'}`, borderRadius: '0.5rem', fontSize: '0.875rem', color: '#374151', outline: 'none', fontFamily: 'inherit', cursor: 'pointer' }}
          >
            <option value="">— Select a requisition —</option>
            {screeningReqs.map(r => (
              <option key={r.id} value={r.id}>
                {r.id} — {r.title} ({r.department}) · {shortlistedCountByReqId.get(r.id) ?? 0}/{r.requiredPositions} shortlisted
              </option>
            ))}
          </select>
        )}
        {!loading && screeningReqs.length === 0 && (
          <p style={{ fontSize: '0.78rem', color: '#9ca3af', marginTop: '0.5rem' }}>
            No requisitions are currently in Screening. Publish a requisition first.
          </p>
        )}
      </div>

      {/* Candidates */}
      <div style={{ backgroundColor: 'white', borderRadius: '0.875rem', padding: '1.75rem', boxShadow: '0 1px 3px rgba(0,0,0,0.07)' }}>
        {loading ? (
          <div style={{ color: '#6b7280', fontSize: '0.9rem', textAlign: 'center', padding: '2rem' }}>Loading candidates…</div>
        ) : !selectedReqId ? (
          <div style={{ textAlign: 'center', padding: '3rem', color: '#9ca3af', fontSize: '0.9rem' }}>
            Select a requisition above to view its candidates.
          </div>
        ) : visibleCandidates.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '3rem', color: '#9ca3af', fontSize: '0.9rem' }}>
            No candidates linked to <strong style={{ color: '#6b7280' }}>{selectedReq?.id ?? selectedReqId}</strong> yet. Upload candidates from Candidate Management.
          </div>
        ) : (
          <>
            {undecidedApplicantCount > 0 && (
              <p style={{ fontSize: '0.82rem', color: '#991b1b', backgroundColor: '#fef2f2', border: '1px solid #fecaca', borderRadius: '0.5rem', padding: '0.6rem 0.75rem', marginBottom: '0.85rem', fontWeight: '600' }}>
                You cannot send a shortlist until every applicant for this job has been marked <strong>Shortlisted</strong> or <strong>Rejected</strong> in Candidate Management.
                {' '}Still pending: <strong>{undecidedApplicantCount}</strong> of {applicantsForSelectedReq.length}.
              </p>
            )}
            {!requirementMet && (
              <p style={{ fontSize: '0.82rem', color: '#b91c1c', backgroundColor: '#fef2f2', border: '1px solid #fecaca', borderRadius: '0.5rem', padding: '0.6rem 0.75rem', marginBottom: '0.85rem', fontWeight: '600' }}>
                This requisition needs at least {requiredPositions} shortlisted CVs. Current shortlisted: {shortlistedCount}. Please shortlist {shortage} more candidate{shortage === 1 ? '' : 's'} from Candidate Management before sending to Dean.
              </p>
            )}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.875rem' }}>
              <p style={{ fontSize: '0.85rem', fontWeight: '600', color: '#374151' }}>
                Candidates — {selectedReq?.title} <span style={{ color: '#9ca3af', fontWeight: 400 }}>({selectedReq?.id})</span>
              </p>
              <p style={{ fontSize: '0.78rem', color: '#6b7280' }}>
                {shortlistedCount} shortlisted · required {requiredPositions}
                {applicantsForSelectedReq.length > 0 ? (
                  <> · {applicantsForSelectedReq.length} total applicants · {undecidedApplicantCount} pending HR decision</>
                ) : null}
              </p>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '1.5rem' }}>
              {visibleCandidates.map(c => {
                const sel = selected.has(c.id);
                const already = c.status === 'Shortlisted';
                return (
                  <div key={c.id} onClick={() => toggle(c.id)}
                    style={{ display: 'flex', alignItems: 'center', gap: '1rem', padding: '1rem 1.25rem', border: `1.5px solid ${sel ? '#002147' : '#e5e7eb'}`, borderRadius: '0.75rem', cursor: 'pointer', backgroundColor: sel ? '#f0f4ff' : 'white', transition: 'all 0.15s' }}>
                    <input type="checkbox" checked={sel} onChange={() => toggle(c.id)} onClick={e => e.stopPropagation()}
                      style={{ width: '16px', height: '16px', accentColor: '#002147', cursor: 'pointer', flexShrink: 0 }} />
                    <div style={{ width: '44px', height: '44px', borderRadius: '50%', border: '1.5px solid #d1d5db', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <UserCircle size={28} color="#9ca3af" />
                    </div>
                    <div style={{ flex: 1 }}>
                      <p style={{ fontSize: '0.9rem', fontWeight: '600', color: '#111827' }}>{c.name}</p>
                      <p style={{ fontSize: '0.8rem', color: '#6b7280' }}>{c.edu}</p>
                      <p style={{ fontSize: '0.78rem', color: '#9ca3af' }}>{c.exp} · {c.position}</p>
                    </div>
                    {already ? (
                      <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', color: '#16a34a', fontSize: '0.8rem', fontWeight: '600' }}>
                        <CheckCircle size={14} /> Shortlisted
                      </span>
                    ) : (
                      <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', color: '#2563eb', fontSize: '0.8rem', fontWeight: '600' }}>
                        Pending
                      </span>
                    )}
                    {sel && <ArrowUpCircle size={20} color="#002147" />}
                  </div>
                );
              })}
            </div>

            {error && (
              <p style={{ color: '#dc2626', fontSize: '0.85rem', marginBottom: '1rem', padding: '0.6rem 0.9rem', backgroundColor: '#fef2f2', borderRadius: '0.5rem', border: '1px solid #fecaca' }}>
                {error}
              </p>
            )}
            {requirementMet && allApplicantsDecided && !selectionMeetsRequired && (
              <p style={{ color: '#b45309', fontSize: '0.82rem', marginBottom: '1rem', padding: '0.6rem 0.9rem', backgroundColor: '#fffbeb', borderRadius: '0.5rem', border: '1px solid #fde68a', fontWeight: '600' }}>
                Select at least {requiredPositions} candidates before sending to Dean. You still need to select {selectionShortage} more.
              </p>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '1rem' }}>
              <button
                onClick={() => setSelected(new Set())}
                style={{ padding: '0.7rem 1.5rem', background: 'white', border: '1px solid #d1d5db', borderRadius: '0.5rem', color: '#374151', fontSize: '0.9rem', cursor: 'pointer', fontFamily: 'inherit' }}
              >
                Clear Selection
              </button>
              {requirementMet && (
                <button
                  disabled={!canSend}
                  onClick={handleSendToDean}
                  style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.7rem 1.5rem', backgroundColor: canSend ? '#002147' : '#9ca3af', color: 'white', border: 'none', borderRadius: '0.5rem', fontSize: '0.9rem', fontWeight: '600', cursor: canSend ? 'pointer' : 'not-allowed', fontFamily: 'inherit' }}
                  onMouseEnter={e => { if (canSend) e.currentTarget.style.backgroundColor = '#003366'; }}
                  onMouseLeave={e => { if (canSend) e.currentTarget.style.backgroundColor = '#002147'; }}
                >
                  {submitting ? 'Sending…' : `Send to Dean (${selected.size})`}
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </HRLayout>
  );
}
