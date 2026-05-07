import { useState, useEffect, useMemo } from 'react';
import { Clock, Search } from 'lucide-react';
import { collection, doc, onSnapshot, orderBy, query, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { HRLayout } from '../components/HRLayout';
import { normalizeRequisitionStatus, workflowStageFromStatus } from '../utils/requisitionWorkflow';
import { getRequisitionPositionTitle } from '../utils/requisitionFields';

interface CandidateItem {
  id: string;
  name: string;
  email: string;
  status: string;
  requisitionId: string;
}

interface Requisition {
  id: string;
  title: string;
  department: string;
  status: string;
  submittedBy: string;
  submittedAt: string;
  applicationsCount: number;
  shortlistedCount: number;
}

type GroupKey = 'pendingHR' | 'screening';

const GROUP_META: Record<GroupKey, { label: string; color: string; bg: string; Icon: typeof Clock }> = {
  pendingHR: { label: 'Pending HR', color: '#92400e', bg: '#fef9c3', Icon: Clock },
  screening: { label: 'Screening',  color: '#6d28d9', bg: '#ede9fe', Icon: Search },
};

export default function HRRequisitions() {
  const [requisitions, setRequisitions] = useState<Requisition[]>([]);
  const [loading, setLoading]           = useState(true);
  const [collapsed, setCollapsed]       = useState<Record<GroupKey, boolean>>({ pendingHR: false, screening: false });
  const [publishingId, setPublishingId] = useState<string | null>(null);

  useEffect(() => {
    type ReqBase = Omit<Requisition, 'applicationsCount' | 'shortlistedCount'>;

    let reqBase: ReqBase[] = [];
    let cands: CandidateItem[] = [];
    let reqLoaded  = false;
    let candLoaded = false;

    const emit = () => {
      if (!reqLoaded || !candLoaded) return;

      // Live counts come strictly from candidate.requisitionId === r.id (no dept fallback)
      setRequisitions(
        reqBase.map(r => {
          const linked = cands.filter(c => c.requisitionId === r.id);
          return {
            ...r,
            applicationsCount: linked.length,
            shortlistedCount:  linked.filter(c => c.status === 'Shortlisted').length,
          };
        })
      );
      setLoading(false);
    };

    const unsubCandidates = onSnapshot(
      collection(db, 'candidates'),
      (candSnap) => {
        cands = candSnap.docs.map(d => {
          const data = d.data() as Record<string, unknown>;
          return {
            id:            d.id,
            name:          (data.full_name     as string) ?? '-',
            email:         (data.email         as string) ?? '-',
            status:        (data.status        as string) ?? 'Pending',
            requisitionId: (data.requisitionId as string) ?? '',
          };
        });
        candLoaded = true;
        emit();
      },
      (e) => { console.error(e); candLoaded = true; emit(); }
    );

    const unsubReqs = onSnapshot(
      query(collection(db, 'requisitions'), orderBy('submittedAt', 'desc')),
      (reqSnap) => {
        reqBase = reqSnap.docs.map(d => {
          const raw = d.data() as Record<string, unknown>;
          const ts  = (raw.submittedAt as { toDate?: () => Date } | null)?.toDate?.();
          return {
            id:          d.id,
            title:       getRequisitionPositionTitle(raw),
            department:  (raw.department  as string) ?? '-',
            status:      normalizeRequisitionStatus((raw.status as string) ?? 'Pending HR'),
            submittedBy: (raw.submittedBy as string) ?? '-',
            submittedAt: ts ? ts.toLocaleDateString('en-GB') : '-',
          };
        });
        reqLoaded = true;
        emit();
      },
      (e) => { console.error(e); reqLoaded = true; emit(); }
    );

    return () => { unsubCandidates(); unsubReqs(); };
  }, []);

  /** HR clicks "Publish" → moves the requisition from Pending HR → Screening. */
  const publish = async (id: string) => {
    setPublishingId(id);
    try {
      const next = 'Screening';
      await updateDoc(doc(db, 'requisitions', id), {
        status:        next,
        workflowStage: workflowStageFromStatus(next),
        publishedAt:   new Date(),
      });
    } catch (e) {
      console.error('Failed to publish requisition:', e);
    } finally {
      setPublishingId(null);
    }
  };

  const toggleSection = (key: GroupKey) =>
    setCollapsed(prev => ({ ...prev, [key]: !prev[key] }));

  /** This page only surfaces Dean-published jobs HR must post (Pending HR / Screening). */
  const visibleRequisitions = useMemo(
    () => requisitions.filter(r => r.status === 'Pending HR' || r.status === 'Screening'),
    [requisitions],
  );

  const groups: Record<GroupKey, Requisition[]> = {
    pendingHR: visibleRequisitions.filter(r => r.status === 'Pending HR'),
    screening: visibleRequisitions.filter(r => r.status === 'Screening'),
  };

  const ORDER: GroupKey[] = ['pendingHR', 'screening'];

  return (
    <HRLayout>
      <h1 style={{ fontSize: '1.6rem', fontWeight: '700', color: '#111827', marginBottom: '0.25rem' }}>Job Requisitions</h1>
      <p style={{ color: '#6b7280', fontSize: '0.9rem', marginBottom: '1.5rem' }}>Publish Dean-announced job requisitions to LinkedIn and manage postings</p>

      {/* Summary cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '1rem', marginBottom: '1.75rem' }}>
        {ORDER.map(key => {
          const meta = GROUP_META[key];
          const MetaIcon = meta.Icon;
          return (
            <div key={key} style={{ backgroundColor: 'white', borderRadius: '0.75rem', padding: '1.25rem', boxShadow: '0 1px 3px rgba(0,0,0,0.07)', display: 'flex', alignItems: 'center', gap: '1rem' }}>
              <div style={{ width: '42px', height: '42px', borderRadius: '0.5rem', backgroundColor: meta.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <MetaIcon size={18} color={meta.color} />
              </div>
              <div>
                <p style={{ fontSize: '0.8rem', color: '#6b7280', marginBottom: '0.2rem' }}>{meta.label}</p>
                <p style={{ fontSize: '1.6rem', fontWeight: '700', color: '#111827', lineHeight: 1 }}>
                  {loading ? '—' : groups[key].length}
                </p>
              </div>
            </div>
          );
        })}
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '3rem', color: '#6b7280', backgroundColor: 'white', borderRadius: '0.875rem', boxShadow: '0 1px 3px rgba(0,0,0,0.07)' }}>Loading requisitions…</div>
      ) : visibleRequisitions.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '3rem', color: '#9ca3af', backgroundColor: 'white', borderRadius: '0.875rem', boxShadow: '0 1px 3px rgba(0,0,0,0.07)' }}>No requisitions found.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          {ORDER.map(key => {
            const meta = GROUP_META[key];
            const MetaIcon = meta.Icon;
            const items = groups[key];
            const isCollapsed = collapsed[key];

            return (
              <div key={key}>
                {/* Section header */}
                <button
                  onClick={() => toggleSection(key)}
                  style={{
                    width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '0.75rem 1.1rem', backgroundColor: 'white',
                    border: '1px solid #e5e7eb', borderRadius: isCollapsed ? '0.75rem' : '0.75rem 0.75rem 0 0',
                    cursor: 'pointer', fontFamily: 'inherit', boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                    <MetaIcon size={15} color={meta.color} />
                    <span style={{ fontSize: '0.95rem', fontWeight: '700', color: '#111827' }}>{meta.label}</span>
                    <span style={{ backgroundColor: meta.bg, color: meta.color, padding: '0.15rem 0.6rem', borderRadius: '999px', fontSize: '0.78rem', fontWeight: '600' }}>
                      {items.length}
                    </span>
                  </div>
                  <span style={{ fontSize: '0.85rem', color: '#9ca3af', fontWeight: '400' }}>{isCollapsed ? '▸ Show' : '▾ Hide'}</span>
                </button>

                {/* Cards */}
                {!isCollapsed && (
                  <div style={{ border: '1px solid #e5e7eb', borderTop: 'none', borderRadius: '0 0 0.75rem 0.75rem', overflow: 'hidden' }}>
                    {items.length === 0 ? (
                      <div style={{ padding: '2rem', textAlign: 'center', color: '#9ca3af', fontSize: '0.875rem', backgroundColor: '#fafafa' }}>
                        No requisitions in this category.
                      </div>
                    ) : (
                      items.map((r, i) => (
                        <div key={r.id} style={{
                          padding: '1.4rem 1.5rem',
                          backgroundColor: 'white',
                          borderTop: i > 0 ? '1px solid #f3f4f6' : 'none',
                        }}>
                          {/* Title row */}
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.3rem', flexWrap: 'wrap' }}>
                            <h3 style={{ fontSize: '1rem', fontWeight: '700', color: '#111827' }}>{r.title}</h3>
                            <span style={{ backgroundColor: meta.bg, color: meta.color, padding: '0.2rem 0.65rem', borderRadius: '999px', fontSize: '0.78rem', fontWeight: '600' }}>
                              {r.status}
                            </span>
                          </div>
                          <p style={{ fontSize: '0.78rem', color: '#9ca3af', marginBottom: '0.15rem' }}>{r.id}</p>
                          <p style={{ fontSize: '0.82rem', color: '#6b7280', marginBottom: '1.1rem' }}>{r.department}</p>

                          {/* Meta grid */}
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '1rem', marginBottom: '1.1rem' }}>
                            {(key === 'pendingHR'
                              ? [['Submitted By', r.submittedBy], ['Date Submitted', r.submittedAt]]
                              : [['Submitted By', r.submittedBy], ['Date Submitted', r.submittedAt]]
                            ).map(([label, val]) => (
                              <div key={label}>
                                <p style={{ fontSize: '0.72rem', color: '#9ca3af', marginBottom: '0.2rem' }}>{label}</p>
                                <p style={{ fontSize: '0.875rem', fontWeight: '600', color: '#111827' }}>{val}</p>
                              </div>
                            ))}
                          </div>

                          {/* Action */}
                          {key === 'pendingHR' && (
                            <button
                              onClick={() => publish(r.id)}
                              disabled={publishingId === r.id}
                              style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.55rem 1.1rem', backgroundColor: publishingId === r.id ? '#9ca3af' : '#002147', border: 'none', borderRadius: '0.5rem', color: 'white', fontSize: '0.85rem', fontWeight: '600', cursor: publishingId === r.id ? 'not-allowed' : 'pointer', fontFamily: 'inherit' }}
                              onMouseEnter={e => { if (publishingId !== r.id) e.currentTarget.style.backgroundColor = '#003366'; }}
                              onMouseLeave={e => { if (publishingId !== r.id) e.currentTarget.style.backgroundColor = '#002147'; }}
                            >
                              {publishingId === r.id ? 'Publishing…' : 'Publish & Start Screening'}
                            </button>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </HRLayout>
  );
}
