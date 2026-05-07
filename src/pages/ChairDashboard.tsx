import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ClipboardList, Users, UserCheck, ClipboardCheck } from 'lucide-react';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { ChairLayout } from '../components/ChairLayout';
import { normalizeRequisitionStatus } from '../utils/requisitionWorkflow';
import { getRequisitionPositionTitle } from '../utils/requisitionFields';

const STATUS_STYLES: Record<string, { bg: string; color: string }> = {
  'Pending HR':          { bg: '#f3f4f6', color: '#6b7280' },
  'Screening':           { bg: '#ede9fe', color: '#6d28d9' },
  'With Chair':          { bg: '#fef9c3', color: '#92400e' },
  'Pending Scheduling':  { bg: '#e0e7ff', color: '#3730a3' },
  'Interviewing':        { bg: '#dbeafe', color: '#1d4ed8' },
  'Under Evaluation':    { bg: '#ede9fe', color: '#6d28d9' },
  'Decision Pending':    { bg: '#ffedd5', color: '#c2410c' },
  'Completed':           { bg: '#dcfce7', color: '#15803d' },
};

const COMM_BADGE: Record<string, { bg: string; color: string }> = {
  'Pending Scheduling': { bg: '#e0e7ff', color: '#3730a3' },
  'Interviewing':       { bg: '#dbeafe', color: '#1d4ed8' },
  'Under Evaluation':   { bg: '#ede9fe', color: '#6d28d9' },
  'Decision Pending':   { bg: '#ffedd5', color: '#c2410c' },
  'Completed':          { bg: '#dcfce7', color: '#15803d' },
};

function norm(s: string): string {
  return normalizeRequisitionStatus(s);
}

function committeeDisplayStatus(req?: Req): string {
  const status = req?.status ?? '';
  const stage = (req?.workflowStage ?? '').toUpperCase();
  if (status === 'Pending Scheduling' || stage === 'SCHEDULING') return 'Pending Scheduling';
  if (status === 'Interviewing' || stage === 'INTERVIEWING') return 'Interviewing';
  if (status === 'Under Evaluation' || stage === 'EVALUATION') return 'Under Evaluation';
  if (status === 'Decision Pending' || stage === 'DECISION_PENDING') return 'Decision Pending';
  if (status === 'Completed' || stage === 'COMPLETED') return 'Completed';
  return status || 'Pending Scheduling';
}

interface Req {
  id: string;
  title: string;
  department: string;
  status: string;
  workflowStage: string;
  submittedAt: string;
  _ts: number;
}

interface Committee {
  id: string;
  title: string;
  department: string;
  requisitionId: string;
  status: string;
  sentToDean: boolean;
  interviewerCount: number;
  candidateCount: number;
}

export default function ChairDashboard() {
  const navigate = useNavigate();
  const [reqs,       setReqs]       = useState<Req[]>([]);
  const [committees, setCommittees] = useState<Committee[]>([]);
  const [evalCount,  setEvalCount]  = useState(0);
  const [loading,    setLoading]    = useState(true);
  /* ── listeners ── */
  useEffect(() => {
    let r = false, c = false, e = false;
    const tryDone = () => { if (r && c && e) setLoading(false); };

    const u1 = onSnapshot(collection(db, 'requisitions'), snap => {
      const docs: Req[] = snap.docs.map(d => {
        const raw = d.data();
        const ts: Date | null = raw.submittedAt?.toDate?.() ?? null;
        return {
          id:          d.id,
          title:       getRequisitionPositionTitle(raw),
          department:  (raw.department  as string) ?? '-',
          status:      norm((raw.status as string) ?? 'Pending HR'),
          workflowStage: ((raw.workflowStage as string) ?? '').toUpperCase(),
          submittedAt: ts ? ts.toLocaleDateString('en-GB') : '-',
          _ts:         ts?.getTime() ?? 0,
        };
      }).sort((a, b) => b._ts - a._ts);
      setReqs(docs);
      r = true; tryDone();
    }, err => { console.error(err); r = true; tryDone(); });

    const u2 = onSnapshot(collection(db, 'committees'), snap => {
      setCommittees(snap.docs.map(d => {
        const raw = d.data();
        return {
          id:              d.id,
          title:           getRequisitionPositionTitle(raw as Record<string, unknown>),
          department:      (raw.department     as string) ?? '-',
          requisitionId:   (raw.requisitionId  as string) ?? '',
          status:          (raw.status         as string) ?? 'Active',
          sentToDean:      (raw.sentToDean     as boolean) ?? false,
          interviewerCount: ((raw.interviewers ?? []) as unknown[]).length,
          candidateCount:   ((raw.candidates   ?? []) as unknown[]).length,
        };
      }));
      c = true; tryDone();
    }, err => { console.error(err); c = true; tryDone(); });

    const u3 = onSnapshot(collection(db, 'evaluations'), snap => {
      setEvalCount(snap.size);
      e = true; tryDone();
    }, err => { console.error(err); e = true; tryDone(); });

    return () => { u1(); u2(); u3(); };
  }, []);

  /* ── Derived data — requisition `status` is the single source of truth (no committee fallbacks) ── */
  const isChairTable = (r: Req) => r.status === 'With Chair';

  const assignedCount     = reqs.filter(isChairTable).length;
  const interviewingCount = reqs.filter(
    r => r.status === 'Interviewing' || r.status === 'Under Evaluation'
  ).length;
  const pendingCommittees = committees.filter(c => !c.sentToDean).slice(0, 5);
  const assignedReqs      = reqs.filter(isChairTable);
  const reqById           = new Map(reqs.map(r => [r.id, r]));

  const th: React.CSSProperties = { padding: '0.7rem 1rem', textAlign: 'left', fontSize: '0.75rem', fontWeight: '600', color: '#6b7280', borderBottom: '1px solid #e5e7eb' };
  const td: React.CSSProperties = { padding: '0.85rem 1rem', fontSize: '0.85rem', color: '#374151', borderBottom: '1px solid #f3f4f6' };

  return (
    <ChairLayout>
      <h1 style={{ fontSize: '1.75rem', fontWeight: '700', color: '#002147', marginBottom: '0.2rem' }}>Welcome back, Department Chair</h1>
      <p style={{ color: '#6b7280', marginBottom: '1.75rem', fontSize: '0.95rem' }}>Interview Committee &amp; Evaluation Management</p>

      {/* ── Stat cards ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem', marginBottom: '1.75rem' }}>
        {[
          { label: 'Assigned Requisitions', value: assignedCount,       iconBg: '#eef2ff', iconColor: '#6366f1', Icon: ClipboardList },
          { label: 'Committees Created',    value: committees.length,   iconBg: '#eff6ff', iconColor: '#3b82f6', Icon: Users },
          { label: 'Under Interview',       value: interviewingCount,   iconBg: '#fff7ed', iconColor: '#f97316', Icon: UserCheck },
          { label: 'Evaluations Received',  value: evalCount,           iconBg: '#f0fdf4', iconColor: '#16a34a', Icon: ClipboardCheck },
        ].map(({ label, value, iconBg, iconColor, Icon }) => (
          <div key={label} style={{ backgroundColor: 'white', borderRadius: '0.875rem', padding: '1.25rem', boxShadow: '0 1px 3px rgba(0,0,0,0.07)' }}>
            <div style={{ width: '40px', height: '40px', borderRadius: '0.5rem', backgroundColor: iconBg, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '0.875rem' }}>
              <Icon size={20} color={iconColor} />
            </div>
            <p style={{ fontSize: '0.78rem', color: '#6b7280', marginBottom: '0.2rem' }}>{label}</p>
            <p style={{ fontSize: '1.9rem', fontWeight: '700', color: '#111827', lineHeight: 1 }}>{loading ? '—' : value}</p>
          </div>
        ))}
      </div>

      {/* ── Body ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '3fr 2fr', gap: '1.25rem' }}>

        {/* Assigned Requisitions table */}
        <div style={{ backgroundColor: 'white', borderRadius: '0.875rem', boxShadow: '0 1px 3px rgba(0,0,0,0.07)', overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '1.1rem 1.5rem', borderBottom: '1px solid #f3f4f6' }}>
            <h2 style={{ fontSize: '1rem', fontWeight: '700', color: '#111827' }}>Assigned Shortlists</h2>
            <button
              onClick={() => navigate('/chair/assigned-requisitions')}
              style={{ fontSize: '0.82rem', color: '#002147', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontWeight: '500' }}
            >
              View All →
            </button>
          </div>
          {loading ? (
            <div style={{ padding: '2.5rem', textAlign: 'center', color: '#6b7280', fontSize: '0.875rem' }}>Loading…</div>
          ) : assignedReqs.length === 0 ? (
            <div style={{ padding: '2.5rem', textAlign: 'center', color: '#9ca3af', fontSize: '0.875rem' }}>
              No assigned requisitions yet. The Dean will forward shortlists here.
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ backgroundColor: '#fafafa' }}>
                  <th style={th}>ID</th>
                  <th style={th}>Position Title</th>
                  <th style={th}>Department</th>
                  <th style={th}>Status</th>
                  <th style={th}>Received</th>
                </tr>
              </thead>
              <tbody>
                {assignedReqs.map(r => {
                  const s = STATUS_STYLES[r.status] ?? { bg: '#f3f4f6', color: '#6b7280' };
                  return (
                    <tr key={r.id}
                      onMouseEnter={e => { (e.currentTarget as HTMLTableRowElement).style.backgroundColor = '#fafafa'; }}
                      onMouseLeave={e => { (e.currentTarget as HTMLTableRowElement).style.backgroundColor = 'white'; }}>
                      <td style={{ ...td, fontSize: '0.75rem', color: '#002147', fontWeight: '600' }}>{r.id}</td>
                      <td style={td}>{r.title}</td>
                      <td style={td}>{r.department}</td>
                      <td style={td}>
                        <span style={{ backgroundColor: s.bg, color: s.color, padding: '0.2rem 0.65rem', borderRadius: '999px', fontSize: '0.74rem', fontWeight: '600' }}>
                          {r.status}
                        </span>
                      </td>
                      <td style={{ ...td, color: '#9ca3af', fontSize: '0.78rem' }}>{r.submittedAt}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Committees panel */}
        <div style={{ backgroundColor: 'white', borderRadius: '0.875rem', padding: '1.25rem 1.5rem', boxShadow: '0 1px 3px rgba(0,0,0,0.07)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
            <h2 style={{ fontSize: '1rem', fontWeight: '700', color: '#111827' }}>Interview Committees</h2>
            <button
              onClick={() => navigate('/chair/evaluations-overview')}
              style={{ fontSize: '0.78rem', color: '#002147', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontWeight: '500' }}
            >
              View Evaluations →
            </button>
          </div>

          {loading ? (
            <div style={{ color: '#6b7280', fontSize: '0.875rem' }}>Loading…</div>
          ) : pendingCommittees.length === 0 ? (
            <div style={{ color: '#9ca3af', fontSize: '0.875rem', padding: '1rem 0', textAlign: 'center' }}>
              No active committees. Create one from Assigned Requisitions.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
              {pendingCommittees.map(c => {
                const displayStatus = committeeDisplayStatus(reqById.get(c.requisitionId));
                const badge = COMM_BADGE[displayStatus] ?? { bg: '#f3f4f6', color: '#6b7280' };
                return (
                  <div key={c.id} style={{ padding: '0.875rem 1rem', backgroundColor: '#f8fafc', border: '1px solid #e5e7eb', borderRadius: '0.625rem' }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '0.3rem' }}>
                      <p style={{ fontSize: '0.875rem', fontWeight: '600', color: '#111827' }}>{c.title}</p>
                      <span style={{ backgroundColor: badge.bg, color: badge.color, padding: '0.15rem 0.55rem', borderRadius: '999px', fontSize: '0.72rem', fontWeight: '600', flexShrink: 0 }}>
                        {displayStatus}
                      </span>
                    </div>
                    <p style={{ fontSize: '0.78rem', color: '#6b7280', marginBottom: '0.25rem' }}>{c.department} · {c.requisitionId}</p>
                    <p style={{ fontSize: '0.75rem', color: '#9ca3af' }}>
                      {c.interviewerCount} interviewer{c.interviewerCount !== 1 ? 's' : ''} · {c.candidateCount} candidate{c.candidateCount !== 1 ? 's' : ''}
                    </p>
                  </div>
                );
              })}
            </div>
          )}

          {/* Quick actions */}
          <div style={{ marginTop: '1.25rem', paddingTop: '1.1rem', borderTop: '1px solid #f3f4f6' }}>
            {[
              { label: 'Create Committee',    path: '/chair/create-committee' },
              { label: 'Review Evaluations',  path: '/chair/evaluations-overview' },
            ].map(({ label, path }) => (
              <button key={label} onClick={() => navigate(path)}
                style={{ display: 'block', width: '100%', textAlign: 'left', padding: '0.55rem 0.75rem', marginBottom: '0.4rem', fontSize: '0.82rem', color: '#002147', background: '#f8fafc', border: '1px solid #e5e7eb', borderRadius: '0.4rem', cursor: 'pointer', fontFamily: 'inherit', fontWeight: '500' }}
                onMouseEnter={e => { e.currentTarget.style.backgroundColor = '#eef2ff'; }}
                onMouseLeave={e => { e.currentTarget.style.backgroundColor = '#f8fafc'; }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </ChairLayout>
  );
}
