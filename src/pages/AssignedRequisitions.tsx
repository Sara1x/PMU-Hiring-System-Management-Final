import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChairLayout } from '../components/ChairLayout';
import { collection, doc, onSnapshot, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { normalizeRequisitionStatus, workflowStageFromStatus } from '../utils/requisitionWorkflow';
import { getRequisitionPositionTitle } from '../utils/requisitionFields';

interface Requisition {
  id: string;
  title: string;
  dept: string;
  status: string;
  deanApprovedCount: number;
}

const STATUS_BADGE: Record<string, { bg: string; color: string }> = {
  'With Chair':         { bg: '#fef9c3', color: '#92400e' },
  'Pending Scheduling':   { bg: '#e0e7ff', color: '#3730a3' },
  'Interviewing':       { bg: '#dbeafe', color: '#1d4ed8' },
  'Under Evaluation':   { bg: '#ede9fe', color: '#6d28d9' },
  'Decision Pending':   { bg: '#ffedd5', color: '#c2410c' },
  'Completed':          { bg: '#dcfce7', color: '#15803d' },
};

function norm(s: string): string {
  return normalizeRequisitionStatus(s);
}

// Candidate statuses that indicate the candidate was forwarded by Dean to Chair
const FORWARDED_STATUSES = new Set(['Shortlisted', 'Interviewed', 'SentToDean', 'Hired', 'Not Hired']);

export default function AssignedRequisitions() {
  const navigate = useNavigate();
  const [requisitions, setRequisitions] = useState<Requisition[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    /* Hold raw snapshots so we can recompute whenever either collection changes */
    type RawReq = { id: string; title: string; dept: string; status: string };
    type RawCand = { id: string; reqId: string; status: string; deanNote: string; forwardedToChair: boolean };
    type RawComm = { reqId: string };

    let rawReqs:  RawReq[]  = [];
    let rawCands: RawCand[] = [];
    let rawComms: RawComm[] = [];
    let r = false, ca = false, co = false;

    const rebuild = () => {
      if (!r || !ca || !co) return;

      /* candidates sent by Dean: explicitly forwarded candidates only */
      const sentByReq = new Map<string, Set<string>>();
      rawCands.forEach(c => {
        if (!FORWARDED_STATUSES.has(c.status)) return;
        if (!(c.forwardedToChair || c.deanNote.trim().length > 0)) return;
        const set = sentByReq.get(c.reqId) ?? new Set<string>();
        set.add(c.id);
        sentByReq.set(c.reqId, set);
      });

      const committeeReqIds = new Set(rawComms.map(cm => cm.reqId).filter(Boolean));

      const data: Requisition[] = rawReqs
        .filter(r => r.status === 'With Chair')
        .map(r => {
          const sent = sentByReq.get(r.id) ?? new Set<string>();
          return {
            id: r.id,
            title: r.title,
            dept: r.dept,
            status: r.status,
            deanApprovedCount: sent.size,
          };
        })
        .filter(r => r.deanApprovedCount > 0 && !committeeReqIds.has(r.id));

      // Auto-heal stale workflow states:
      // if a requisition is still marked With Chair but there are no dean-forwarded
      // candidates left for it, move it back to Screening.
      const staleReqIds = rawReqs
        .filter(r => r.status === 'With Chair')
        .filter(r => {
          const sent = sentByReq.get(r.id) ?? new Set<string>();
          return sent.size === 0;
        })
        .map(r => r.id);
      if (staleReqIds.length > 0) {
        const next = 'Screening';
        void Promise.all(
          staleReqIds.map(id =>
            updateDoc(doc(db, 'requisitions', id), {
              status: next,
              workflowStage: workflowStageFromStatus(next),
            })
          )
        ).catch(e => console.error('Failed to auto-heal stale With Chair requisitions:', e));
      }

      setRequisitions(data);
      setLoading(false);
    };

    const u1 = onSnapshot(collection(db, 'requisitions'), snap => {
      rawReqs = snap.docs.map(d => ({
        id:    d.id,
        title: getRequisitionPositionTitle(d.data() as Record<string, unknown>),
        dept:  (d.data().department  as string) ?? '-',
        status: norm((d.data().status as string) ?? 'Pending HR'),
      }));
      r = true; rebuild();
    }, e => { console.error(e); r = true; rebuild(); });

    const u2 = onSnapshot(collection(db, 'candidates'), snap => {
      rawCands = snap.docs.map(d => ({
        id:     d.id,
        reqId:  (d.data().requisitionId as string) ?? '',
        status: (d.data().status        as string) ?? '',
        deanNote: ((d.data().deanNote as string) ?? ''),
        forwardedToChair: (d.data().forwardedToChair as boolean) === true,
      }));
      ca = true; rebuild();
    }, e => { console.error(e); ca = true; rebuild(); });

    const u3 = onSnapshot(collection(db, 'committees'), snap => {
      rawComms = snap.docs.map(d => ({
        reqId: (d.data().requisitionId as string) ?? '',
      }));
      co = true; rebuild();
    }, e => { console.error(e); co = true; rebuild(); });

    return () => { u1(); u2(); u3(); };
  }, []);

  return (
    <ChairLayout>
      <h1 style={{ fontSize: '1.6rem', fontWeight: '700', color: '#111827', marginBottom: '0.25rem' }}>
        Assigned Requisitions
      </h1>
      <p style={{ fontSize: '0.9rem', color: '#6b7280', marginBottom: '1.75rem' }}>
        Requisitions forwarded by the Dean for committee formation and evaluation
      </p>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '3rem', color: '#6b7280' }}>Loading requisitions…</div>
      ) : requisitions.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '3rem', color: '#9ca3af', backgroundColor: 'white', borderRadius: '0.875rem', boxShadow: '0 1px 3px rgba(0,0,0,0.07)' }}>
          No requisitions have been assigned to the Chair yet.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {requisitions.map(r => {
            const badge = STATUS_BADGE[r.status] ?? { bg: '#f3f4f6', color: '#6b7280' };
            return (
              <div key={r.id} style={{ backgroundColor: 'white', borderRadius: '0.875rem', padding: '1.5rem', boxShadow: '0 1px 3px rgba(0,0,0,0.07)' }}>

                {/* Header */}
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '1rem' }}>
                  <div>
                    <p style={{ fontSize: '1rem', fontWeight: '700', color: '#111827', marginBottom: '0.2rem' }}>{r.title}</p>
                    <p style={{ fontSize: '0.85rem', color: '#6b7280', marginBottom: '0.15rem' }}>Department: {r.dept}</p>
                    <p style={{ fontSize: '0.78rem', color: '#9ca3af' }}>{r.id}</p>
                  </div>
                  <span style={{ backgroundColor: badge.bg, color: badge.color, padding: '0.3rem 0.875rem', borderRadius: '999px', fontSize: '0.82rem', fontWeight: '600', flexShrink: 0 }}>
                    {r.status}
                  </span>
                </div>

                {/* Summary */}
                <div style={{ backgroundColor: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: '0.5rem', padding: '0.65rem 0.875rem', marginBottom: '1rem' }}>
                  <p style={{ fontSize: '0.7rem', fontWeight: '600', color: '#9ca3af', marginBottom: '0.25rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                    Dean-approved candidates (single committee)
                  </p>
                  <p style={{ fontSize: '1.25rem', fontWeight: '700', color: '#111827' }}>{r.deanApprovedCount}</p>
                </div>

                {/* Action */}
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <button
                    onClick={() => navigate(`/chair/create-committee?reqId=${r.id}`)}
                    style={{ padding: '0.6rem 1.25rem', backgroundColor: '#002147', color: 'white', border: 'none', borderRadius: '0.5rem', fontSize: '0.875rem', fontWeight: '600', cursor: 'pointer', fontFamily: 'inherit' }}
                    onMouseEnter={e => { e.currentTarget.style.backgroundColor = '#003366'; }}
                    onMouseLeave={e => { e.currentTarget.style.backgroundColor = '#002147'; }}
                  >
                    Create Committee
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div style={{ textAlign: 'center', marginTop: '1.5rem' }}>
        <button
          onClick={() => navigate('/chair/dashboard')}
          style={{ background: 'none', border: 'none', color: '#002147', fontSize: '0.9rem', fontWeight: '500', cursor: 'pointer', fontFamily: 'inherit' }}
        >
          ← Back to Dashboard
        </button>
      </div>
    </ChairLayout>
  );
}
