import { useState, useEffect } from 'react';
import { UserCircle } from 'lucide-react';
import { DeanLayout } from '../components/DeanLayout';
import { collection, doc, onSnapshot, writeBatch } from 'firebase/firestore';
import { db } from '../firebase';
import { normalizeRequisitionStatus, workflowStageFromStatus } from '../utils/requisitionWorkflow';
import { getRequisitionNumberOfPositions, getRequisitionPositionTitle } from '../utils/requisitionFields';

interface Candidate {
  id: string;
  name: string;
  position: string;
  edu: string;
  requisitionId: string;
}

interface RequisitionMeta {
  title: string;
  department: string;
  requiredPositions: number;
}

function resolveRequiredPositions(data: Record<string, unknown>): number {
  return getRequisitionNumberOfPositions(data);
}

export default function ShortlistedCandidates() {
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [reqMeta, setReqMeta] = useState<Record<string, RequisitionMeta>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [deanNote, setDeanNote] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let withDeanIds = new Set<string>();
    let metaMap: Record<string, RequisitionMeta> = {};
    let candDocs: Candidate[] = [];
    let reqLoaded = false;
    let candLoaded = false;

    const recompute = () => {
      // Show only shortlisted candidates whose requisition is currently with Dean.
      const filtered = candDocs.filter(c => withDeanIds.has(c.requisitionId));
      setCandidates(filtered);
      setReqMeta(metaMap);
      if (reqLoaded && candLoaded) setLoading(false);
    };

    const unsubReqs = onSnapshot(
      collection(db, 'requisitions'),
      (snap) => {
        const ids = new Set<string>();
        const meta: Record<string, RequisitionMeta> = {};
        snap.docs.forEach(d => {
          const data = d.data() as Record<string, unknown>;
          const status = normalizeRequisitionStatus((data.status as string) ?? '');
          meta[d.id] = {
            title:      getRequisitionPositionTitle(data),
            department: (data.department as string) ?? '-',
            requiredPositions: resolveRequiredPositions(data),
          };
          if (status !== 'With Dean') return;
          ids.add(d.id);
          meta[d.id] = {
            title:      getRequisitionPositionTitle(data),
            department: (data.department as string) ?? '-',
            requiredPositions: resolveRequiredPositions(data),
          };
        });
        withDeanIds = ids;
        metaMap = meta;
        reqLoaded = true;
        recompute();
      },
      (e) => { console.error(e); reqLoaded = true; recompute(); }
    );

    const unsubCands = onSnapshot(
      collection(db, 'candidates'),
      (snap) => {
        candDocs = snap.docs
          .filter(d => ((d.data().status as string) ?? '') === 'Shortlisted')
          .map(d => {
            const data = d.data() as Record<string, unknown>;
            return {
              id:            d.id,
              name:          (data.full_name        as string) ?? '-',
              position:      (data.position_applied as string) ?? '-',
              edu:           (data.degree           as string) ?? '-',
              requisitionId: (data.requisitionId    as string) ?? '',
            };
          });
        candLoaded = true;
        recompute();
      },
      (e) => { console.error(e); candLoaded = true; recompute(); }
    );

    return () => { unsubReqs(); unsubCands(); };
  }, []);

  // Group candidates by requisitionId
  const groups = new Map<string, Candidate[]>();
  for (const c of candidates) {
    const key = c.requisitionId || '__unassigned__';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(c);
  }

  const toggle = (id: string) => setSelected(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const toggleGroup = (ids: string[]) => {
    const allSelected = ids.every(id => selected.has(id));
    setSelected(prev => {
      const next = new Set(prev);
      ids.forEach(id => allSelected ? next.delete(id) : next.add(id));
      return next;
    });
  };

  const handleSendToChair = async () => {
    if (!deanNote.trim() || selected.size === 0) return;
    setSending(true);
    setError(null);
    try {
      const selectedCandidates = candidates.filter(c => selected.has(c.id));
      const reqIdsToUpdate = new Set(
        selectedCandidates.map(c => c.requisitionId).filter(id => id !== '')
      );

      const batch = writeBatch(db);
      for (const id of selected) {
        // Candidates remain Shortlisted — only attach the Dean's note
        batch.update(doc(db, 'candidates', id), {
          deanNote: deanNote.trim(),
          forwardedToChair: true,
          forwardedToChairAt: new Date(),
        });
      }
      for (const reqId of reqIdsToUpdate) {
        const next = 'With Chair';
        batch.update(doc(db, 'requisitions', reqId), {
          status:        next,
          workflowStage: workflowStageFromStatus(next),
          forwardedToChairAt: new Date(),
        });
      }
      await batch.commit();
      setCandidates(prev => prev.filter(c => !selected.has(c.id)));
      setSelected(new Set());
      setDeanNote('');
      setShowModal(false);
    } catch (e) {
      console.error(e);
      setError('Failed to send candidates. Please try again.');
    } finally {
      setSending(false);
    }
  };

  const selectedCountByReq = new Map<string, number>();
  for (const c of candidates) {
    if (!selected.has(c.id)) continue;
    const reqId = c.requisitionId || '__unassigned__';
    selectedCountByReq.set(reqId, (selectedCountByReq.get(reqId) ?? 0) + 1);
  }

  const invalidReqSelections = Array.from(selectedCountByReq.entries()).filter(([reqId, count]) => {
    if (reqId === '__unassigned__') return true;
    const required = reqMeta[reqId]?.requiredPositions;
    // Avoid false-blocking if metadata is temporarily unavailable.
    if (required == null || required <= 0) return false;
    return count < required;
  });

  const canSend = selected.size > 0 && !sending && invalidReqSelections.length === 0;

  return (
    <DeanLayout>
      {/* Confirmation modal */}
      {showModal && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ backgroundColor: 'white', borderRadius: '0.875rem', padding: '2rem', width: '100%', maxWidth: '480px', boxShadow: '0 10px 40px rgba(0,0,0,0.2)' }}>
            <p style={{ fontSize: '1.1rem', fontWeight: '700', color: '#111827', marginBottom: '0.35rem' }}>Send to Chair</p>
            <p style={{ fontSize: '0.875rem', color: '#6b7280', marginBottom: '1.5rem' }}>
              You are forwarding <strong>{selected.size}</strong> candidate(s) to the Chair for evaluation.
            </p>
            <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: '600', color: '#374151', marginBottom: '0.4rem' }}>
              Dean's Note <span style={{ color: '#dc2626' }}>*</span>
            </label>
            <textarea
              autoFocus
              value={deanNote}
              onChange={e => setDeanNote(e.target.value)}
              placeholder="Add your note or instructions for the Chair…"
              rows={4}
              style={{ width: '100%', padding: '0.65rem 0.75rem', border: `1.5px solid ${deanNote.trim() ? '#002147' : '#d1d5db'}`, borderRadius: '0.5rem', fontSize: '0.875rem', color: '#111827', fontFamily: 'inherit', resize: 'vertical', outline: 'none', boxSizing: 'border-box' }}
            />
            {error && (
              <p style={{ fontSize: '0.82rem', color: '#dc2626', marginTop: '0.5rem' }}>{error}</p>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1.25rem' }}>
              <button
                onClick={() => { setShowModal(false); setDeanNote(''); setError(null); }}
                style={{ padding: '0.6rem 1.25rem', background: 'white', border: '1px solid #d1d5db', borderRadius: '0.5rem', color: '#374151', fontSize: '0.875rem', cursor: 'pointer', fontFamily: 'inherit' }}
              >
                Cancel
              </button>
              <button
                disabled={!deanNote.trim() || sending}
                onClick={handleSendToChair}
                style={{ padding: '0.6rem 1.25rem', backgroundColor: deanNote.trim() && !sending ? '#002147' : '#9ca3af', color: 'white', border: 'none', borderRadius: '0.5rem', fontSize: '0.875rem', fontWeight: '600', cursor: deanNote.trim() && !sending ? 'pointer' : 'not-allowed', fontFamily: 'inherit' }}
                onMouseEnter={e => { if (deanNote.trim() && !sending) e.currentTarget.style.backgroundColor = '#003366'; }}
                onMouseLeave={e => { if (deanNote.trim() && !sending) e.currentTarget.style.backgroundColor = '#002147'; }}
              >
                {sending ? 'Sending…' : 'Confirm & Send'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '1.75rem' }}>
        <div>
          <h1 style={{ fontSize: '1.6rem', fontWeight: '700', color: '#111827', marginBottom: '0.25rem' }}>Shortlisted Candidates</h1>
          <p style={{ fontSize: '0.9rem', color: '#6b7280' }}>Review candidates sent by HR and forward selected ones to the Chair</p>
        </div>
        <button
          disabled={!canSend}
          onClick={() => setShowModal(true)}
          style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.65rem 1.25rem', backgroundColor: canSend ? '#002147' : '#9ca3af', color: 'white', border: 'none', borderRadius: '0.5rem', fontSize: '0.875rem', fontWeight: '600', cursor: canSend ? 'pointer' : 'not-allowed', fontFamily: 'inherit' }}
          onMouseEnter={e => { if (canSend) e.currentTarget.style.backgroundColor = '#003366'; }}
          onMouseLeave={e => { if (canSend) e.currentTarget.style.backgroundColor = '#002147'; }}
        >
          {`Send to Chair (${selected.size})`}
        </button>
      </div>
      {selected.size > 0 && invalidReqSelections.length > 0 && (
        <div style={{ marginBottom: '1rem', padding: '0.7rem 0.9rem', border: '1px solid #fecaca', borderRadius: '0.5rem', backgroundColor: '#fef2f2' }}>
          <p style={{ fontSize: '0.82rem', color: '#b91c1c', fontWeight: '700', marginBottom: '0.2rem' }}>
            Selection must include at least the required positions before sending.
          </p>
          {invalidReqSelections.map(([reqId, count]) => {
            const required = reqMeta[reqId]?.requiredPositions ?? '-';
            return (
              <p key={`invalid-${reqId}`} style={{ fontSize: '0.8rem', color: '#b91c1c' }}>
                {reqId}: selected {count}, required at least {required}.
              </p>
            );
          })}
        </div>
      )}

      {/* Content */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '3rem', color: '#6b7280' }}>Loading candidates…</div>
      ) : candidates.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '3rem', color: '#9ca3af', backgroundColor: 'white', borderRadius: '0.875rem', boxShadow: '0 1px 3px rgba(0,0,0,0.07)' }}>
          No candidates have been sent to the Dean yet.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          {[...groups.entries()].map(([reqId, groupCandidates]) => {
            const meta = reqId !== '__unassigned__' ? reqMeta[reqId] : null;
            const groupIds = groupCandidates.map(c => c.id);
            const allGroupSelected = groupIds.every(id => selected.has(id));

            return (
              <div key={reqId} style={{ backgroundColor: 'white', borderRadius: '0.875rem', boxShadow: '0 1px 3px rgba(0,0,0,0.07)', overflow: 'hidden' }}>
                {/* Group header */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.875rem 1.25rem', backgroundColor: '#fafafa', borderBottom: '1px solid #f3f4f6' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <input
                      type="checkbox"
                      checked={allGroupSelected}
                      onChange={() => toggleGroup(groupIds)}
                      style={{ width: '15px', height: '15px', accentColor: '#002147', cursor: 'pointer' }}
                    />
                    <div>
                      <p style={{ fontSize: '0.9rem', fontWeight: '700', color: '#111827' }}>
                        {meta ? `${meta.title} — ${meta.department}` : reqId === '__unassigned__' ? 'Unassigned' : reqId}
                      </p>
                      {reqId !== '__unassigned__' && (
                        <p style={{ fontSize: '0.75rem', color: '#9ca3af' }}>
                          {reqId} · required {meta?.requiredPositions ?? '-'}
                        </p>
                      )}
                    </div>
                  </div>
                  <span style={{ fontSize: '0.78rem', fontWeight: '500', color: '#6b7280', backgroundColor: '#f3f4f6', padding: '0.2rem 0.65rem', borderRadius: '999px', border: '1px solid #e5e7eb' }}>
                    {groupCandidates.length} candidate{groupCandidates.length !== 1 ? 's' : ''}
                  </span>
                </div>

                {/* Candidate rows */}
                {groupCandidates.map((c, i) => {
                  const sel = selected.has(c.id);
                  return (
                    <div
                      key={c.id}
                      onClick={() => toggle(c.id)}
                      style={{ display: 'flex', alignItems: 'center', gap: '1rem', padding: '0.875rem 1.25rem', borderTop: i > 0 ? '1px solid #f3f4f6' : 'none', backgroundColor: sel ? '#f0f4ff' : 'white', cursor: 'pointer', transition: 'background-color 0.1s' }}
                    >
                      <input
                        type="checkbox"
                        checked={sel}
                        onChange={() => toggle(c.id)}
                        onClick={e => e.stopPropagation()}
                        style={{ width: '15px', height: '15px', accentColor: '#002147', cursor: 'pointer', flexShrink: 0 }}
                      />
                      <div style={{ width: '34px', height: '34px', borderRadius: '50%', border: '1.5px solid #d1d5db', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        <UserCircle size={22} color="#9ca3af" />
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ fontSize: '0.875rem', fontWeight: '600', color: '#111827' }}>{c.name}</p>
                        <p style={{ fontSize: '0.78rem', color: '#6b7280' }}>{c.edu} · {c.position}</p>
                      </div>
                      {sel && (
                        <span style={{ fontSize: '0.75rem', fontWeight: '600', color: '#002147', backgroundColor: '#e0e7ff', padding: '0.2rem 0.55rem', borderRadius: '999px', flexShrink: 0 }}>
                          Selected
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}
    </DeanLayout>
  );
}
